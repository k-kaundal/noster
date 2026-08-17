import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { explainZapReceipt, satsFromBolt11 } from './zap';
import { summarizeZaps } from './zapSummary';

/**
 * A real receipt from ln.nostrfeed.com that the app would not count.
 *
 * Captured off the wire, unedited. Everything else about zaps in this
 * repository is tested against events built here, which is why this fault
 * survived several rounds of looking: the receipt was fine, the note was fine,
 * the relay was fine, and the check that rejected it was one nobody could see.
 *
 * Kept as a fixture because the shape is what matters — an LNbits receipt
 * where the sender, the pay link's `nostrPubkey` and therefore the receipt's
 * own pubkey are all the same key, which is a combination no invented fixture
 * would have produced.
 */
const RECEIPT: NostrEvent = {
  content: '',
  created_at: 1786987368,
  id: 'b52b679f1c343ff358f919f73f2f0def530d1f6b0d38df10ccc3b6e5aa5db050',
  kind: 9735,
  pubkey: 'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6',
  sig: '2bf065c60802648aaa284007b643adbfc11e767d7206806f5922980c62cb41a7d3dee2689b9cfad564dedafafda8e8d4ffe92178dbceed8308e55f4f08c6d5c0',
  tags: [
    ['p', '8aab978f1d405c1b29ad9a4780363096b2e9560366e6212a8ae4d890882b9a54'],
    ['e', '79a65d180ab341e5f9e6a55ec7f45573624c1af3567752d69cc88f0b62c05573'],
    [
      'bolt11',
      'lnbc500n1p4gx0cwpp5jght4h7a9kz36gye94pu5ays7uvgj4tvsqlc6l568vuymh6gpl2qcqzyssp5xces6v37emexvjrxd7u0c0y383f50herzy0c6n6jgl8xn69qljts9q7sqqqqqqqqqqqqqqqqqqqsqqqqqysgqhp54g4e54087l64k6l5mwfdcgfnx8r9zwn2jyrgfqe508g78cjrct9smqz9gxqrrssrzjqwryaup9lh50kkranzgcdnn2fgvx390wgj5jd07rwr3vxeje0glclllc9ma0u3h3ksqqqqlgqqqqqeqqjqu8mqarupjzs66sfpgfwtkay39hu9ac90jwdp7dxdjxsdtk86ypphnu55ehx52s9w8aee6a33ye55vn4965tyk0x8t76cdemzj0r205sq4vkmze',
    ],
    [
      'description',
      '{"kind":9734,"content":"Great post","tags":[["relays","wss://relay.primal.net","wss://relay.nostrfeed.com","wss://relay.nostr.band","wss://nos.lol","wss://nostr.wine"],["amount","50000"],["p","8aab978f1d405c1b29ad9a4780363096b2e9560366e6212a8ae4d890882b9a54"],["lnurl","lnurl1dp68gurn8ghj7mrw9ehx7um5wfnx2ety9e3k7mf09emk2mrv944kummhdchkcmn4wfk8qtmhv9kxcet5qyt3r2"],["e","79a65d180ab341e5f9e6a55ec7f45573624c1af3567752d69cc88f0b62c05573"],["k","1"]],"created_at":1786986253,"pubkey":"f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6","id":"acdb98c099fdf52e7e626863c86e86708673a374817305d807337c28aaebaece","sig":"875bb5123fb73e6a2da7aae61cea3f762cf7066374a68778fbdda3733998cac7cffc4a81d716ee931ebdf7a5f6141fccce5d54d5363b2bf1a0a52a4037d3a9dc"}',
    ],
  ],
};

const NOTE = '79a65d180ab341e5f9e6a55ec7f45573624c1af3567752d69cc88f0b62c05573';
const AUTHOR = '8aab978f1d405c1b29ad9a4780363096b2e9560366e6212a8ae4d890882b9a54';

/** The `nostrPubkey` the pay link this was sent to reports. */
const PROVIDER = 'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6';

describe('a real ln.nostrfeed.com receipt', () => {
  it('reads 50 sats out of the invoice', () => {
    /*
     * `amount` is in millisats — 50000 msat is 50 sats, not 50,000 — and the
     * invoice says `500n`, which is also 50. They agree, which is the point:
     * the amount check was a suspect and is not the culprit.
     */
    expect(satsFromBolt11(RECEIPT.tags[2][1])).toBe(50);
  });

  it('passes every check the note page applies', () => {
    expect(
      explainZapReceipt(RECEIPT, {
        eventId: NOTE,
        recipientPubkey: [AUTHOR],
        providerPubkey: [PROVIDER],
      })
    ).toBeNull();
  });

  it('passes when the provider is not known yet', () => {
    // An address this browser has never paid is judged on the other checks
    expect(
      explainZapReceipt(RECEIPT, { eventId: NOTE, recipientPubkey: [AUTHOR] })
    ).toBeNull();
  });

  it('is refused when checked against another address key', () => {
    /*
     * This is the fault, reproduced. The provider table used to be keyed by
     * domain, so a key learned from one pay link on ln.nostrfeed.com was
     * applied to receipts from every other pay link on the same host — and
     * this receipt, sent to `wallet@`, was checked against whatever key `kk@`
     * or `help@` had last reported. It is keyed by address now.
     */
    expect(
      explainZapReceipt(RECEIPT, {
        eventId: NOTE,
        recipientPubkey: [AUTHOR],
        providerPubkey: ['bad5595b406b685a64e997503b61ba1be88b39f20aebb0cf0dc151d17b0bee33'],
      })
    ).toBe('wrong-provider');
  });

  it('counts 50 sats on the note', () => {
    const summary = summarizeZaps([RECEIPT], {
      eventId: NOTE,
      recipientPubkey: [AUTHOR],
      providerPubkey: [PROVIDER],
    });

    expect(summary.count).toBe(1);
    expect(summary.totalSats).toBe(50);
    expect(summary.rejected).toEqual([]);
  });
});
