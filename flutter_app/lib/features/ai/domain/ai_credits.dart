/// On-device AI credits ledger — pure Dart, fully unit-testable.
///
/// Credits are bought in sats (Lightning) and spent per AI message. The
/// ledger lives in secure storage; a simple checksum deters casual tampering
/// (a determined attacker with a patched APK bypasses this anyway — the real
/// spend cap is the OpenRouter key's credit limit, see docs/AI_PLAN.md §2).
library;

class AiCreditsLedger {
  /// Current spendable balance (1 credit = 1 sat of AI budget).
  final int balance;

  /// Total credits ever purchased (for stats/debug).
  final int totalPurchased;

  /// Total credits ever spent.
  final int totalSpent;

  const AiCreditsLedger({
    this.balance = 0,
    this.totalPurchased = 0,
    this.totalSpent = 0,
  });

  AiCreditsLedger credit(int sats) {
    assert(sats > 0);
    return AiCreditsLedger(
      balance: balance + sats,
      totalPurchased: totalPurchased + sats,
      totalSpent: totalSpent,
    );
  }

  /// Deducts [sats] from the balance. Throws [InsufficientAiCredits] when the
  /// balance can't cover it — callers check [canAfford] first.
  AiCreditsLedger debit(int sats) {
    assert(sats > 0);
    if (sats > balance) throw InsufficientAiCredits(balance, sats);
    return AiCreditsLedger(
      balance: balance - sats,
      totalPurchased: totalPurchased,
      totalSpent: totalSpent + sats,
    );
  }

  bool canAfford(int sats) => balance >= sats;

  // ── Serialization (with checksum) ─────────────────────────────────────

  Map<String, dynamic> toJson() => {
        'balance': balance,
        'totalPurchased': totalPurchased,
        'totalSpent': totalSpent,
        'checksum': checksum,
      };

  /// Tamper-evident checksum over the ledger fields. Not cryptographic —
  /// it only needs to catch casual SharedPreferences edits.
  String get checksum {
    const salt = 'nf-ai-credits-v1';
    final raw = '$salt|$balance|$totalPurchased|$totalSpent';
    var hash = 0x811c9dc5; // FNV-1a 32-bit
    for (final unit in raw.codeUnits) {
      hash ^= unit;
      hash = (hash * 0x01000193) & 0xffffffff;
    }
    return hash.toRadixString(16);
  }

  /// Parses a stored ledger. Returns a zeroed ledger when the checksum
  /// doesn't match (tampered or corrupted storage loses credits — honest
  /// users only lose a local record, never sats already paid on-chain).
  static AiCreditsLedger fromJson(Map<String, dynamic> json) {
    final ledger = AiCreditsLedger(
      balance: (json['balance'] as num?)?.toInt() ?? 0,
      totalPurchased: (json['totalPurchased'] as num?)?.toInt() ?? 0,
      totalSpent: (json['totalSpent'] as num?)?.toInt() ?? 0,
    );
    if (json['checksum'] != ledger.checksum) {
      return const AiCreditsLedger();
    }
    return ledger;
  }
}

class InsufficientAiCredits implements Exception {
  final int balance;
  final int required;
  const InsufficientAiCredits(this.balance, this.required);

  @override
  String toString() =>
      'Insufficient AI credits: have $balance, need $required';
}

/// Credit pack the user can buy with sats.
class AiCreditPack {
  final int sats;

  /// Bonus credits granted on top of the pack price (0 or positive).
  final int bonusCredits;

  const AiCreditPack(this.sats, {this.bonusCredits = 0});

  int get creditsGranted => sats + bonusCredits;

  String get label {
    final s = sats >= 1000 ? '${sats ~/ 1000}k' : '$sats';
    return '$s sats';
  }
}

/// The three packs offered in the top-up sheet. 20k gets +10% bonus.
const aiCreditPacks = <AiCreditPack>[
  AiCreditPack(1000),
  AiCreditPack(5000),
  AiCreditPack(20000, bonusCredits: 2000),
];

/// Converts a USD cost (OpenRouter `usage.cost`) into sats to charge the
/// user, applying the operator margin. Never below [minSats] — every paid
/// message costs at least 1 sat even when the model is nearly free.
///
/// [satsPerUsd] comes from the wallet tools fiat rate (sats per $1).
int satsToCharge({
  required double costUsd,
  required double satsPerUsd,
  double margin = 1.5,
  int minSats = 1,
  int? capSats,
}) {
  final raw = (costUsd * satsPerUsd * margin).ceil();
  var sats = raw < minSats ? minSats : raw;
  if (capSats != null && sats > capSats) sats = capSats;
  return sats;
}
