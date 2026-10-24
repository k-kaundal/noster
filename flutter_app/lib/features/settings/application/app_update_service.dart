import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:nostrfeed_mobile/core/services/http_helper.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

/// A released app version from the update manifest.
class AppRelease {
  final String version;
  final int buildNumber;
  final String? notes;
  final String? playStoreUrl;
  final String? appStoreUrl;

  const AppRelease({
    required this.version,
    required this.buildNumber,
    this.notes,
    this.playStoreUrl,
    this.appStoreUrl,
  });

  factory AppRelease.fromJson(Map<String, dynamic> j) => AppRelease(
        version: j['version'] as String? ?? '',
        buildNumber: j['buildNumber'] as int? ?? 0,
        notes: j['notes'] as String?,
        playStoreUrl: j['playStoreUrl'] as String?,
        appStoreUrl: j['appStoreUrl'] as String?,
      );
}

/// Soft update check — tells the user a new version exists WITHOUT blocking
/// them (no force update, ever). Fetches a small JSON manifest, compares
/// semantic versions, and exposes the release + direct store link when the
/// running build is older.
///
/// The manifest is a tiny static file the release process writes, e.g.:
/// `https://nostrfeed.com/app-version.json`:
/// ```json
/// {
///   "version": "1.2.0",
///   "buildNumber": 7,
///   "notes": "Multi-account, better discovery, safety upgrades",
///   "playStoreUrl": "https://play.google.com/store/apps/details?id=com.nostrfeed.nostrfeed_mobile",
///   "appStoreUrl": "https://apps.apple.com/app/id1234567890"
/// }
/// ```
/// Offline / fetch failure → no banner (never a false alarm).
class AppUpdateService {
  AppUpdateService._();

  /// The version manifest URL. Override via --dart-define
  /// `UPDATE_MANIFEST_URL` for staging; defaults to the production file.
  static const manifestUrl = String.fromEnvironment(
    'UPDATE_MANIFEST_URL',
    defaultValue: 'https://nostrfeed.com/app-version.json',
  );

  /// Store links (direct, with web fallbacks). The Apple numeric App ID is
  /// filled in once the app is listed on the App Store.
  static const _playId = 'com.nostrfeed.nostrfeed_mobile';
  static const _appleId = ''; // e.g. '1234567890' — set after App Store listing

  static const _kDismissedKey = 'update:dismissed_version';

  /// Fetch the manifest and return the release ONLY when it's genuinely
  /// newer than the running build AND the user hasn't dismissed this exact
  /// version. Returns null on no-update, failure, or already-dismissed.
  static Future<AppRelease?> checkForUpdate({
    String? currentVersion,
    int? currentBuild,
  }) async {
    try {
      final info = await PackageInfo.fromPlatform();
      final localVersion = currentVersion ?? info.version;
      final localBuild =
          currentBuild ?? int.tryParse(info.buildNumber) ?? 0;

      final manifest = await const ApiHttpClient().tryGetJson(
        Uri.parse(manifestUrl),
        headers: {'Cache-Control': 'no-cache'},
      );
      if (manifest == null) return null;
      final release = AppRelease.fromJson(manifest);
      if (release.version.isEmpty) return null;

      if (!isNewer(
        release.version,
        release.buildNumber,
        localVersion,
        localBuild,
      )) {
        return null;
      }

      // Respect a prior dismissal of THIS version (non-blocking).
      if (await isDismissed(release.version)) return null;
      return release;
    } catch (_) {
      return null;
    }
  }

  /// Semantic-version + build comparison: remote is newer when its version
  /// is higher, or equal version with a higher build number.
  static bool isNewer(
    String remoteVersion,
    int remoteBuild,
    String localVersion,
    int localBuild,
  ) {
    final r = _parseVersion(remoteVersion);
    final l = _parseVersion(localVersion);
    for (var i = 0; i < 3; i++) {
      final rv = i < r.length ? r[i] : 0;
      final lv = i < l.length ? l[i] : 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return remoteBuild > localBuild;
  }

  static List<int> _parseVersion(String v) {
    return v
        .split('.')
        .map((p) => int.tryParse(p.replaceAll(RegExp(r'[^0-9].*$'), '')) ?? 0)
        .toList();
  }

  /// Mark a version dismissed so the banner doesn't nag about it again.
  static Future<void> dismiss(String version) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kDismissedKey, version);
    } catch (_) {}
  }

  static Future<bool> isDismissed(String version) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_kDismissedKey) == version;
    } catch (_) {
      return false;
    }
  }

  /// The direct store URL for the current platform (manifest override wins,
  /// else the platform default). Opens the store listing directly.
  static String storeUrl(AppRelease release) {
    if (kIsWeb) return release.playStoreUrl ?? release.appStoreUrl ?? '';
    if (Platform.isAndroid) {
      return release.playStoreUrl ??
          'https://play.google.com/store/apps/details?id=$_playId';
    }
    if (Platform.isIOS) {
      return release.appStoreUrl ??
          (_appleId.isNotEmpty
              ? 'https://apps.apple.com/app/id$_appleId'
              : 'https://apps.apple.com/search?term=NostrFeed');
    }
    return release.playStoreUrl ?? release.appStoreUrl ?? '';
  }

  /// Open the store listing for the release (direct link, web fallback).
  static Future<void> openStore(AppRelease release) async {
    final url = storeUrl(release);
    if (url.isEmpty) return;
    final uri = Uri.parse(url);
    try {
      // On Android prefer the Play Store app (market://) for a direct open.
      if (!kIsWeb && Platform.isAndroid) {
        final market = Uri.parse('market://details?id=$_playId');
        if (await canLaunchUrl(market)) {
          await launchUrl(market, mode: LaunchMode.externalApplication);
          return;
        }
      }
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {
      // A failed store open is non-fatal — the banner just stays.
    }
  }
}
