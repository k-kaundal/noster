import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/identity/services/address_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

export 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart'
    show LnbitsException;

/// Storage keys for session tokens, keyed by Nostr pubkey.
/// SECURITY: Tokens are stored in FlutterSecureStorage (Keychain/Keystore),
/// NOT SharedPreferences, because they can spend from wallets.
const _kWalletTokensKey = 'lnbits:tokens';
const _secureStorage = FlutterSecureStorage();

/// State held by [LnbitsAuthNotifier].
class LnbitsAuthState {
  /// The authenticated account, or null when not connected.
  final LnbitsUser? account;

  /// The session token issued by LNbits.
  final String? token;

  /// True while a login/logout operation is in flight.
  final bool isLoading;

  /// Error from the last operation, phrased for a person.
  final String? error;

  const LnbitsAuthState({
    this.account,
    this.token,
    this.isLoading = false,
    this.error,
  });

  bool get isConnected => account != null;

  LnbitsAuthState copyWith({
    LnbitsUser? account,
    String? token,
    bool? isLoading,
    String? error,
    bool clearAccount = false,
    bool clearError = false,
  }) {
    return LnbitsAuthState(
      account: clearAccount ? null : (account ?? this.account),
      token: token ?? this.token,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Turns a failed sign-in into something someone can act on.
///
/// The two ways this fails are both server-side settings, and both produce
/// errors that read like a bug in this app. Naming the setting is the
/// difference between "it's broken" and "switch that on".
String describeLnbitsLoginFailure(Object error, {String method = 'nostr'}) {
  if (error is! LnbitsException) return error.toString();

  final url = lnbitsUrl;

  if (error.status == 403 &&
      RegExp(r'not allowed', caseSensitive: false).hasMatch(error.message)) {
    final setting = method == 'nostr' ? 'nostr-auth-nip98' : 'user-id-only';
    return '$url has that sign-in switched off. The instance needs "$setting" in its auth_allowed_methods.';
  }

  if (method != 'nostr') return error.message;

  if (RegExp(r"tag 'u'", caseSensitive: false).hasMatch(error.message)) {
    // Show the actual server error, which names the URL it rejected
    return '${error.message}\n\n'
        'This means $url is not expecting sign-ins addressed to itself. '
        'Add "$url" to its nostr_absolute_request_urls setting — it ships '
        'listing only localhost, so every signature is rejected until then.';
  }

  if (error.status == 404 || error.status == 405) {
    return '$url doesn\'t accept Nostr sign-in. The instance needs "nostr-auth-nip98" in its auth_allowed_methods.';
  }

  if (error.status == 401 || error.status == 403) {
    return '$url rejected the signature. Check its nostr_absolute_request_urls setting matches the address this app calls, and that new accounts are allowed.';
  }

  return error.message;
}

/// Manages the LNbits wallet session: Nostr-key login, auto-provisioning,
/// password/user-id login, and account state.
///
/// Tokens are persisted per Nostr pubkey so switching accounts hands the
/// right wallet to the right key.
class LnbitsAuthNotifier extends Notifier<LnbitsAuthState> {
  late final LnbitsService _service;

  @override
  LnbitsAuthState build() {
    _service = LnbitsService();
    // Watch auth changes: when the user logs in or switches Nostr accounts,
    // attempt to restore their wallet session.
    ref.listen<AuthState>(authStateProvider, (previous, next) {
      final prevKey = previous?.pubkey;
      final nextKey = next.pubkey;
      if (next.isLoggedIn && nextKey != null && nextKey != prevKey) {
        // New login or account switch
        unawaited(_restore());
      } else if (!next.isLoggedIn) {
        // Logged out — drop the wallet session
        state = const LnbitsAuthState();
      }
    });
    // Restore any persisted wallet session after the initial state exists.
    // fireImmediately would run the listener before build() returns, and
    // mutating `state` at that point throws.
    final auth = ref.read(authStateProvider);
    if (auth.isLoggedIn && auth.pubkey != null) {
      Future.microtask(_restore);
    }
    return const LnbitsAuthState();
  }

  // ── Persistence ────────────────────────────────────────────────────

  Future<void> _restore() async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return;

    try {
      // SECURITY: Read from secure storage first. A local storage failure
      // (plugin error, corrupted store) must NEVER block the wallet — we
      // just treat it as "no token" and let the user sign in fresh.
      String? token;
      try {
        token = await _secureStorage.read(
          key: '$_kWalletTokensKey:${auth.pubkey}',
        );
      } catch (e) {
        debugPrint('Secure storage read failed: $e');
      }

      // Migration: check legacy SharedPreferences and migrate to secure storage
      if (token == null) {
        try {
          final prefs = await SharedPreferences.getInstance();
          final legacyToken = prefs.getString(
            '$_kWalletTokensKey:${auth.pubkey}',
          );
          if (legacyToken != null) {
            // Migrate to secure storage
            try {
              await _secureStorage.write(
                key: '$_kWalletTokensKey:${auth.pubkey}',
                value: legacyToken,
              );
              await prefs.remove('$_kWalletTokensKey:${auth.pubkey}');
            } catch (_) {}
            token = legacyToken;
          }
        } catch (e) {
          debugPrint('SharedPreferences migration failed: $e');
        }
      }

      if (token == null) {
        state = const LnbitsAuthState();
        return;
      }

      state = state.copyWith(token: token, isLoading: true, clearError: true);
      final account = await _service.getAccount(token);
      state = LnbitsAuthState(account: account, token: token, isLoading: false);
    } catch (e) {
      if (LnbitsService.isMissingSession(e)) {
        // Session expired or invalid — clean up the stored token so we don't
        // keep trying it on every app start.
        if (auth.pubkey != null) {
          await _clearToken(auth.pubkey!);
        }
        state = const LnbitsAuthState();
      } else {
        // Network error or server error — keep the token (it might work next
        // time) but show the error so the user knows something is wrong.
        // Strip noisy "Exception:"/"PlatformException" prefixes for display.
        final msg = e
            .toString()
            .replaceFirst(
              RegExp(r'^(PlatformException|Exception|LnbitsException)\(?'),
              '',
            )
            .replaceFirst(RegExp(r'\)$'), '');
        state = LnbitsAuthState(error: msg);
      }
    }
  }

  Future<void> _saveToken(String pubkey, String token) async {
    try {
      // SECURITY: Store in secure storage (Keychain/Keystore)
      await _secureStorage.write(
        key: '$_kWalletTokensKey:$pubkey',
        value: token,
      );
    } catch (_) {}
  }

  Future<void> _clearToken(String pubkey) async {
    try {
      await _secureStorage.delete(key: '$_kWalletTokensKey:$pubkey');
    } catch (_) {}
  }

  // ── Finish sign-in: provision wallet if needed ────────────────────

  /// Everything that has to happen after a token is issued, whichever way it
  /// was obtained.
  ///
  /// A brand new account has no wallet, and an account without one is useless —
  /// no balance to show, nothing to receive into. Provisioning it here means
  /// signing in is the only step a person ever takes.
  ///
  /// Throws on failure so the caller can report it, rather than leaving the
  /// state half-written with a token but no account.
  Future<String> _finishSignIn(String token) async {
    final account = await _service.getAccount(token);
    if (account.wallets.isEmpty) {
      await _service.createWallet(token: token);
      // Re-fetch so the new wallet is in the account
      final updated = await _service.getAccount(token);
      state = LnbitsAuthState(account: updated, token: token, isLoading: false);

      // New wallet: claim the free lightning address so the user can receive
      // zaps immediately. This mirrors the web flow where `useIdentity` claims
      // the free address after wallet creation.
      await _claimFreeLightningAddress(updated);
    } else {
      state = LnbitsAuthState(account: account, token: token, isLoading: false);
    }
    return token;
  }

  /// Claims the free lightning address for a newly created wallet.
  ///
  /// The address is derived from the user's pubkey (e.g. `u1234abcd…@ln.nostrfeed.com`)
  /// and gives them a working zap target on day one. Failure is logged but not
  /// thrown — the wallet is still usable without it, and the user can claim it
  /// later from the Identity screen.
  Future<void> _claimFreeLightningAddress(LnbitsUser account) async {
    try {
      final auth = ref.read(authStateProvider);
      if (auth.pubkey == null) return;

      final wallet = account.wallets.isEmpty ? null : account.wallets.first;
      if (wallet?.adminkey == null) return;

      final freeName = FreeAddress.generate(auth.pubkey!);
      final addressService = AddressService();

      await addressService.createPayLink(
        apiKey: wallet!.adminkey!,
        token: state.token,
        username: freeName,
        domain: Env.lightningAddressDomain,
        walletId: wallet.id,
        displayName: auth.profile?.displayNameOrName,
      );
    } catch (_) {
      // Non-fatal: the wallet works without a lightning address, and the
      // Identity screen offers claiming it again.
    }
  }

  // ── Login: Nostr key ──────────────────────────────────────────────

  /// Sign in with the current Nostr key. Auto-provisions a wallet on first use.
  Future<bool> connect() async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null || auth.privateKey == null) {
      state = state.copyWith(error: 'Log in with Nostr first');
      return false;
    }

    state = state.copyWith(isLoading: true, clearError: true);

    try {
      final nostr = ref.read(nostrServiceProvider);

      // Build the signer callback: sign a kind-27235 event with the user's key
      Future<NostrEvent> signEvent({
        required int kind,
        required String content,
        required List<List<String>> tags,
      }) async {
        return nostr.authService.signEvent(
          privateKey: auth.privateKey!,
          kind: kind,
          content: content,
          tags: tags,
        );
      }

      final token = await _service.loginWithNostrSigned(signEvent);
      if (token == null) {
        throw const LnbitsException('No session token returned', 0);
      }

      // Save the token first, then finish sign-in. If provisioning fails,
      // the token is still valid and the user can retry without re-signing.
      await _saveToken(auth.pubkey!, token);
      await _finishSignIn(token);
      return true;
    } catch (e) {
      // If the token was saved but _finishSignIn failed, the state may still
      // show isLoading: true. Reset it here with the error so the UI recovers.
      state = state.copyWith(
        isLoading: false,
        error: describeLnbitsLoginFailure(e),
      );
      return false;
    }
  }

  // ── Login: username + password ────────────────────────────────────

  Future<bool> connectWithPassword({
    required String username,
    required String password,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final token = await _service.loginWithPassword(username, password);
      if (token == null) {
        throw const LnbitsException('No session token returned', 0);
      }
      final auth = ref.read(authStateProvider);
      if (auth.pubkey != null) {
        await _saveToken(auth.pubkey!, token);
      }
      await _finishSignIn(token);
      return true;
    } catch (e) {
      final wrong = e is LnbitsException && e.status == 401;
      state = state.copyWith(
        isLoading: false,
        error: wrong
            ? 'Wrong username or password. Check them and try again.'
            : e.toString(),
      );
      return false;
    }
  }

  // ── Login: account id from wallet link ────────────────────────────

  Future<bool> connectWithLink(String input) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final usr = LnbitsService.parseUserId(input);
      if (usr == null) {
        throw const LnbitsException(
          'That does not look like a wallet link or account id.',
          0,
        );
      }
      final token = await _service.loginWithUserId(usr);
      if (token == null) {
        throw const LnbitsException('No session token returned', 0);
      }
      final auth = ref.read(authStateProvider);
      if (auth.pubkey != null) {
        await _saveToken(auth.pubkey!, token);
      }
      await _finishSignIn(token);
      return true;
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: describeLnbitsLoginFailure(e, method: 'user-id'),
      );
      return false;
    }
  }

  // ── Account management ────────────────────────────────────────────

  Future<bool> updateProfile({
    String? username,
    String? email,
    String? telegram,
    String? nostrIdentifier,
  }) async {
    final account = state.account;
    final token = state.token;
    if (account == null || token == null) return false;

    state = state.copyWith(isLoading: true, clearError: true);
    try {
      // Merge notification settings into extra
      final currentExtra = Map<String, dynamic>.from(account.extra ?? {});
      final currentNotifications = Map<String, dynamic>.from(
        currentExtra['notifications'] as Map? ?? {},
      );
      if (email != null) {
        currentNotifications['email_address'] = email.isEmpty ? null : email;
      }
      if (telegram != null) {
        currentNotifications['telegram_chat_id'] = telegram.isEmpty
            ? null
            : telegram;
      }
      if (nostrIdentifier != null) {
        currentNotifications['nostr_identifier'] = nostrIdentifier.isEmpty
            ? null
            : nostrIdentifier;
      }
      currentExtra['notifications'] = currentNotifications;

      final updated = await _service.updateAccount(
        token: token,
        userId: account.id,
        username: username ?? account.username,
        extra: currentExtra,
      );
      state = state.copyWith(account: updated, isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  Future<bool> setPassword({
    required String username,
    required String password,
    required String passwordRepeat,
    String? currentPassword,
  }) async {
    final account = state.account;
    final token = state.token;
    if (account == null || token == null) return false;

    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final updated = await _service.setPassword(
        token: token,
        userId: account.id,
        username: username,
        password: password,
        passwordRepeat: passwordRepeat,
        currentPassword: currentPassword,
      );
      state = state.copyWith(account: updated, isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  Future<bool> linkPubkey(String pubkey) async {
    final account = state.account;
    final token = state.token;
    if (account == null || token == null) return false;

    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final updated = await _service.linkPubkey(
        token: token,
        userId: account.id,
        pubkey: pubkey,
      );
      state = state.copyWith(account: updated, isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  // ── Refresh & logout ──────────────────────────────────────────────

  Future<void> refresh() async {
    final token = state.token;
    if (token == null) return;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final account = await _service.getAccount(token);
      state = state.copyWith(account: account, isLoading: false);
    } catch (e) {
      if (LnbitsService.isMissingSession(e)) {
        await logout();
      } else {
        state = state.copyWith(isLoading: false, error: e.toString());
      }
    }
  }

  Future<void> logout() async {
    final auth = ref.read(authStateProvider);
    if (auth.pubkey != null) {
      await _clearToken(auth.pubkey!);
    }
    state = const LnbitsAuthState();
  }
}

// ── Providers ─────────────────────────────────────────────────────────

final lnbitsServiceProvider = Provider<LnbitsService>((ref) {
  return LnbitsService();
});

final lnbitsAuthProvider =
    NotifierProvider<LnbitsAuthNotifier, LnbitsAuthState>(
  LnbitsAuthNotifier.new,
);

/// The active wallet (first one) on the connected account.
final lnbitsActiveWalletProvider = Provider<LnbitsWallet?>((ref) {
  final account = ref.watch(lnbitsAuthProvider).account;
  return account?.wallets.isEmpty == false ? account!.wallets.first : null;
});

/// Wallets on the connected account.
final lnbitsWalletsProvider = Provider<List<LnbitsWallet>>((ref) {
  return ref.watch(lnbitsAuthProvider).account?.wallets ?? [];
});

/// Total balance across all wallets, in sats.
final lnbitsTotalBalanceProvider = Provider<int>((ref) {
  final wallets = ref.watch(lnbitsWalletsProvider);
  return wallets.fold(0, (sum, w) => sum + w.balanceSats);
});

/// Whether the wallet is connected.
final lnbitsIsConnectedProvider = Provider<bool>((ref) {
  return ref.watch(lnbitsAuthProvider).isConnected;
});

// ── House wallet ─────────────────────────────────────────────────────

/// Receive-only shared wallet state (balance + invoice creation).
class HouseWalletState {
  final LnbitsWallet? wallet;
  final bool isLoading;
  final String? error;

  const HouseWalletState({this.wallet, this.isLoading = false, this.error});

  int get balanceSats => wallet?.balanceSats ?? 0;

  HouseWalletState copyWith({
    LnbitsWallet? wallet,
    bool? isLoading,
    String? error,
    bool clearError = false,
  }) {
    return HouseWalletState(
      wallet: wallet ?? this.wallet,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class HouseWalletNotifier extends Notifier<HouseWalletState> {
  late final LnbitsService _service;

  @override
  HouseWalletState build() {
    _service = LnbitsService();
    _init();
    return const HouseWalletState();
  }

  Future<void> _init() async {
    if (!HouseWallet.isConfigured) return;
    state = state.copyWith(isLoading: true);
    try {
      final wallet = await _service.getWallet(
        HouseWallet.invoiceKey,
        HouseWallet.id,
      );
      state = HouseWalletState(wallet: wallet, isLoading: false);
    } catch (e) {
      state = HouseWalletState(isLoading: false, error: e.toString());
    }
  }

  Future<void> refresh() => _init();

  Future<LnbitsInvoice> createInvoice({
    required int amountSats,
    String? memo,
    int? expirySeconds,
  }) async {
    if (!HouseWallet.isConfigured) {
      throw const LnbitsException('House wallet not configured', 0);
    }
    return _service.createInvoice(
      apiKey: HouseWallet.invoiceKey,
      amountSats: amountSats,
      memo: memo,
      expirySeconds: expirySeconds,
    );
  }

  Future<bool> checkInvoicePaid(String paymentHash) async {
    if (!HouseWallet.isConfigured) return false;
    try {
      return await _service.getInvoiceStatus(
        HouseWallet.invoiceKey,
        paymentHash,
      );
    } catch (_) {
      return false;
    }
  }
}

final houseWalletProvider =
    NotifierProvider<HouseWalletNotifier, HouseWalletState>(
  HouseWalletNotifier.new,
);
