import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/identity/data/address_service.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The user's lightning address state.
class LightningAddressState {
  final List<PayLink> links;
  final PayLink? primary;
  final bool isLoading;
  final String? error;

  const LightningAddressState({
    this.links = const [],
    this.primary,
    this.isLoading = false,
    this.error,
  });

  /// All addresses on the account.
  List<String> get addresses =>
      links.map((l) => l.address).whereType<String>().toList();

  /// The primary address (first with a username, or the first one).
  String? get primaryAddress => primary?.address ?? addresses.firstOrNull;

  /// Addresses that receive money but produce no zap receipt.
  List<PayLink> get silentAddresses => links.where((l) => !l.zaps).toList();

  LightningAddressState copyWith({
    List<PayLink>? links,
    PayLink? primary,
    bool? isLoading,
    String? error,
    bool clearError = false,
  }) {
    return LightningAddressState(
      links: links ?? this.links,
      primary: primary ?? this.primary,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Manages the user's lightning addresses via the lnurlp extension.
class LightningAddressNotifier extends Notifier<LightningAddressState> {
  late final AddressService _service;

  @override
  LightningAddressState build() {
    _service = AddressService();
    // fireImmediately would call the listener synchronously during build(),
    // before the initial state exists — mutating `state` there throws.
    // Defer the first invocation to a microtask instead.
    ref.listen(lnbitsAuthProvider, (previous, next) {
      if (next.isConnected && next.account != null) {
        unawaited(_load());
      } else {
        state = const LightningAddressState();
      }
    });
    final lnbits = ref.read(lnbitsAuthProvider);
    if (lnbits.isConnected && lnbits.account != null) {
      Future.microtask(_load);
    }
    return const LightningAddressState();
  }

  Future<void> _load() async {
    final lnbits = ref.read(lnbitsAuthProvider);
    if (!lnbits.isConnected || lnbits.account == null) return;

    final wallet = lnbits.activeWallet;
    if (wallet?.inkey == null) return;

    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final links = await _service.listPayLinks(
        apiKey: wallet!.inkey!,
        token: lnbits.token,
      );

      // Pick primary: first with a username, or the first one
      PayLink? primary;
      for (final link in links) {
        if (link.username != null && link.username!.isNotEmpty) {
          primary = link;
          break;
        }
      }
      primary ??= links.isEmpty ? null : links.first;

      state = LightningAddressState(
        links: links,
        primary: primary,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> refresh() => _load();

  /// Claim a new lightning address.
  ///
  /// ENTITLEMENT: only two kinds of names can be claimed here —
  ///  1. The FREE generated name (`u` + first 12 hex of your pubkey) — free.
  ///  2. A name you already own (re-claiming an existing link is a no-op).
  ///
  /// Custom names are PAID and must go through the buy-name flow
  /// (`buy_name_screen` → NIP-05 purchase with invoice), NOT this free
  /// lnurlp claim. Claiming a custom name here would bypass payment — that
  /// was the bug: unpaid custom names showed as owned with "publish to
  /// profile" available.
  Future<PayLink> claim({
    required String username,
    String? domain,
  }) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    if (!lnbits.isConnected || lnbits.account == null) {
      throw const AddressException('Connect your wallet first');
    }

    final wallet = lnbits.activeWallet;
    if (wallet?.adminkey == null) {
      throw const AddressException('No wallet with admin key available');
    }

    final normalized = username.trim().toLowerCase();
    if (normalized.isEmpty) {
      throw const AddressException('Enter a username');
    }

    final targetDomain =
        (domain == null || domain.isEmpty) ? null : domain.toLowerCase();

    // Already claimed on THIS domain → no-op. The same local part on a
    // different domain is a different address and must be claimed on its own.
    final existing = state.links.where(
      (l) =>
          l.username?.toLowerCase() == normalized &&
          (l.domain?.toLowerCase() ?? Env.lightningAddressDomain) ==
              (targetDomain ?? Env.lightningAddressDomain),
    );
    if (existing.isNotEmpty) return existing.first;

    // ENTITLEMENT: only the FREE generated name or an already-owned name can
    // be claimed here. Custom names are paid — send users to the buy flow.
    final auth = ref.read(authStateProvider);
    final freeName = auth.pubkey != null
        ? FreeAddress.generate(auth.pubkey!)
        : '';
    final isFreeName = normalized == freeName.toLowerCase();
    final isGenerated = FreeAddress.isGenerated(normalized);

    if (!isFreeName && !isGenerated) {
      throw const AddressException(
        'That name is a paid name. Get it from the Buy Name screen — it comes with an invoice to pay first.',
      );
    }

    // Free generated names must belong to THIS user (can't claim someone
    // else's generated name).
    if (isGenerated && !isFreeName) {
      throw AddressException(
        'That generated name belongs to a different key. Your free name is $freeName@${Env.lightningAddressDomain}.',
      );
    }

    // Taken check (someone else already has it on this domain).
    try {
      final wellKnown = await _checkWellKnown(normalized, targetDomain);
      if (wellKnown) {
        throw const AddressException(
            'That name is already taken here. Try a different one.');
      }
    } catch (e) {
      if (e is AddressException) rethrow;
      // A failed lookup is not treated as taken
    }

    final created = await _service.createPayLink(
      apiKey: wallet!.adminkey!,
      token: lnbits.token,
      username: normalized,
      domain: targetDomain,
      walletId: wallet.id,
      displayName: auth.profile?.displayNameOrName,
    );

    await _load();
    return created;
  }

  /// Check if a name is taken, via the domain's NIP-05 well-known endpoint —
  /// the same map Nostr clients read, so a taken name here really is taken
  /// for the identifier. (The lnurlp well-known answers a different question:
  /// whether a pay link serves that name, which says nothing about a name
  /// sold through the shop.)
  Future<bool> _checkWellKnown(String username, String? domain) async {
    try {
      final d = domain ?? Env.lightningAddressDomain;
      final uri = Uri.parse(
          'https://$d/.well-known/nostr.json?name=${Uri.encodeQueryComponent(username)}');
      final response = await http.Client()
          .get(uri)
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200) {
        final json = jsonDecode(response.body) as Map<String, dynamic>;
        final names = json['names'];
        if (names is Map) {
          for (final key in names.keys) {
            if (key is String && key.toLowerCase() == username) return true;
          }
        }
        return false;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Enable zaps on all silent addresses.
  Future<void> enableZaps({PayLink? chosen}) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    if (!lnbits.isConnected || lnbits.account == null) return;

    final wallet = lnbits.activeWallet;
    if (wallet?.adminkey == null) return;

    final targets = chosen != null ? [chosen] : state.silentAddresses;
    for (final link in targets) {
      await _service.enableZaps(
        apiKey: wallet!.adminkey!,
        token: lnbits.token,
        link: link,
      );
    }
    await _load();
  }

  /// Publish the primary address to the user's Nostr profile as lud16.
  Future<void> publishToProfile({String? address}) async {
    final target = address ?? state.primaryAddress;
    if (target == null) throw const AddressException('No address to publish');

    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.privateKey == null) {
      throw const AddressException('Log in first');
    }

    final nostr = ref.read(nostrServiceProvider);
    final current = auth.profile;
    final updated = (current ?? const NostrProfile()).copyWith(lud16: target);
    final event = nostr.updateProfile(updated);
    nostr.publish(event);

    // Update local state
    ref.read(authStateProvider.notifier).updateLocalProfile(updated);
  }
}

// ── NIP-05 state ─────────────────────────────────────────────────────

class Nip5State {
  final List<Nip5Address> addresses;
  final Nip5Address? primary;
  final bool isLoading;
  final bool isAvailable;
  final String? error;

  const Nip5State({
    this.addresses = const [],
    this.primary,
    this.isLoading = false,
    this.isAvailable = false,
    this.error,
  });

  String? get identifier => primary?.identifier;

  Nip5State copyWith({
    List<Nip5Address>? addresses,
    Nip5Address? primary,
    bool? isLoading,
    bool? isAvailable,
    String? error,
    bool clearError = false,
  }) {
    return Nip5State(
      addresses: addresses ?? this.addresses,
      primary: primary ?? this.primary,
      isLoading: isLoading ?? this.isLoading,
      isAvailable: isAvailable ?? this.isAvailable,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Manages the user's NIP-05 verified names via the nostrnip5 extension.
class Nip5Notifier extends Notifier<Nip5State> {
  late final AddressService _service;

  @override
  Nip5State build() {
    _service = AddressService();
    // fireImmediately would mutate `state` during build() — defer the
    // initial load to a microtask instead.
    ref.listen(lnbitsAuthProvider, (previous, next) {
      if (next.isConnected && next.account != null) {
        unawaited(_load());
      } else {
        state = const Nip5State();
      }
    });
    final lnbits = ref.read(lnbitsAuthProvider);
    if (lnbits.isConnected && lnbits.account != null) {
      Future.microtask(_load);
    }
    return const Nip5State();
  }

  Future<void> _load() async {
    final lnbits = ref.read(lnbitsAuthProvider);
    if (!lnbits.isConnected || lnbits.account == null) return;

    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final addresses = await _service.listNip5Addresses(
        token: lnbits.token,
      );

      // Pick primary: published in profile, or first active, or first
      final auth = ref.read(authStateProvider);
      final published = auth.profile?.nip05?.trim().toLowerCase();

      Nip5Address? primary;
      if (published != null) {
        for (final addr in addresses) {
          if (addr.identifier.toLowerCase() == published) {
            primary = addr;
            break;
          }
        }
      }
      primary ??= addresses.where((a) => a.active).firstOrNull ??
          (addresses.isEmpty ? null : addresses.first);

      state = Nip5State(
        addresses: addresses,
        primary: primary,
        isLoading: false,
        isAvailable: true,
      );
    } catch (e) {
      final isUnavailable =
          e is AddressException && e.message.contains('404');
      state = state.copyWith(
        isLoading: false,
        isAvailable: !isUnavailable,
        error: isUnavailable ? null : e.toString(),
      );
    }
  }

  Future<void> refresh() => _load();

  /// Search for a NIP-05 name.
  Future<Nip5SearchResult> search({
    required String localPart,
    int years = 1,
    String? domainId,
  }) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    return _service.searchNip5(
      localPart: localPart,
      years: years,
      domainId: domainId,
      token: lnbits.token,
    );
  }

  /// Claim a NIP-05 name.
  ///
  /// SQUATTING GUARD: a name is reserved the moment it is claimed, paid or
  /// not — so an unpaid reservation is a name held out of the pool. To stop
  /// one account parking dozens of names it never pays for, claims are capped
  /// at [kMaxUnpaidReservationsPerDomain] UNPAID reservations per domain
  /// (re-claiming an existing reservation to PAY for it is always allowed —
  /// see [payForAddress]). Paid/active names are unaffected: they're the
  /// point. There is no delete endpoint (web docs: names return to the pool
  /// only by expiring), so capping hoarding at the door is the client-side
  /// fix; the server is the only thing that can truly release one early.
  Future<Nip5ClaimResult> claim({
    required String localPart,
    required int years,
    String? domainId,
    String? promoCode,
  }) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) {
      throw const AddressException('Log in first');
    }

    // Enforce the unpaid-reservation cap for the domain being claimed under.
    // Re-claiming a name you ALREADY hold (to pay for it) is a no-op against
    // the cap — checked below before counting.
    final targetDomainId = domainId ?? Env.nip5DomainId;
    final normalized = localPart.trim().toLowerCase();
    final alreadyHeld = state.addresses.any(
      (a) =>
          a.domainId == targetDomainId &&
          a.localPart.toLowerCase() == normalized,
    );
    if (!alreadyHeld) {
      final unpaidOnDomain = state.addresses
          .where((a) => a.domainId == targetDomainId && a.isUnpaid)
          .length;
      if (unpaidOnDomain >= kMaxUnpaidReservationsPerDomain) {
        throw AddressException(
          'You already have $unpaidOnDomain unpaid name${unpaidOnDomain == 1 ? '' : 's'} reserved on this domain. '
          'Pay for one (or let it lapse) before reserving another — a reserved name is held out of the pool for everyone.',
        );
      }
    }

    final result = await _service.claimNip5(
      localPart: localPart,
      years: years,
      pubkey: auth.pubkey!,
      domainId: domainId,
      promoCode: promoCode,
      token: lnbits.token,
    );

    // Remember the invoice locally — the extension only writes
    // `extra.payment_hash` at ACTIVATION, so while the invoice is outstanding
    // the only copy lives in this response. A reload would otherwise lose the
    // ability to tell "not paid" from "paid, not switched on" (web
    // `rememberNip5Invoice`).
    final addressId = result.address?.id;
    final hash = result.paymentHash;
    if (addressId != null && hash != null && hash.isNotEmpty) {
      await _pendingInvoices.remember(addressId, hash);
    }

    await _load();
    return result;
  }

  /// Recover an unpaid (reserved, never-live) name's invoice so it can be
  /// paid — the web's `UnpaidName` "Pay for it" path.
  ///
  /// Re-claiming a name already reserved to THIS key returns the same record
  /// and its outstanding invoice — nothing is bought twice, nothing new is
  /// reserved. The reservation keeps its original years + promo code so it is
  /// not silently re-priced at full rate.
  Future<Nip5ClaimResult> payForAddress(Nip5Address address) async {
    return claim(
      localPart: address.localPart,
      years: address.years ?? 1,
      domainId: address.domainId,
      promoCode: address.promoCode,
    );
  }

  /// The payment hash to watch for an unpaid reservation — the address's own
  /// record when present, otherwise the one this app stored at claim time.
  Future<String?> outstandingHashFor(Nip5Address address) async {
    final own = address.outstandingPaymentHash;
    if (own != null) return own;
    return _pendingInvoices.recall(address.id);
  }

  /// Forget the stored invoice once a name is live (nothing owed anymore).
  Future<void> forgetInvoice(String addressId) =>
      _pendingInvoices.forget(addressId);

  /// RELEASE an unpaid (reserved, never-live) name back to the pool — the
  /// server DOES have a delete route (`DELETE .../user/domain/{did}/address/{id}`),
  /// so this truly frees the name for others right away, not just "let it
  /// lapse". Also clears our pending-invoice record. Refused for active names
  /// (a paid name is money — release-that-throws-away-money needs a separate,
  /// explicit confirm; see `releaseActiveAddress`).
  Future<void> releaseUnpaidAddress(Nip5Address address) async {
    if (!address.isUnpaid) {
      throw const AddressException(
          'Only an unpaid (reserved) name can be released this way.');
    }
    final lnbits = ref.read(lnbitsAuthProvider);
    await _service.deleteNip5Address(
      addressId: address.id,
      domainId: address.domainId,
      token: lnbits.token,
    );
    await _pendingInvoices.forget(address.id);
    await _load();
  }

  /// Release (delete) a PAID/active name. Separate because it throws away
  /// money — the UI confirms hard before calling this.
  Future<void> releaseActiveAddress(Nip5Address address) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    await _service.deleteNip5Address(
      addressId: address.id,
      domainId: address.domainId,
      token: lnbits.token,
    );
    await _pendingInvoices.forget(address.id);
    await _load();
  }

  /// Get a transfer code for an owned name (starts a transfer to another user).
  Future<String> getTransferCode(Nip5Address address) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    return _service.getNip5TransferCode(
      addressId: address.id,
      domainId: address.domainId,
      token: lnbits.token,
    );
  }

  /// Check payment status for a NIP-05 claim.
  Future<bool> checkPayment({
    required String paymentHash,
    String? domainId,
  }) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    return _service.checkNip5Payment(
      paymentHash: paymentHash,
      domainId: domainId,
      token: lnbits.token,
    );
  }

  /// Attach lightning to a NIP-05 name.
  Future<void> attachLightning({
    required String addressId,
    required String walletId,
    String? domainId,
    int? minSats,
    int? maxSats,
  }) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    await _service.attachLightningToNip5(
      addressId: addressId,
      walletId: walletId,
      domainId: domainId,
      token: lnbits.token,
      minSats: minSats,
      maxSats: maxSats,
    );
    await _load();
  }

  /// Publish the primary NIP-05 identifier to the user's profile.
  Future<void> publishToProfile({Nip5Address? address}) async {
    final target = address?.identifier ?? state.identifier;
    if (target == null) throw const AddressException('No name to publish');

    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.privateKey == null) {
      throw const AddressException('Log in first');
    }

    final nostr = ref.read(nostrServiceProvider);
    final current = auth.profile;
    final updated = (current ?? const NostrProfile()).copyWith(nip05: target);
    final event = nostr.updateProfile(updated);
    nostr.publish(event);

    ref.read(authStateProvider.notifier).updateLocalProfile(updated);
  }
}

// ── Providers ─────────────────────────────────────────────────────────

/// How many UNPAID NIP-05 reservations one account may hold per domain.
///
/// A reservation is a name held out of the pool, paid or not — so this caps
/// squatting without touching legitimate buyers: paid/active names don't
/// count, and paying for an existing reservation (a re-claim) is always
/// allowed. There is no delete endpoint, so names return to the pool only by
/// expiring — this is the client-side anti-hoarding guard.
const kMaxUnpaidReservationsPerDomain = 3;

/// Keeps the invoice raised for a NIP-05 name, because nothing else does.
///
/// `extra.payment_hash` looks like the durable record of a purchase and is
/// not one: the extension's `activate_address` is the only thing that ever
/// writes it, so it is populated exactly when it has stopped being needed and
/// empty for the whole window it was being read in. A reservation left unpaid
/// therefore had no hash anywhere except the claim response — so a reload
/// lost the ability to tell "not paid" from "paid, not switched on", and the
/// app asked for the money again either way. Mirrors the web's
/// `nip5-pending-invoices` localStorage store.
class _PendingInvoiceStore {
  static const _key = 'nip5_pending_invoices';

  Future<Map<String, String>> _read() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null) return {};
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        return decoded.map((k, v) => MapEntry('$k', '$v'));
      }
      return {};
    } catch (_) {
      return {};
    }
  }

  Future<void> remember(String addressId, String paymentHash) async {
    if (addressId.isEmpty || paymentHash.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final map = await _read();
      map[addressId] = paymentHash;
      await prefs.setString(_key, jsonEncode(map));
    } catch (_) {
      // A full/refused store costs the recovery path, not the purchase.
    }
  }

  Future<String?> recall(String addressId) async {
    final map = await _read();
    final hash = map[addressId];
    return hash != null && hash.isNotEmpty ? hash : null;
  }

  Future<void> forget(String addressId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final map = await _read();
      map.remove(addressId);
      await prefs.setString(_key, jsonEncode(map));
    } catch (_) {}
  }
}

final _pendingInvoices = _PendingInvoiceStore();

final addressServiceProvider = Provider<AddressService>((ref) {
  return AddressService();
});

final lightningAddressProvider =
    NotifierProvider<LightningAddressNotifier, LightningAddressState>(
  LightningAddressNotifier.new,
);

final nip5Provider =
    NotifierProvider<Nip5Notifier, Nip5State>(
  Nip5Notifier.new,
);

/// The user's free address (derived from pubkey).
final freeAddressProvider = Provider<String?>((ref) {
  final auth = ref.watch(authStateProvider);
  if (auth.pubkey == null) return null;
  return FreeAddress.generate(auth.pubkey!);
});

/// Whether the profile already advertises a lightning address.
final hasLightningAddressProvider = Provider<bool>((ref) {
  final auth = ref.watch(authStateProvider);
  final lightning = ref.watch(lightningAddressProvider);
  return auth.profile?.lud16 != null &&
      lightning.addresses.contains(auth.profile!.lud16);
});

/// Whether the profile already advertises a NIP-05 identifier.
final hasNip5Provider = Provider<bool>((ref) {
  final auth = ref.watch(authStateProvider);
  final nip5 = ref.watch(nip5Provider);
  return auth.profile?.nip05 != null &&
      nip5.addresses.any((a) => a.identifier == auth.profile!.nip05);
});

/// Unpaid (reserved-but-never-live) names, per domain id.
///
/// Drives the "X of N reserved" note and the claim-time cap: these are the
/// names being held out of the pool without payment.
final unpaidReservationsProvider = Provider<Map<String, List<Nip5Address>>>((ref) {
  final nip5 = ref.watch(nip5Provider);
  final byDomain = <String, List<Nip5Address>>{};
  for (final a in nip5.addresses) {
    if (!a.isUnpaid) continue;
    (byDomain[a.domainId] ??= []).add(a);
  }
  return byDomain;
});

/// Total unpaid reservations across all domains (for a headline count).
final unpaidReservationCountProvider = Provider<int>((ref) {
  return ref
      .watch(unpaidReservationsProvider)
      .values
      .fold(0, (sum, list) => sum + list.length);
});

/// Names expiring within the renewal window (active but lapsing) — the app
/// surfaces these so a paid name is renewed rather than lost back to the pool.
final expiringNamesProvider = Provider<List<Nip5Address>>((ref) {
  final nip5 = ref.watch(nip5Provider);
  return nip5.addresses
      .where((a) => nip5Status(a) == Nip5Status.expiring)
      .toList();
});
