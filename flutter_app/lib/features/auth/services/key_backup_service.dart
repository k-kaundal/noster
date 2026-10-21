import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Backs up the user's secret key as a file, so they can store it offline
/// (Files app, iCloud Drive, a USB stick, printed QR, password manager…).
///
/// The save path, per platform:
///  - iOS / Android: `FilePicker.platform.saveFile`. This is the important
///    one — the OLD path used `share_plus`'s share sheet, which on iOS often
///    never offers "Save to Files" for a `.txt`, and returns
///    `ShareResultStatus.success` even when the sheet was dismissed, so the
///    app said "saved" about a file nobody got. `saveFile` on iOS 14+ opens
///    the real Files save dialog, and on Android opens the system
///    Storage-Access-Framework picker (Downloads / Drive).
///  - Desktop: same `saveFile` Save-As dialog.
///
/// The file contents are JSON with both encodings so any Nostr client can
/// import it:
/// ```json
/// { "nsec": "nsec1…", "hex": "…", "npub": "npub1…", "pubkey": "…" }
/// ```
class KeyBackupService {
  /// Save the key to a user-chosen location. Returns true when the file was
  /// actually written somewhere the user chose.
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
    final bytes = Uint8List.fromList(utf8.encode(payload));

    if (kIsWeb) {
      // Not supported in this build — web target is out of scope.
      return false;
    }

    // Every platform: the system Save-As / Save-to-Files dialog, with the
    // contents written by the picker itself (iOS/Android need `bytes` —
    // file_picker on mobile writes the file from bytes, not a path).
    try {
      final path = await FilePicker.saveFile(
        dialogTitle: 'Save your key backup',
        fileName: filename,
        type: FileType.custom,
        allowedExtensions: ['txt'],
        bytes: bytes,
      );
      // null = user cancelled the dialog — a clean "not saved", not an error.
      if (path == null) return false;

      // Desktop wrote nothing (saveFile returns the location only) — write
      // it. On iOS/Android file_picker writes the bytes itself, and on some
      // of those the returned URI is a content:// one we must NOT re-write.
      if (!Platform.isAndroid && !Platform.isIOS) {
        await File.fromUri(path).writeAsBytes(bytes, flush: true);
      }
      return true;
    } catch (_) {
      // file_picker can throw on some Android builds where saveFile isn't
      // implemented — fall back to the OS share sheet as a last resort.
      if (Platform.isAndroid || Platform.isIOS) {
        return _shareFallback(filename, bytes);
      }
      rethrow;
    }
  }

  /// Last-resort: the OS share sheet with the key as an attachment. Used only
  /// when `saveFile` throws — on iOS this is unreliable for `.txt`, which is
  /// exactly why it is the fallback and not the main path.
  static Future<bool> _shareFallback(String filename, Uint8List bytes) async {
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$filename');
      await file.writeAsBytes(bytes, flush: true);
      final result = await Share.shareXFiles(
        [XFile(file.path)],
        subject: 'NostrFeed key backup',
        text: 'Your NostrFeed secret key backup. Keep it safe and private.',
      );
      try {
        await file.delete();
      } catch (_) {}
      return result.status == ShareResultStatus.success;
    } catch (_) {
      return false;
    }
  }
}
