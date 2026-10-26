import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/db_encryption.dart';

/// ADR-0008 P7: the database encryption key service (the SQLCipher driver
/// itself ships when pub.dev is reachable — the key management is the
/// testable part today).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final storage = <String, String?>{};
  const channel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  setUp(() {
    storage.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
      final args = call.arguments as Map?;
      switch (call.method) {
        case 'read':
          return storage[args?['key'] as String];
        case 'write':
          storage[args?['key'] as String] = args?['value'] as String?;
          return null;
        case 'delete':
          storage.remove(args?['key'] as String);
          return null;
        default:
          return null;
      }
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('databaseKey generates a 64-hex key once and reuses it', () async {
    final keys = DbEncryptionKeys();
    final k1 = await keys.databaseKey();
    expect(k1.length, 64);
    expect(RegExp(r'^[0-9a-f]{64}$').hasMatch(k1), isTrue);
    // Second call returns the SAME key (persisted, not regenerated).
    final k2 = await keys.databaseKey();
    expect(k2, k1);
  });

  test('rotate produces a DIFFERENT key', () async {
    final keys = DbEncryptionKeys();
    final k1 = await keys.databaseKey();
    final k2 = await keys.rotate();
    expect(k2, isNot(k1));
    expect(k2.length, 64);
    // rotate persists — a fresh read sees the new key.
    expect(await keys.databaseKey(), k2);
  });

  test('destroy wipes the key (next call regenerates fresh)', () async {
    final keys = DbEncryptionKeys();
    final k1 = await keys.databaseKey();
    await keys.destroy();
    final k2 = await keys.databaseKey();
    expect(k2, isNot(k1)); // destroyed → regenerated
  });

  test('dbEncryptionEnabled defaults to false (plain open, zero risk)', () {
    // The build flag is OFF unless --dart-define=DB_ENCRYPTION=true.
    expect(dbEncryptionEnabled, isFalse);
  });

  test('migrationNotes documents the SQLCipher export path', () {
    expect(migrationNotes, contains('sqflite_sqlcipher'));
    expect(migrationNotes, contains('password'));
  });
}
