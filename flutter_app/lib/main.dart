import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/app.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Local push notifications (background listener like FB/Insta). The tap →
  // route handler is wired in app.dart once the router exists.
  LocalNotificationService.instance.init();
  runApp(const ProviderScope(child: NostrFeedApp()));
}
