import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Backs up the user's secret key as a file, so they can store it offline
/// (Files app, iCloud Drive, a USB stick, printed QR, password manager…).
///
/// Uses the platform "Save As / Share" sheet:
///  - Android / iOS: `share_plus` share sheet with the key as an attachment
///    (user picks Save to Files, Drive, etc.)
///  - Desktop: `file_picker` Save-As dialog.
///
/// The file contents are JSON with both encodings so any Nostr client can
/// import it:
/// ```json
/// { "nsec": "nsec1…", "hex": "…", "npub": "npub1…", "pubkey": "…" }
/// ```
class KeyBackupService {
  /// Save the key to a user-chosen location. Returns true when the file was
  /// handed off successfully (share sheet completed / save dialog accepted).
  static Future<bool> saveKeyFile({
    required String nsec,
    required String hexPrivateKey,
    required String npub,
    required String pubkey,
  }) async {
    final payload = jsonEncode({
      'app': 'NostrFeed',
      'kind': 'nostr-key-backup',
      'version': 1,
      'created_at': DateTime.now().toIso8601String(),
      'nsec': nsec,
      'hex': hexPrivateKey,
      'npub': npub,
      'pubkey': pubkey,
    });

    final shortPub = pubkey.length >= 8 ? pubkey.substring(0, 8) : pubkey;
    final filename = 'nostrfeed-key-$shortPub.txt';

    if (kIsWeb) {
      // Not supported in this build — web target is out of scope.
      return false;
    }

    if (Platform.isAndroid || Platform.isIOS) {
      // Write to a temp file, then present the OS share sheet so the user
      // can save it to Files/Drive/etc.
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$filename');
      await file.writeAsString(payload);
      final result = await Share.shareXFiles(
        [XFile(file.path)],
        subject: 'NostrFeed key backup',
        text: 'Your NostrFeed secret key backup. Keep it safe and private.',
      );
      // Best-effort cleanup of the temp copy.
      try {
        await file.delete();
      } catch (_) {}
      return result.status == ShareResultStatus.success;
    }

    // Desktop (macOS/Windows/Linux): Save-As dialog.
    final path = await FilePicker.platform.saveFile(
      dialogTitle: 'Save your key backup',
      fileName: filename,
      type: FileType.custom,
      allowedExtensions: ['txt'],
    );
    if (path == null) return false;
    await File(path).writeAsString(payload);
    return true;
  }
}
