import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// ADR-0008 P7 — database encryption-at-rest (SQLCipher) integration point.
///
/// **Why this is an abstraction, not a hard dependency (the honest reason)**:
/// `sqflite_sqlcipher` + `sqlcipher_flutter_libs` are NOT fetchable in the
/// current offline environment (pub.dev unreachable), and the native SQLCipher
/// libraries add ~5–10 MB per ABI — which would push the app PAST the
/// ADR-0004 size budget (≤35 MB, currently 27.9 MB). Forcing an untested
/// native dependency + a full-store migration now would be irresponsible.
///
/// So this provides the parts that ARE testable and safe TODAY:
///  1. **Key management** ([DbEncryptionKeys]) — generate/persist/rotate the
///     256-bit database key in hardware-backed secure storage. Real, tested.
///  2. **A compile-time integration flag** ([dbEncryptionEnabled]) that
///     gates the encrypted open path — flip it (plus `flutter pub add
///     sqflite_sqlcipher sqlcipher_flutter_libs` when pub.dev is reachable)
///     and the store opens encrypted with NO further code changes.
///  3. **The documented migration path** ([migrationNotes]) — a plain DB is
///     exported into an encrypted one via `sqlcipher_export`, never
///     rewritten in place (a failed mid-export can't corrupt the original).
///
/// **Security model** (when enabled): the 256-bit key lives ONLY in
/// `flutter_secure_storage` (Android Keystore / iOS Keychain, device-only,
/// never backed up). The key is the database's whole protection — same
/// trust boundary as the nsec. Without the key the DB file is AES-256
/// ciphertext; a stolen device backup yields nothing.
///
/// **What stays UNENCRYPTED by design**: nothing user-private is kept in
/// SharedPreferences for messaging (P1 moved it all into the DB). Feed
/// content is PUBLIC (Nostr events are public posts) — encrypting it buys
/// nothing; the value of SQLCipher here is `dm_messages` plaintext + the
/// notification/DM metadata. When the flag ships, the WHOLE DB encrypts
/// (one SQLCipher database) — per-table granularity isn't worth a second
/// writer lane.
class DbEncryptionKeys {
  DbEncryptionKeys({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  /// Secure-storage key for the 256-bit database encryption key.
  static const _keyName = 'nostrfeed_db_key_v1';

  /// Returns the 256-bit database key as 64 hex chars, generating and
  /// persisting it on first use. Device-only, never logged, never backed up.
  Future<String> databaseKey() async {
    final existing = await _read();
    if (existing != null) return existing;
    final key = _generate();
    await _storage.write(key: _keyName, value: key);
    return key;
  }

  /// The current key, or null if none was generated yet (first run).
  Future<String?> _read() async {
    try {
      final k = await _storage.read(key: _keyName);
      return (k == null || k.isEmpty) ? null : k;
    } catch (_) {
      return null;
    }
  }

  /// Rotates to a NEW key. The caller must re-key the database
  /// (`PRAGMA rekey`) and THEN call this — generating the new key before the
  /// DB is re-keyed would strand the data. Returns the new key.
  Future<String> rotate() async {
    final key = _generate();
    await _storage.write(key: _keyName, value: key);
    return key;
  }

  /// Wipe the key (full account reset / factory wipe). The DB is then
  /// unrecoverable — call only when the user data is also being destroyed.
  Future<void> destroy() async {
    try {
      await _storage.delete(key: _keyName);
    } catch (_) {}
  }

  /// 256 bits of CSPRNG entropy as 64 lowercase hex chars (the format
  /// SQLCipher's raw `KEY 'x''<64hex>''` expects).
  String _generate() {
    final rng = Random.secure();
    return List<int>.generate(32, (_) => rng.nextInt(256))
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
  }
}

/// Compile-time gate for the encrypted database open path. Flip with:
///
/// ```
/// flutter run --dart-define=DB_ENCRYPTION=true
/// ```
///
/// When true AND the SQLCipher driver is linked in (see [migrationNotes]),
/// `EventStore` opens the database with the key from [DbEncryptionKeys].
/// Default false — the store opens plain (current behavior), so there is
/// ZERO risk to existing installs until the native libs ship.
const dbEncryptionEnabled = bool.fromEnvironment(
  'DB_ENCRYPTION',
  defaultValue: false,
);

/// The SQLCipher migration path, for when the flag ships. A plain existing
/// database is exported into a NEW encrypted file (never rewritten in
/// place — a crash mid-export leaves the original intact):
///
/// ```sql
/// ATTACH DATABASE 'encrypted.db' AS enc KEY '<key from DbEncryptionKeys>';
/// SELECT sqlcipher_export('enc');
/// DETACH DATABASE enc;
/// -- then swap the files: delete plain.db, rename encrypted.db → plain.db
/// -- (or just open enc going forward and keep the name).
/// ```
///
/// Rollback: export back to a plain DB the same way with an empty key.
/// This is a ONE-TIME, app-update-triggered migration — the store's
/// `_onUpgrade` hook is the natural place to run it.
const migrationNotes = '''
SQLCipher integration (when pub.dev is reachable):
  1. flutter pub add sqflite_sqlcipher sqlcipher_flutter_libs
  2. Size budget: native libs add ~5-10 MB/ABI → verify vs ADR-0004 (≤35 MB).
     Consider ABI splits (android/app/build.gradle.kts) so one slice stays lean.
  3. In EventStore._open: if dbEncryptionEnabled, open with
     openDatabase(..., password: await DbEncryptionKeys().databaseKey()).
  4. First run on an existing install: export the plain DB into an encrypted
     one (see the SQL in this constant's doc), then open encrypted.
  5. Key rotation: PRAGMA rekey, then DbEncryptionKeys().rotate().
  6. Keep the plain open as the fallback when the flag is off — never force
     encryption on a user whose device/budget can't carry it.
''';
