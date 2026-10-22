import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_payment_tracker.dart';

void main() {
  // The "paid but credits stay 0" bug class, part 2: if a top-up invoice's
  // memo fails this matcher, reconciliation can NEVER attribute that
  // payment — the sats are gone from the user's point of view. These tests
  // pin the exact memo shapes the top-up sheet produces, incl. the
  // bonus/custom notes that used to REPLACE the identifying memo entirely
  // (no "ai credits", no pubkey → unrecoverable payments).
  group('AiPaymentTracker.isAiCreditMemo', () {
    const pubkey =
        '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
    const short = '3bf0c63fcb93'; // first 12

    test('standard pack memo matches', () {
      expect(
        AiPaymentTracker.isAiCreditMemo(
          'NostrFeed AI credits 1k sats · $short',
          pubkey,
        ),
        isTrue,
      );
    });

    test('bonus pack memo (with appended note) matches', () {
      // The old memoOverride REPLACED the memo with '+2000 bonus' — no
      // identifying prefix, no pubkey → this payment was unrecoverable.
      expect(
        AiPaymentTracker.isAiCreditMemo(
          'NostrFeed AI credits 20k sats · $short · +2000 bonus',
          pubkey,
        ),
        isTrue,
      );
    });

    test('custom amount memo (with fee note) matches', () {
      expect(
        AiPaymentTracker.isAiCreditMemo(
          'NostrFeed AI credits 1030 sats · $short · '
          'custom amount (incl. +3% fee)',
          pubkey,
        ),
        isTrue,
      );
    });

    test('full pubkey in memo also matches', () {
      expect(
        AiPaymentTracker.isAiCreditMemo(
          'NostrFeed AI credits 5k sats · $pubkey',
          pubkey,
        ),
        isTrue,
      );
    });

    test('a memo without the AI-credits prefix is rejected', () {
      expect(
        AiPaymentTracker.isAiCreditMemo('+2000 bonus', pubkey),
        isFalse,
      );
      expect(
        AiPaymentTracker.isAiCreditMemo(
          'custom amount (incl. +3% fee) · $short',
          pubkey,
        ),
        isFalse,
      );
    });

    test('another user\'s top-up is rejected', () {
      const other =
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      expect(
        AiPaymentTracker.isAiCreditMemo(
          'NostrFeed AI credits 1k sats · ${other.substring(0, 12)}',
          pubkey,
        ),
        isFalse,
      );
    });

    test('unrelated wallet payments are rejected', () {
      expect(
        AiPaymentTracker.isAiCreditMemo('Coffee refill · $short', pubkey),
        isFalse,
      );
      expect(AiPaymentTracker.isAiCreditMemo('', pubkey), isFalse);
    });
  });
}
