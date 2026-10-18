import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/env.dart';
import '../services/cashu_service.dart';

/// State for the Cashu wallet.
class CashuWalletState {
  final CashuState data;
  final bool isLoading;
  final String? error;
  final MintInfo? mintInfo;

  const CashuWalletState({
    this.data = const CashuState(),
    this.isLoading = false,
    this.error,
    this.mintInfo,
  });

  int get totalSats => data.totalSats;

  CashuWalletState copyWith({
    CashuState? data,
    bool? isLoading,
    String? error,
    MintInfo? mintInfo,
    bool clearError = false,
  }) {
    return CashuWalletState(
      data: data ?? this.data,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      mintInfo: mintInfo ?? this.mintInfo,
    );
  }
}

/// Notifier managing the Cashu ecash wallet.
class CashuWalletNotifier extends StateNotifier<CashuWalletState> {
  CashuWalletNotifier()
      : _service = CashuService(mintUrl: Env.cashuMintUrl),
        super(const CashuWalletState()) {
    _init();
  }

  final CashuService _service;

  CashuService get service => _service;

  Future<void> _init() async {
    state = state.copyWith(isLoading: true);
    try {
      final data = await _service.load();
      state = state.copyWith(data: data, isLoading: false);
      // Fetch mint info in the background
      unawaited(_refreshMintInfo());
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> _refreshMintInfo() async {
    try {
      final info = await _service.getMintInfo();
      state = state.copyWith(mintInfo: info);
    } catch (_) {}
  }

  Future<void> refresh() => _init();

  // ── Minting ─────────────────────────────────────────────────────────

  /// Request a Lightning invoice to pay to mint new ecash.
  Future<MintQuote> requestMintQuote(int amountSats) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final quote = await _service.requestMintQuote(amountSats);
      state = state.copyWith(isLoading: false);
      return quote;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      rethrow;
    }
  }

  /// After paying the Lightning invoice, claim the proofs.
  Future<void> claimMintProofs({
    required String quoteId,
    required int amountSats,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      // Poll the quote status first
      final quote = await _service.checkMintQuote(quoteId);
      if (quote.state != 'PAID' && quote.state != 'ISSUED') {
        throw CashuException(
            'Invoice not yet paid (state: ${quote.state}). Pay the invoice first.');
      }

      final proofs = await _service.mintProofs(
        quoteId: quoteId,
        amountSats: amountSats,
      );

      final updated = CashuState(
        proofs: [...state.data.proofs, ...proofs],
        mintUrl: state.data.mintUrl,
      );
      await _service.save(updated);
      state = state.copyWith(data: updated, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      rethrow;
    }
  }

  // ── Sending ─────────────────────────────────────────────────────────

  /// Build a Cashu token for [amountSats] from available proofs. Returns
  /// the token string and updates state to remove the spent proofs.
  Future<String> createSendToken(int amountSats, {String? memo}) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final selected = _service.selectProofs(state.data.proofs, amountSats);
      final selectedTotal = selected.fold(0, (s, p) => s + p.amount);
      if (selectedTotal < amountSats) {
        throw CashuException(
            'Insufficient balance: have ${state.totalSats} sats, need $amountSats');
      }

      // If we selected more than needed, we'd need change — for simplicity,
      // require exact match or send the entire selected proofs.
      // A full implementation would call swap to split proofs first.
      final token = _service.encodeToken(selected, memo: memo);

      // Remove the spent proofs from local storage
      final selectedIds = selected.map((p) => p.secret).toSet();
      final remaining = state.data.proofs
          .where((p) => !selectedIds.contains(p.secret))
          .toList();

      final updated = CashuState(
        proofs: remaining,
        mintUrl: state.data.mintUrl,
      );
      await _service.save(updated);
      state = state.copyWith(data: updated, isLoading: false);
      return token;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      rethrow;
    }
  }

  // ── Receiving ───────────────────────────────────────────────────────

  /// Redeem a Cashu token: parses it, swaps proofs for our own, and updates
  /// the balance.
  Future<int> receiveToken(String tokenStr) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final token = _service.decodeToken(tokenStr);
      if (token == null) {
        throw const CashuException('Invalid Cashu token');
      }

      final proofs = await _service.receiveToken(token);
      final updated = CashuState(
        proofs: [...state.data.proofs, ...proofs],
        mintUrl: state.data.mintUrl,
      );
      await _service.save(updated);
      state = state.copyWith(data: updated, isLoading: false);
      return token.totalSats;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      rethrow;
    }
  }

  // ── Melting (spending ecash to pay a Lightning invoice) ────────────

  /// Pay a Lightning invoice using ecash.
  Future<MeltResult> meltInvoice(String bolt11Invoice) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final quote = await _service.requestMeltQuote(bolt11Invoice);
      final totalNeeded = quote.amountSats + quote.feeReserveSats;
      final selected = _service.selectProofs(state.data.proofs, totalNeeded);
      final selectedTotal = selected.fold(0, (s, p) => s + p.amount);
      if (selectedTotal < totalNeeded) {
        throw CashuException(
            'Insufficient balance for melt: need $totalNeeded, have ${state.totalSats}');
      }

      final result = await _service.melt(
        quoteId: quote.quote,
        proofs: selected,
      );

      if (result.paid) {
        // Remove spent proofs
        final selectedIds = selected.map((p) => p.secret).toSet();
        final remaining = state.data.proofs
            .where((p) => !selectedIds.contains(p.secret))
            .toList();
        final updated = CashuState(
          proofs: remaining,
          mintUrl: state.data.mintUrl,
        );
        await _service.save(updated);
        state = state.copyWith(data: updated, isLoading: false);
      } else {
        state = state.copyWith(
          isLoading: false,
          error: 'Melt did not complete (state: ${result.state})',
        );
      }
      return result;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      rethrow;
    }
  }

  /// Clear the wallet (dangerous — proofs are bearer assets).
  Future<void> reset() async {
    await _service.clear();
    state = const CashuWalletState();
  }
}

// ── Providers ─────────────────────────────────────────────────────────

final cashuServiceProvider = Provider<CashuService>((ref) {
  return CashuService(mintUrl: Env.cashuMintUrl);
});

final cashuWalletProvider =
    StateNotifierProvider<CashuWalletNotifier, CashuWalletState>((ref) {
  return CashuWalletNotifier();
});
