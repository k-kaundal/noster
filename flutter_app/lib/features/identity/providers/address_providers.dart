import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/identity/services/address_service.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';

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

    final wallet = lnbits.account!.wallets.isEmpty
        ? null
        : lnbits.account!.wallets.first;
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
  Future<PayLink> claim({
    required String username,
    String? domain,
  }) async {
    final lnbits = ref.read(lnbitsAuthProvider);
    if (!lnbits.isConnected || lnbits.account == null) {
      throw const AddressException('Connect your wallet first');
    }

    final wallet = lnbits.account!.wallets.isEmpty
        ? null
        : lnbits.account!.wallets.first;
    if (wallet?.adminkey == null) {
      throw const AddressException('No wallet with admin key available');
    }

    // Check if already claimed
    final existing = state.links.where(
      (l) => l.username?.toLowerCase() == username.toLowerCase(),
    );
    if (existing.isNotEmpty) return existing.first;

    // Check entitlement
    final auth = ref.read(authStateProvider);
    final freeName = auth.pubkey != null
        ? FreeAddress.generate(auth.pubkey!)
        : '';

    final isFree = username.toLowerCase() == freeName.toLowerCase();
    final isOwned = state.links.any(
      (l) => l.username?.toLowerCase() == username.toLowerCase(),
    );

    if (!isFree && !isOwned) {
      // Check if name is taken by someone else
      try {
        final wellKnown = await _checkWellKnown(username, domain);
        if (wellKnown) {
          throw const AddressException(
              'That name is already taken here. Try a different one.');
        }
      } catch (e) {
        if (e is AddressException) rethrow;
        // A failed lookup is not treated as taken
      }
    }

    final created = await _service.createPayLink(
      apiKey: wallet!.adminkey!,
      token: lnbits.token,
      username: username,
      domain: domain,
      walletId: wallet.id,
      displayName: auth.profile?.displayNameOrName,
    );

    await _load();
    return created;
  }

  /// Check if a name is taken via the well-known endpoint.
  Future<bool> _checkWellKnown(String username, String? domain) async {
    try {
      final d = domain ?? Env.lightningAddressDomain;
      final uri = Uri.parse('https://$d/.well-known/lnurlp/$username');
      final response = await http.Client()
          .get(uri)
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200) {
        final json = jsonDecode(response.body) as Map<String, dynamic>;
        return json['status'] != 'ERROR';
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

    final wallet = lnbits.account!.wallets.isEmpty
        ? null
        : lnbits.account!.wallets.first;
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

    final result = await _service.claimNip5(
      localPart: localPart,
      years: years,
      pubkey: auth.pubkey!,
      domainId: domainId,
      promoCode: promoCode,
      token: lnbits.token,
    );

    await _load();
    return result;
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
