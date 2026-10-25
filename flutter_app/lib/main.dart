import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/app.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Bound the decoded-image memory cache (default 1000 imgs / 100 MB). On a
  // memory-constrained Android phone an unbounded image cache + a long feed
  // session = GC pressure → the "scroll gets stuck after a while" jank.
  // 48 MB / 300 images is plenty for a viewport + cache extent of
  // display-sized decodes (memCacheWidth keeps each bitmap small).
  PaintingBinding.instance.imageCache.maximumSize = 300;
  PaintingBinding.instance.imageCache.maximumSizeBytes = 48 << 20; // 48 MB
  // Local push notifications (background listener like FB/Insta). The tap →
  // route handler is wired in app.dart once the router exists.
  LocalNotificationService.instance.init();
  runApp(const ProviderScope(child: NostrFeedApp()));
}
