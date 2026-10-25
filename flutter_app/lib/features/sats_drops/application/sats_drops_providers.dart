import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A sats drop the user created on this device: a labeled promise to share
/// sats with N people. Drops are LOCAL records (the claim mechanism is a
/// shared zap link — recipients zap-request the amount from the dropper).
class SatsDrop {
  final String id;
  final String label;
  final int amountSats;
  final int totalClaims;
  final int claimed;
  final DateTime createdAt;

  const SatsDrop({
    required this.id,
    required this.label,
    required this.amountSats,
    required this.totalClaims,
    required this.claimed,
    required this.createdAt,
  });

  SatsDrop copyWith({int? claimed}) => SatsDrop(
        id: id,
        label: label,
        amountSats: amountSats,
        totalClaims: totalClaims,
        claimed: claimed ?? this.claimed,
        createdAt: createdAt,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'amountSats': amountSats,
        'totalClaims': totalClaims,
        'claimed': claimed,
        'createdAt': createdAt.millisecondsSinceEpoch,
      };

  factory SatsDrop.fromJson(Map<String, dynamic> json) => SatsDrop(
        id: json['id'] as String,
        label: json['label'] as String,
        amountSats: json['amountSats'] as int,
        totalClaims: json['totalClaims'] as int,
        claimed: json['claimed'] as int,
        createdAt:
            DateTime.fromMillisecondsSinceEpoch(json['createdAt'] as int),
      );
}

/// Local drop store (SharedPreferences) — drops persist across restarts.
/// Notifier pattern per AGENTS.md (mutable service as a real Notifier).
class SatsDropsNotifier extends Notifier<List<SatsDrop>> {
  static const _storageKey = 'sats_drops_v1';

  @override
  List<SatsDrop> build() {
    _load();
    return const [];
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null) return;
    try {
      final list = (jsonDecode(raw) as List)
          .map((j) => SatsDrop.fromJson(j as Map<String, dynamic>))
          .toList();
      state = list;
    } catch (_) {
      // Corrupted storage — start fresh.
      state = const [];
    }
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _storageKey,
      jsonEncode(state.map((d) => d.toJson()).toList()),
    );
  }

  Future<SatsDrop> create({
    required String label,
    required int amountSats,
    required int totalClaims,
  }) async {
    final drop = SatsDrop(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      label: label,
      amountSats: amountSats,
      totalClaims: totalClaims,
      claimed: 0,
      createdAt: DateTime.now(),
    );
    state = [drop, ...state];
    await _persist();
    return drop;
  }

  /// Marks one claim on a drop (when the user confirms they paid a claimer).
  Future<void> markClaimed(String id) async {
    state = [
      for (final d in state)
        if (d.id == id && d.claimed < d.totalClaims)
          d.copyWith(claimed: d.claimed + 1)
        else
          d,
    ];
    await _persist();
  }

  Future<void> delete(String id) async {
    state = state.where((d) => d.id != id).toList();
    await _persist();
  }
}

final satsDropsProvider =
    NotifierProvider<SatsDropsNotifier, List<SatsDrop>>(
  SatsDropsNotifier.new,
);

/// Active (not fully claimed) drops.
final activeDropsProvider = Provider<List<SatsDrop>>((ref) {
  return ref
      .watch(satsDropsProvider)
      .where((d) => d.claimed < d.totalClaims)
      .toList();
});

/// Fully claimed drops (the "history").
final claimedDropsProvider = Provider<List<SatsDrop>>((ref) {
  return ref
      .watch(satsDropsProvider)
      .where((d) => d.claimed >= d.totalClaims)
      .toList();
});
