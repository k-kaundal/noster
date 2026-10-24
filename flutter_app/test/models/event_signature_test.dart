import 'package:bip340/bip340.dart' as bip340;
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

void main() {
  final priv = 'c' * 64;
  late final String pub;
  late final String id;
  late final String sig;
  const createdAt = 1700000000;
  const kind = 1;
  final tags = <List<String>>[];
  const content = 'hello world';

  setUpAll(() {
    pub = bip340.getPublicKey(priv);
    id = NostrEvent.computeId(pub, createdAt, kind, tags, content);
    sig = bip340.sign(priv, id, randomHex(32));
  });

  NostrEvent mk({String? idO, String? sigO, String? contentO}) => NostrEvent(
        id: idO ?? id,
        pubkey: pub,
        createdAt: createdAt,
        kind: kind,
        tags: tags,
        content: contentO ?? content,
        sig: sigO ?? sig,
      );

  test('a genuinely signed event is valid', () {
    expect(mk().isValid, isTrue);
  });

  test('a relay-tampered content is rejected (id no longer commits)', () {
    expect(mk(contentO: 'TAMPERED BY RELAY').isValid, isFalse);
  });

  test('a wrong signature is rejected', () {
    expect(mk(sigO: '0' * 128).isValid, isFalse);
  });

  test('a mismatched id is rejected', () {
    expect(mk(idO: 'a' * 64).isValid, isFalse);
  });

  test('malformed input returns false, never throws', () {
    expect(mk(sigO: 'not-a-sig').isValid, isFalse);
    expect(mk(idO: 'short').isValid, isFalse);
  });
}
