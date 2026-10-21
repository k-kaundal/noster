import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/wallet/services/nwc_service.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// SECURITY: NWC connection strings contain a wallet secret key.
/// They MUST be stored in FlutterSecureStorage, NOT SharedPreferences.
const _nwcSecureStorage = FlutterSecureStorage();

/// A single stored NWC connection.
class NwcConnection {
  final String id; // internal id (we use the client pubkey)
  final String connectionString;
  final String alias;
  final String walletPubkey;
  final DateTime connectedAt;

  const NwcConnection({
    required this.id,
    required this.connectionString,
    required this.alias,
    required this.walletPubkey,
    required this.connectedAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'connectionString': connectionString,
        'alias': alias,
        'walletPubkey': walletPubkey,
        'connectedAt': connectedAt.toIso8601String(),
      };

  factory NwcConnection.fromJson(Map<String, dynamic> json) => NwcConnection(
        id: json['id'] as String,
        connectionString: json['connectionString'] as String,
        alias: json['alias'] as String? ?? 'NWC Wallet',
        walletPubkey: json['walletPubkey'] as String,
        connectedAt:
            DateTime.tryParse(json['connectedAt'] as String? ?? '') ??
                DateTime.now(),
      );
}

/// State held by the [NwcNotifier].
class NwcState {
  /// All connections stored locally.
  final List<NwcConnection> connections;

  /// Currently active connection id (matches [NwcConnection.id]).
  final String? activeId;

  /// Live NWC service for the active connection, if any.
  final NwcService? service;

  /// Latest known balance in sats, null if not yet fetched.
  final int? balanceSats;

  /// Latest transactions (most recent first).
  final List<NwcTransaction>? transactions;

  /// True while connect/balance/tx fetch is in flight.
  final bool isLoading;

  final String? error;

  const NwcState({
    this.connections = const [],
    this.activeId,
    this.service,
    this.balanceSats,
    this.transactions,
    this.isLoading = false,
    this.error,
  });

  NwcConnection? get activeConnection {
    if (activeId == null) return null;
    for (final c in connections) {
      if (c.id == activeId) return c;
    }
    return null;
  }

  bool get isConnected => service?.isConnected == true;

  NwcState copyWith({
    List<NwcConnection>? connections,
    String? activeId,
    NwcService? service,
    int? balanceSats,
    List<NwcTransaction>? transactions,
    bool? isLoading,
    String? error,
    bool clearService = false,
    bool clearError = false,
    bool clearBalance = false,
    bool clearTransactions = false,
  }) {
    return NwcState(
      connections: connections ?? this.connections,
      activeId: activeId ?? this.activeId,
      service: clearService ? null : (service ?? this.service),
      balanceSats: clearBalance ? null : (balanceSats ?? this.balanceSats),
      transactions:
          clearTransactions ? null : (transactions ?? this.transactions),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Notifier that manages NWC connections, balance, and transactions.
class NwcNotifier extends Notifier<NwcState> {
  static const _storageKey = 'nwc:connections';
  static const _activeStorageKey = 'nwc:active';

  @override
  NwcState build() {
    _loadStoredConnections();
    return const NwcState();
  }

  NostrService get _nostr => ref.read(nostrServiceProvider);

  // ── Persistence ────────────────────────────────────────────────────

  Future<void> _loadStoredConnections() async {
    try {
      // SECURITY: Read from secure storage first. A local storage failure
      // (plugin error) must not kill the whole flow — treat as empty.
      String? secureJson;
      try {
        secureJson = await _nwcSecureStorage.read(key: _storageKey);
      } catch (_) {}
      SharedPreferences? prefs;
      try {
        prefs = await SharedPreferences.getInstance();
      } catch (_) {}

      List<NwcConnection> connections = [];

      if (secureJson != null) {
        // Load from secure storage
        final list = (jsonDecode(secureJson) as List).cast<String>();
        connections = list
            .map((s) => NwcConnection.fromJson(_decode(s)))
            .toList();
      } else if (prefs != null) {
        // Migration: load from legacy SharedPreferences
        final listJson = prefs.getStringList(_storageKey) ?? [];
        if (listJson.isNotEmpty) {
          connections = listJson
              .map((s) => NwcConnection.fromJson(
                  (s.isNotEmpty ? (s.startsWith('{') ? _decode(s) : null) : null) ??
                      {}))
              .toList();
          // Migrate to secure storage
          try {
            await _nwcSecureStorage.write(
                key: _storageKey, value: jsonEncode(listJson));
            // Remove from insecure storage
            await prefs.remove(_storageKey);
          } catch (_) {}
        }
      }

      // Active ID is not sensitive — keep in SharedPreferences
      final activeId = prefs?.getString(_activeStorageKey);
      state = state.copyWith(connections: connections, activeId: activeId);

      // Auto-restore the active connection if one exists
      if (activeId != null) {
        final active = connections.where((c) => c.id == activeId).firstOrNull;
        if (active != null) {
          _connectInternal(active).catchError((_) => false);
        }
      }
    } catch (_) {}
  }

  Map<String, dynamic> _decode(String s) {
    try {
      return Map<String, dynamic>.from(jsonDecode(s) as Map);
    } catch (_) {
      return {};
    }
  }

  Future<void> _saveConnections() async {
    try {
      // SECURITY: Store connection strings in secure storage
      final list =
          state.connections.map((c) => jsonEncode(c.toJson())).toList();
      await _nwcSecureStorage.write(
          key: _storageKey, value: jsonEncode(list));

      // Active ID is not sensitive — keep in SharedPreferences
      try {
        final prefs = await SharedPreferences.getInstance();
        if (state.activeId != null) {
          await prefs.setString(_activeStorageKey, state.activeId!);
        } else {
          await prefs.remove(_activeStorageKey);
        }
      } catch (_) {}
    } catch (_) {}
  }

  // ── Public API ─────────────────────────────────────────────────────

  /// Add a new NWC connection from a URI. Returns true on success.
  Future<bool> addConnection(String uri, {String? alias}) async {
    state = state.copyWith(isLoading: true, clearError: true);

    try {
      final service = NwcService(_nostr.authService);
      final info = await service.connect(uri, nostr: _nostr);

      final conn = NwcConnection(
        id: service.clientPubkey!,
        connectionString: uri,
        alias: alias ?? info.alias ?? 'NWC Wallet',
        walletPubkey: service.walletPubkey!,
        connectedAt: DateTime.now(),
      );

      final updated = [...state.connections];
      final existingIdx = updated.indexWhere((c) => c.id == conn.id);
      if (existingIdx >= 0) {
        updated[existingIdx] = conn;
      } else {
        updated.add(conn);
      }

      state = state.copyWith(
        connections: updated,
        activeId: conn.id,
        service: service,
        isLoading: false,
        clearError: true,
        clearBalance: true,
        clearTransactions: true,
      );

      await _saveConnections();
      // Fetch initial data in the background
      unawaited(refreshBalance());
      unawaited(refreshTransactions());
      return true;
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
      );
      return false;
    }
  }

  /// Reconnect an existing stored connection (e.g. after app restart).
  Future<bool> _connectInternal(NwcConnection conn) async {
    try {
      final service = NwcService(_nostr.authService);
      await service.connect(conn.connectionString, nostr: _nostr);
      state = state.copyWith(service: service);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Switch to a different stored connection.
  Future<bool> setActive(String id) async {
    final conn = state.connections.where((c) => c.id == id).firstOrNull;
    if (conn == null) return false;

    state = state.copyWith(
      activeId: id,
      isLoading: true,
      clearError: true,
      clearBalance: true,
      clearTransactions: true,
    );
    await _saveConnections();

    final ok = await _connectInternal(conn);
    state = state.copyWith(isLoading: false);
    if (ok) {
      unawaited(refreshBalance());
      unawaited(refreshTransactions());
    } else {
      state = state.copyWith(error: 'Failed to connect to wallet');
    }
    return ok;
  }

  /// Remove a stored connection.
  Future<void> removeConnection(String id) async {
    final updated = state.connections.where((c) => c.id != id).toList();
    final isRemovingActive = state.activeId == id;
    final newActiveId =
        isRemovingActive ? (updated.isEmpty ? null : updated.first.id) : state.activeId;

    state = state.copyWith(
      connections: updated,
      activeId: newActiveId,
      clearService: isRemovingActive,
      clearBalance: isRemovingActive,
      clearTransactions: isRemovingActive,
    );
    await _saveConnections();

    if (newActiveId != null && isRemovingActive) {
      final next = updated.where((c) => c.id == newActiveId).firstOrNull;
      if (next != null) {
        await _connectInternal(next);
        unawaited(refreshBalance());
        unawaited(refreshTransactions());
      }
    }
  }

  /// Refresh the balance from the active wallet.
  Future<int?> refreshBalance() async {
    final service = state.service;
    if (service == null || !service.isConnected) return null;
    try {
      final balance = await service.getBalance(_nostr);
      state = state.copyWith(balanceSats: balance);
      return balance;
    } catch (e) {
      state = state.copyWith(error: 'Balance fetch failed: $e');
      return null;
    }
  }

  /// Refresh transactions.
  Future<List<NwcTransaction>?> refreshTransactions({int limit = 50}) async {
    final service = state.service;
    if (service == null || !service.isConnected) return null;
    try {
      final txs = await service.listTransactions(
        limit: limit,
        nostr: _nostr,
      );
      state = state.copyWith(transactions: txs);
      return txs;
    } catch (e) {
      state = state.copyWith(error: 'Transaction fetch failed: $e');
      return null;
    }
  }

  /// Pay a BOLT11 invoice. Returns the preimage on success.
  Future<String> payInvoice(String invoice, {int? amountSats}) async {
    final service = state.service;
    if (service == null || !service.isConnected) {
      throw StateError('No active NWC connection');
    }
    final response = await service.payInvoice(
      invoice: invoice,
      amountSats: amountSats,
      nostr: _nostr,
    );
    // Refresh in the background
    unawaited(refreshBalance());
    unawaited(refreshTransactions());
    return response.preimage;
  }

  /// Create an incoming invoice.
  Future<NwcInvoice> makeInvoice({
    required int amountSats,
    String? description,
    int? expiry,
  }) async {
    final service = state.service;
    if (service == null || !service.isConnected) {
      throw StateError('No active NWC connection');
    }
    final invoice = await service.makeInvoice(
      amountSats: amountSats,
      description: description,
      expiry: expiry,
      nostr: _nostr,
    );
    // Refresh in the background
    unawaited(refreshBalance());
    unawaited(refreshTransactions());
    return invoice;
  }
}

// ── Providers ─────────────────────────────────────────────────────────

final nwcServiceProvider = Provider<NwcService>((ref) {
  return NwcService(ref.read(nostrServiceProvider).authService);
});

final nwcNotifierProvider =
    NotifierProvider<NwcNotifier, NwcState>(NwcNotifier.new);

/// Convenience provider: is any NWC wallet connected?
final hasNwcProvider = Provider<bool>((ref) {
  return ref.watch(nwcNotifierProvider).isConnected;
});

/// Convenience provider: active connection alias, if any.
final activeNwcAliasProvider = Provider<String?>((ref) {
  final state = ref.watch(nwcNotifierProvider);
  return state.activeConnection?.alias;
});


