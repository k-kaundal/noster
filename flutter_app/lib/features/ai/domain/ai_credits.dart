/// On-device AI credits ledger — pure Dart, fully unit-testable.
///
/// Credits are AI TOKENS: 1 token = $0.001 of AI budget (1,000 tokens = $1),
/// pegged to the dollar so a message's token price NEVER moves with BTC.
/// Sats only enter at top-up time, converted at the live exchange rate —
/// spending sats feels like spending money, spending tokens feels like
/// spending points (and the numbers stay small: 1–50 tokens a message).
///
/// The ledger lives in secure storage; a simple checksum deters casual
/// tampering (a determined attacker with a patched APK bypasses this
/// anyway — the real spend cap is the OpenRouter key's credit limit, see
/// docs/AI_PLAN.md §2).
library;

/// Tokens per 1 USD — the peg. 1 token = $0.001.
const tokensPerUsd = 1000;

class AiCreditsLedger {
  /// Current spendable balance (1 credit = 1 TOKEN = $0.001 of AI budget).
  final int balance;

  /// Total credits ever purchased (for stats/debug).
  final int totalPurchased;

  /// Total credits ever spent.
  final int totalSpent;

  /// Last mutation (seconds since epoch) — the merge key for the relay
  /// backup: two copies of the ledger (local vs Nostr) are reconciled by
  /// taking the one that moved last. 0 = never mutated (fresh ledger).
  final int updatedAt;

  const AiCreditsLedger({
    this.balance = 0,
    this.totalPurchased = 0,
    this.totalSpent = 0,
    this.updatedAt = 0,
  });

  static int _now() => DateTime.now().millisecondsSinceEpoch ~/ 1000;

  AiCreditsLedger credit(int sats) {
    assert(sats > 0);
    return AiCreditsLedger(
      balance: balance + sats,
      totalPurchased: totalPurchased + sats,
      totalSpent: totalSpent,
      updatedAt: _now(),
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
      updatedAt: _now(),
    );
  }

  bool canAfford(int sats) => balance >= sats;

  /// Merges two copies of the same user's ledger (local + relay backup).
  ///
  /// Credits are money — a merge must NEVER lose a purchase or a spend.
  /// Union semantics: take the max of each counter (purchases and spends are
  /// monotonic, so the max is the true total), and derive the balance as
  /// `purchased - spent` rather than max(balance) — max(balance) would
  /// resurrect credits already spent on the other device.
  AiCreditsLedger mergeWith(AiCreditsLedger other) {
    final purchased =
        totalPurchased > other.totalPurchased ? totalPurchased : other.totalPurchased;
    final spent = totalSpent > other.totalSpent ? totalSpent : other.totalSpent;
    final mergedBalance = purchased - spent;
    final stamp = updatedAt > other.updatedAt ? updatedAt : other.updatedAt;
    return AiCreditsLedger(
      balance: mergedBalance < 0 ? 0 : mergedBalance,
      totalPurchased: purchased,
      totalSpent: spent,
      updatedAt: stamp,
    );
  }

  // ── Serialization (with checksum) ─────────────────────────────────────

  Map<String, dynamic> toJson() => {
        'balance': balance,
        'totalPurchased': totalPurchased,
        'totalSpent': totalSpent,
        'updatedAt': updatedAt,
        'checksum': checksum,
      };

  /// Tamper-evident checksum over the ledger fields. Not cryptographic —
  /// it only needs to catch casual SharedPreferences edits.
  String get checksum => _checksum(balance, totalPurchased, totalSpent, updatedAt);

  static String _checksum(int balance, int purchased, int spent, int stamp) {
    const salt = 'nf-ai-credits-v1';
    final raw = '$salt|$balance|$purchased|$spent|$stamp';
    var hash = 0x811c9dc5; // FNV-1a 32-bit
    for (final unit in raw.codeUnits) {
      hash ^= unit;
      hash = (hash * 0x01000193) & 0xffffffff;
    }
    return hash.toRadixString(16);
  }

  /// The pre-`updatedAt` checksum (4 fields) — ledgers persisted by older
  /// builds validate against this. Without it the upgrade would read every
  /// existing ledger as "tampered" and zero it (losing the local balance on
  /// app update — the exact bug class this whole flow exists to stop).
  static String _legacyChecksum(int balance, int purchased, int spent) {
    const salt = 'nf-ai-credits-v1';
    final raw = '$salt|$balance|$purchased|$spent';
    var hash = 0x811c9dc5;
    for (final unit in raw.codeUnits) {
      hash ^= unit;
      hash = (hash * 0x01000193) & 0xffffffff;
    }
    return hash.toRadixString(16);
  }

  /// Parses a stored ledger. Returns a zeroed ledger when the checksum
  /// doesn't match (tampered or corrupted storage loses credits — honest
  /// users only lose a local record, never sats already paid on-chain).
  ///
  /// Accepts both the current (5-field) and legacy (4-field) checksums so
  /// ledgers written before `updatedAt` existed survive the upgrade.
  static AiCreditsLedger fromJson(Map<String, dynamic> json) {
    final balance = (json['balance'] as num?)?.toInt() ?? 0;
    final purchased = (json['totalPurchased'] as num?)?.toInt() ?? 0;
    final spent = (json['totalSpent'] as num?)?.toInt() ?? 0;
    final stamp = (json['updatedAt'] as num?)?.toInt() ?? 0;
    final stored = json['checksum'];
    final ok = stored == _checksum(balance, purchased, spent, stamp) ||
        // Legacy payloads predate updatedAt — their checksum covers 4 fields.
        (stamp == 0 && stored == _legacyChecksum(balance, purchased, spent));
    if (!ok) return const AiCreditsLedger();
    return AiCreditsLedger(
      balance: balance,
      totalPurchased: purchased,
      totalSpent: spent,
      updatedAt: stamp,
    );
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

/// Token pack the user can buy, priced in sats at the live exchange rate.
///
/// The pack is TOKEN-denominated (what the user gets); the sats price is
/// computed at purchase time from the live rate plus the volatility buffer,
/// so the operator always receives the pack's full USD value in sats.
class AiCreditPack {
  /// Tokens the pack sells (1,000 tokens = $1).
  final int tokens;

  /// Bonus tokens granted on top (0 or positive).
  final int bonusTokens;

  const AiCreditPack(this.tokens, {this.bonusTokens = 0});

  int get creditsGranted => tokens + bonusTokens;

  /// The sats price for [tokens] at [satsPerUsd], plus [volatilityBuffer]
  /// (a fraction, e.g. 0.03) so BTC moving between quote and settlement
  /// never shorts the operator.
  int priceSats({required double satsPerUsd, double volatilityBuffer = 0}) {
    final usd = tokens / tokensPerUsd;
    return (usd * satsPerUsd * (1 + volatilityBuffer)).ceil();
  }

  String get label {
    final t = tokens >= 1000 ? '${tokens ~/ 1000}k' : '$tokens';
    return '$t tokens';
  }
}

/// The three packs offered in the top-up sheet. 20k gets +10% bonus.
const aiCreditPacks = <AiCreditPack>[
  AiCreditPack(1000),
  AiCreditPack(5000),
  AiCreditPack(20000, bonusTokens: 2000),
];
