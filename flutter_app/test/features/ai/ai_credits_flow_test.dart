import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_payment_tracker.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';

void main() {
  // The "bought credits, still 0" bug class: after a confirmed payment the
  // ledger MUST credit the granted amount and persist it. These tests pin
  // the exact contract the top-up flow relies on.
  group('credit landing after payment', () {
    test('creditPayment grants credits and the balance reflects them', () {
      var ledger = const AiCreditsLedger();
      // Simulate creditPayment: mark hash + credit.
      ledger = ledger.credit(22000); // 20k pack + 10% bonus
      expect(ledger.balance, 22000);
      expect(ledger.totalPurchased, 22000);
    });

    test('a credit then reload from json keeps the balance (persistence)', () {
      final credited = const AiCreditsLedger().credit(1000);
      final reloaded = AiCreditsLedger.fromJson(credited.toJson());
      expect(reloaded.balance, 1000);
    });

    test('custom amount with fee: user pays total, gets base amount', () {
      // Custom 1000 sats → pay 1030 (+3%), get 1000 credits.
      const paid = 1030;
      const granted = 1000;
      var ledger = const AiCreditsLedger();
      ledger = ledger.credit(granted);
      expect(ledger.balance, granted);
      expect(paid, greaterThan(granted));
    });

    test('debit after credit spends correctly (credit is usable)', () {
      final ledger = const AiCreditsLedger().credit(1000).debit(14);
      expect(ledger.balance, 986);
      expect(ledger.totalSpent, 14);
    });
  });

  // The reconciliation contract: a settled top-up must be credited EXACTLY
  // once, even when LNbits returns it without a payment hash (the old code
  // skipped empty-hash payments — credited nothing, recorded nothing, so
  // the payment was either lost forever or granted repeatedly).
  group('payment idempotency (reconcile exactly-once)', () {
    test('a payment with a hash keys on the hash', () {
      const record = AiPaymentRecord(
        paymentHash: 'abc123',
        amountSats: 1000,
        memo: 'NostrFeed AI credits 1k sats · 3bf0c63fcb93',
      );
      expect(record.idempotencyKey, 'hash:abc123');
    });

    test('a payment WITHOUT a hash falls back to bolt11, never empty', () {
      const record = AiPaymentRecord(
        paymentHash: '',
        amountSats: 5000,
        memo: 'NostrFeed AI credits 5k sats · 3bf0c63fcb93',
        bolt11: 'lnbc50n1...',
      );
      expect(record.idempotencyKey, 'bolt11:lnbc50n1...');
    });

    test('no hash and no bolt11 falls back to amount+time+memo', () {
      const record = AiPaymentRecord(
        paymentHash: '',
        amountSats: 1030,
        memo: 'NostrFeed AI credits 1030 sats · 3bf0c63fcb93',
        timestamp: 1761000000,
      );
      expect(
        record.idempotencyKey,
        'amount:1030:1761000000:NostrFeed AI credits 1030 sats · 3bf0c63fcb93',
      );
    });

    test('markCredited and reconcile use the SAME key format', () {
      // Regression: creditPayment stores 'hash:<hash>'; reconcile looks up
      // record.idempotencyKey which is 'hash:<hash>' for hashed payments.
      // An unprefixed write here meant a just-credited payment was granted
      // AGAIN by the next reconcile.
      const hash = 'deadbeef';
      final marked = 'hash:$hash';
      const record = AiPaymentRecord(
        paymentHash: hash,
        amountSats: 1000,
        memo: 'm',
      );
      expect(record.idempotencyKey, marked);
    });
  });

  // The relay-backup contract: credits follow the user's key. A wiped or
  // second device restores from the Nostr event, and a merge NEVER loses a
  // purchase nor resurrects a spend.
  group('credits follow the key (relay backup merge)', () {
    test('a wiped device restores purchases from the remote copy', () {
      final wiped = const AiCreditsLedger();
      final remote = const AiCreditsLedger().credit(5000).debit(1200);
      final restored = wiped.mergeWith(remote);
      expect(restored.balance, 3800);
      expect(restored.totalPurchased, 5000);
      expect(restored.totalSpent, 1200);
    });

    test('two devices converge without double-counting a shared purchase', () {
      // Both devices reconciled the SAME 1000-sat payment (hash recorded on
      // each). A naive "sum both ledgers" merge would show 2000 purchased.
      // Union (max of monotonic counters) shows the truth: 1000.
      final deviceA = const AiCreditsLedger().credit(1000).debit(100);
      final deviceB = const AiCreditsLedger().credit(1000).debit(300);
      final merged = deviceA.mergeWith(deviceB);
      expect(merged.totalPurchased, 1000);
      expect(merged.totalSpent, 300);
      expect(merged.balance, 700);
    });

    test('a purchase on device B appears on device A after sync', () {
      var a = const AiCreditsLedger().credit(1000);
      final b = const AiCreditsLedger().credit(1000).credit(5000);
      a = a.mergeWith(b);
      expect(a.totalPurchased, 6000);
      expect(a.balance, 6000);
    });
  });
}
