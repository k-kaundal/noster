import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/dm_crypto_worker.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';

void main() {
  final auth = AuthService();
  // Two parties: me (recipient) and the peer (sender).
  late final String myPriv, myPub, peerPriv, peerPub;

  setUpAll(() {
    final me = auth.generateEphemeralKeypair();
    myPriv = me.priv;
    myPub = me.pub;
    final peer = auth.generateEphemeralKeypair();
    peerPriv = peer.priv;
    peerPub = peer.pub;
  });

  DmDecryptJob jobFor(NostrEvent e, {String? content}) => DmDecryptJob(
        eventId: e.id,
        kind: e.kind,
        pubkey: e.pubkey,
        content: content ?? e.content,
        createdAt: e.createdAt,
        tags: e.tags,
        privateKey: myPriv,
        myPubkey: myPub,
      );

  group('decryptDmJob (pure sync path)', () {
    test('NIP-04 (kind 4): peer → me decrypts to the plaintext', () {
      final event = auth.signDmEvent(
        privateKey: peerPriv,
        peerPubkey: myPub,
        plaintext: 'hello from peer',
      );
      expect(event.kind, 4);
      final r = decryptDmJob(jobFor(event));
      expect(r, isNotNull);
      expect(r!.plaintext, 'hello from peer');
      expect(r.senderPubkey, peerPub);
      expect(r.rumorKind, 14);
    });

    test('NIP-04: wrong key fails closed (null, never throws)', () {
      final event = auth.signDmEvent(
        privateKey: peerPriv,
        peerPubkey: myPub,
        plaintext: 'secret',
      );
      final wrong = auth.generateEphemeralKeypair();
      final r = decryptDmJob(DmDecryptJob(
        eventId: event.id,
        kind: 4,
        pubkey: event.pubkey,
        content: event.content,
        createdAt: event.createdAt,
        tags: event.tags,
        privateKey: wrong.priv, // not the recipient
        myPubkey: wrong.pub,
      ));
      expect(r, isNull);
    });

    test('NIP-17 (kind 1059): gift wrap → rumor decrypts end-to-end', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: peerPriv,
        senderPubkey: peerPub,
        recipientPubkey: myPub,
        plaintext: 'nip17 hi',
      );
      // wraps[0] = recipient copy, wraps[1] = sender copy. Decrypt the
      // RECIPIENT copy with my key.
      final r = decryptDmJob(jobFor(wraps[0]));
      expect(r, isNotNull);
      expect(r!.plaintext, 'nip17 hi');
      expect(r.senderPubkey, peerPub);
      expect(r.recipientPubkey, myPub); // rumor p-tag
    });

    test('NIP-17 sender copy decrypts for the SENDER (self-copy)', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: peerPriv,
        senderPubkey: peerPub,
        recipientPubkey: myPub,
        plaintext: 'from me',
      );
      // The sender copy (wraps[1]) is encrypted to the SENDER — decrypt with
      // the PEER's key (they are the sender here).
      final r = decryptDmJob(DmDecryptJob(
        eventId: wraps[1].id,
        kind: 1059,
        pubkey: wraps[1].pubkey,
        content: wraps[1].content,
        createdAt: wraps[1].createdAt,
        tags: wraps[1].tags,
        privateKey: peerPriv, // sender
        myPubkey: peerPub,
      ));
      expect(r, isNotNull);
      expect(r!.plaintext, 'from me');
      expect(r.senderPubkey, peerPub);
    });

    test('NIP-17: a tampered wrap fails closed', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: peerPriv,
        senderPubkey: peerPub,
        recipientPubkey: myPub,
        plaintext: 'x',
      );
      final r = decryptDmJob(jobFor(wraps[0], content: 'AAAA' + wraps[0].content.substring(4)));
      expect(r, isNull);
    });

    test('a kind-15 file message surfaces its MIME type', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: peerPriv,
        senderPubkey: peerPub,
        recipientPubkey: myPub,
        plaintext: 'https://example.com/img.jpg',
        kind: 15,
        extraTags: [
          ['m', 'image/jpeg'],
        ],
      );
      final r = decryptDmJob(jobFor(wraps[0]));
      expect(r, isNotNull);
      expect(r!.rumorKind, 15);
      expect(r.mimeType, 'image/jpeg');
    });

    test('non-DM kinds return null', () {
      final r = decryptDmJob(DmDecryptJob(
        eventId: 'x',
        kind: 1, // a post, not a DM
        pubkey: peerPub,
        content: 'hi',
        createdAt: 0,
        tags: const [],
        privateKey: myPriv,
        myPubkey: myPub,
      ));
      expect(r, isNull);
    });
  });

  group('DmCryptoWorker (worker isolate pool)', () {
    test('decrypts a NIP-17 wrap off the UI isolate', () async {
      final worker = DmCryptoWorker();
      addTearDown(worker.dispose);
      final wraps = auth.signGiftWrap(
        senderPrivateKey: peerPriv,
        senderPubkey: peerPub,
        recipientPubkey: myPub,
        plaintext: 'off-thread',
      );
      final r = await worker.decrypt(jobFor(wraps[0]));
      expect(r, isNotNull);
      expect(r!.plaintext, 'off-thread');
      expect(r.senderPubkey, peerPub);
    });

    test('a batch of mixed kind-4 + kind-1059 decrypts without loss', () async {
      final worker = DmCryptoWorker();
      addTearDown(worker.dispose);
      const n = 20;
      final futures = <Future<DmDecryptResult?>>[];
      for (var i = 0; i < n; i++) {
        if (i.isEven) {
          final e = auth.signDmEvent(
            privateKey: peerPriv,
            peerPubkey: myPub,
            plaintext: 'nip04 #$i',
          );
          futures.add(worker.decrypt(jobFor(e)));
        } else {
          final wraps = auth.signGiftWrap(
            senderPrivateKey: peerPriv,
            senderPubkey: peerPub,
            recipientPubkey: myPub,
            plaintext: 'nip17 #$i',
          );
          futures.add(worker.decrypt(jobFor(wraps[0])));
        }
      }
      final results = await Future.wait(futures);
      expect(results, hasLength(n));
      for (var i = 0; i < n; i++) {
        expect(results[i], isNotNull, reason: 'job $i failed');
        final want = i.isEven ? 'nip04 #$i' : 'nip17 #$i';
        expect(results[i]!.plaintext, want);
      }
    }, timeout: const Timeout(Duration(seconds: 60)));
  });
}
