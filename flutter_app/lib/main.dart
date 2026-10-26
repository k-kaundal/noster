import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/app.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Bound the decoded-image memory cache (default 1000 imgs / 100 MB).
  // Android gets 96 MB (paired with `android:largeHeap="true"` in the
  // manifest): at 48 MB a couple of tall portrait feed tiles evicted every
  // other decoded image, so they re-decoded mid-scroll — the "scroll gets
  // stuck after a while" jank. iOS stays at 48 MB (no artificial heap cap,
  // 48 never thrashed there). 300 entries is plenty for a viewport + cache
  // extent of display-sized decodes (memCacheWidth keeps each bitmap small).
  PaintingBinding.instance.imageCache.maximumSize = 300;
  PaintingBinding.instance.imageCache.maximumSizeBytes =
      Platform.isAndroid ? 96 << 20 : 48 << 20;
  // Local push notifications (background listener like FB/Insta). The tap →
  // route handler is wired in app.dart once the router exists.
  LocalNotificationService.instance.init();
  runApp(const ProviderScope(child: NostrFeedApp()));
}
