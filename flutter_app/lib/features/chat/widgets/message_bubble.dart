import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'package:nostrfeed_mobile/features/chat/providers/dm_store.dart';

/// Renders one chat message. The plaintext is already resolved by the
/// [DmStore] (or carried in the local outbox), so the bubble is a pure
/// presentational widget — no async decryption per bubble.
class MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isSent;

  const MessageBubble({super.key, required this.message, required this.isSent});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      message.createdAt * 1000,
    );

    final displayText =
        message.text.isEmpty ? '🔒 Unable to decrypt' : message.text;

    return Align(
      alignment: isSent ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 2),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          gradient: isSent
              ? LinearGradient(
                  colors: [colorScheme.primary, colorScheme.tertiary],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                )
              : null,
          color: isSent ? null : colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(20),
            topRight: const Radius.circular(20),
            bottomLeft: Radius.circular(isSent ? 20 : 6),
            bottomRight: Radius.circular(isSent ? 6 : 20),
          ),
        ),
        child: Column(
          crossAxisAlignment: isSent
              ? CrossAxisAlignment.end
              : CrossAxisAlignment.start,
          children: [
            Text(
              displayText,
              style: TextStyle(
                fontSize: 15,
                height: 1.35,
                color: isSent ? Colors.white : colorScheme.onSurface,
                fontStyle:
                    message.text.isEmpty ? FontStyle.italic : FontStyle.normal,
              ),
            ),
            const SizedBox(height: 3),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  timeago.format(timestamp, locale: 'en_short'),
                  style: TextStyle(
                    fontSize: 10,
                    color: isSent
                        ? Colors.white.withValues(alpha: 0.7)
                        : colorScheme.onSurfaceVariant.withValues(alpha: 0.6),
                  ),
                ),
                if (isSent) ...[
                  const SizedBox(width: 4),
                  Icon(
                    message.isPending
                        ? Icons.schedule_rounded
                        : Icons.lock_rounded,
                    size: 10,
                    color: Colors.white.withValues(alpha: 0.7),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
