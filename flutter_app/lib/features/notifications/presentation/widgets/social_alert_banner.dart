import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/notifications/application/notification_center.dart';

/// In-app banner for real-time social engagement: "❤️ alice liked your
/// post", "⚡ bob zapped you 21 sats", "🔁 carol reposted your post".
/// Sits above every route (MaterialApp.builder), auto-dismisses, tap →
/// opens the notifications screen.
class SocialAlertBanner extends ConsumerWidget {
  const SocialAlertBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alert = ref.watch(socialAlertProvider);
    if (alert == null) return const SizedBox.shrink();

    final event = alert.event.event;
    final colorScheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';

    final action = NotificationCenter.actionText(event);
    final zapSats = alert.event.zapSats;
    final text = event.kind == 9735 && zapSats > 0
        ? '$name zapped you $zapSats sats'
        : '$name $action';

    final (icon, iconColor) = switch (event.kind) {
      7 => (Icons.favorite_rounded, Colors.redAccent),
      6 || 16 => (Icons.repeat_rounded, Colors.green),
      1 || 1111 => (Icons.chat_bubble_rounded, colorScheme.primary),
      9735 => (Icons.bolt_rounded, Colors.amber),
      3 => (Icons.person_add_alt_1_rounded, colorScheme.primary),
      _ => (Icons.notifications_rounded, colorScheme.primary),
    };

    // Auto-dismiss after a few seconds (only if not replaced by a newer one).
    Future.delayed(const Duration(seconds: 4), () {
      if (ref.read(socialAlertProvider)?.event.event.id == event.id) {
        ref.read(socialAlertProvider.notifier).state = null;
      }
    });

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Material(
          elevation: 8,
          borderRadius: BorderRadius.circular(16),
          color: colorScheme.surfaceContainerHigh,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () {
              ref.read(socialAlertProvider.notifier).state = null;
              // Banner lives ABOVE the router — navigate via routerProvider.
              ref.read(routerProvider).push('/notifications');
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Stack(
                    children: [
                      SafeAvatar(
                        imageUrl: profile?.picture,
                        radius: 20,
                        backgroundColor: colorScheme.primaryContainer,
                        fallback: Text(
                          firstGrapheme(name),
                          style: TextStyle(
                            color: colorScheme.onPrimaryContainer,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      Positioned(
                        right: -2,
                        bottom: -2,
                        child: Container(
                          padding: const EdgeInsets.all(3),
                          decoration: BoxDecoration(
                            color: colorScheme.surfaceContainerHigh,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(icon, size: 12, color: iconColor),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      text,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                        height: 1.25,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
