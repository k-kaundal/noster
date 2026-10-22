import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lndhub_service.dart';

/// Secure-storage key for the connected LndHub account's credentials.
/// These can spend, so they live in Keychain/Keystore like the LNbits token.
const _kLndHubKey = 'lndhub:credentials';
const _secureStorage = FlutterSecureStorage();

/// A connected LndHub account, if any.
class LndHubState {
  final LndHubCredentials? credentials;
  final int? balanceSats;
  final bool isLoading;
  final String? error;

  const LndHubState({
    this.credentials,
    this.balanceSats,
    this.isLoading = false,
    this.error,
  });

  bool get isConnected => credentials != null;

  LndHubState copyWith({
    LndHubCredentials? credentials,
    int? balanceSats,
    bool? isLoading,
    String? error,
    bool clearAll = false,
    bool clearError = false,
  }) {
    if (clearAll) return const LndHubState();
    return LndHubState(
      credentials: credentials ?? this.credentials,
      balanceSats: balanceSats ?? this.balanceSats,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// The LndHub wallet connection: scan a `lndhub://` QR → authorized,
/// spendable, and shown in the wallet hub next to LNbits/NWC/Cashu.
class LndHubNotifier extends Notifier<LndHubState> {
  @override
  LndHubState build() {
    _restore();
    return const LndHubState();
  }

  Future<void> _restore() async {
    try {
      final raw = await _secureStorage.read(key: _kLndHubKey);
      if (raw == null) return;
      final map = jsonDecode(raw) as Map<String, dynamic>;
      final creds = LndHubCredentials(
        login: map['login'] as String,
        password: map['password'] as String,
        host: map['host'] as String,
      );
      state = state.copyWith(credentials: creds);
      await refresh();
    } catch (_) {}
  }

  /// Connect from a scanned/pasted `lndhub://` URI. Authorizes against the
  /// hub before persisting — a bad login/password must fail here, not at
  /// the first payment.
  Future<bool> connect(String input) async {
    final creds = LndHubCredentials.parse(input);
    if (creds == null) {
      state = state.copyWith(
        error: 'That is not an LndHub QR (expected lndhub://login:password@host)',
      );
      return false;
    }
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final service = LndHubService(creds);
      await service.authorize();
      final balance = await service.getBalanceSats();
      await _secureStorage.write(
        key: _kLndHubKey,
        value: jsonEncode({
          'login': creds.login,
          'password': creds.password,
          'host': creds.host,
        }),
      );
      state = LndHubState(credentials: creds, balanceSats: balance);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  Future<void> refresh() async {
    final creds = state.credentials;
    if (creds == null) return;
    try {
      final service = LndHubService(creds);
      await service.authorize();
      final balance = await service.getBalanceSats();
      state = state.copyWith(balanceSats: balance, clearError: true);
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  /// Pay an invoice from this wallet. Throws on failure so the caller can
  /// fall through to the next wallet.
  Future<void> payInvoice(String bolt11) async {
    final creds = state.credentials;
    if (creds == null) throw const LndHubException('No LndHub wallet');
    final service = LndHubService(creds);
    await service.authorize();
    await service.payInvoice(bolt11);
    await refresh();
  }

  Future<void> disconnect() async {
    try {
      await _secureStorage.delete(key: _kLndHubKey);
    } catch (_) {}
    state = const LndHubState();
  }
}

final lndHubProvider = NotifierProvider<LndHubNotifier, LndHubState>(
  LndHubNotifier.new,
);

/// Whether any wallet is available for the payment flow — LNbits, NWC,
/// Cashu, or LndHub. The LndHub service for the active connection.
final lndHubServiceProvider = Provider<LndHubService?>((ref) {
  final creds = ref.watch(lndHubProvider).credentials;
  if (creds == null) return null;
  return LndHubService(creds);
});
