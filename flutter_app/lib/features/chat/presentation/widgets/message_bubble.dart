import 'package:flutter/material.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';

/// Renders one chat message. The plaintext is already resolved by the
/// [DmStore] (or carried in the local outbox), so the bubble is a pure
/// presentational widget — no async decryption per bubble.
///
/// Outgoing messages show a delivery tick: clock (sending), single tick
/// (delivered to a relay), error (failed — tap to retry).
///
/// Bubble shape + colors follow Primal's `ChatMessageListItem`: an 8 dp
/// bubble whose corner nearest the sender drops to a 2 dp "tail" — the
/// tail is only on the FIRST message of a group (a run of messages from
/// the same sender); continuations get the tail on the FOLLOWING edge.
/// Mine = `colorScheme.tertiary` (Primal `#0C7DD8`) with white text;
/// theirs = muted surface with onSurface text.
class MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isSent;

  /// Whether the NEXT message in the list (older in time — the list is
  /// reversed) is from the same sender, i.e. this message continues a
  /// group. Drives Primal's grouped-corner shape.
  final bool isGroupContinuation;

  /// Called when the user taps a FAILED outgoing message (to retry).
  final VoidCallback? onRetry;

  /// Called when the user long-presses a FAILED outgoing message (to delete).
  final VoidCallback? onDelete;

  /// Called when the user long-presses a normal message (copy/share sheet —
  /// mirrors the AI chat bubble actions).
  final VoidCallback? onLongPress;

  const MessageBubble({
    super.key,
    required this.message,
    required this.isSent,
    this.isGroupContinuation = false,
    this.onRetry,
    this.onDelete,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      message.createdAt * 1000,
    );

    final displayText =
        message.text.isEmpty ? '🔒 Unable to decrypt' : message.text;
    final failed = message.status == MessageStatus.failed;
    final isImageMsg = message.isImage && message.text.startsWith('http');

    // Primal's grouped bubble corners (8 dp, tail corner 2 dp):
    //  - first-in-group: tail on the BOTTOM edge near the sender
    //    (mine: bottomEnd; theirs: bottomStart)
    //  - continuation: tail on the TOP edge near the sender instead.
    const r = Radius.circular(8);
    const tail = Radius.circular(2);
    final borderRadius = isSent
        ? BorderRadius.only(
            topLeft: r,
            topRight: isGroupContinuation ? tail : r,
            bottomLeft: r,
            bottomRight: isGroupContinuation ? r : tail,
          )
        : BorderRadius.only(
            topLeft: isGroupContinuation ? tail : r,
            topRight: r,
            bottomLeft: isGroupContinuation ? r : tail,
            bottomRight: r,
          );

    final metaColor = isSent
        ? Colors.white.withValues(alpha: 0.75)
        : colorScheme.onSurfaceVariant.withValues(alpha: 0.7);

    final bubble = Align(
      alignment: isSent ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        // Tight gap INSIDE a same-sender run; a clear break above a new
        // sender's first bubble (WhatsApp group rhythm).
        margin: EdgeInsets.only(
          top: isGroupContinuation ? 1.5 : 8,
          bottom: 1.5,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          // Same 0.82 max width as the AI chat bubbles.
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        decoration: BoxDecoration(
          // Primal: mine = flat tertiary (#0C7DD8), theirs = muted surface —
          // no gradient (flat is what makes their chat read "native").
          color: isSent ? colorScheme.tertiary : colorScheme.surfaceContainerHighest,
          borderRadius: borderRadius,
        ),
        child: Column(
          // Hug the content: the column sizes to its widest child, so a
          // short "hi" gets a small bubble (an Align wrapper here would
          // expand to the max width and stretch every bubble).
          crossAxisAlignment: isSent
              ? CrossAxisAlignment.end
              : CrossAxisAlignment.start,
          children: [
            // Kind-15 image message: render the image inline, no URL text.
            if (isImageMsg)
              ClipRRect(
                borderRadius: AppShapes.radiusMd,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 280),
                  child: Image.network(
                    message.text,
                    fit: BoxFit.contain,
                    loadingBuilder: (context, child, progress) =>
                        progress == null
                            ? child
                            : Container(
                                height: 120,
                                width: 200,
                                color: colorScheme.surfaceContainer,
                                child: const Center(
                                  child: CircularProgressIndicator(),
                                ),
                              ),
                    errorBuilder: (_, _, _) => Text(
                      displayText,
                      style: TextStyle(
                        fontSize: 15,
                        color:
                            isSent ? Colors.white : colorScheme.onSurface,
                      ),
                    ),
                  ),
                ),
              )
            else if (message.isFile)
              // Non-image file message: a compact file chip, not a raw URL.
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.insert_drive_file_outlined,
                    size: 18,
                    color: isSent ? Colors.white : colorScheme.primary,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      message.mimeType ?? 'File',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        color: isSent ? Colors.white : colorScheme.onSurface,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                ],
              )
            else
              Text(
                displayText,
                // Same bodyLarge reading style as the AI chat bubbles.
                style: textTheme.bodyLarge?.copyWith(
                  color: isSent ? Colors.white : colorScheme.onSurface,
                  fontStyle: message.text.isEmpty
                      ? FontStyle.italic
                      : FontStyle.normal,
                ),
              ),
            const SizedBox(height: 2),
            // Meta row: HH:mm clock time (WhatsApp/Telegram style) + the
            // delivery tick for outgoing messages.
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _formatTime(timestamp),
                  style: textTheme.labelSmall?.copyWith(
                    fontSize: 10,
                    color: metaColor,
                  ),
                ),
                if (isSent) ...[
                  const SizedBox(width: 4),
                  _DeliveryIcon(status: message.status),
                ],
              ],
            ),
          ],
        ),
      ),
    );

    // Failed messages are tappable (retry) and long-pressable (delete).
    if (failed && (onRetry != null || onDelete != null)) {
      return GestureDetector(
        onTap: onRetry,
        onLongPress: onDelete,
        child: bubble,
      );
    }
    // Normal messages: long-press → copy/share actions (AI chat parity).
    final actions = onLongPress;
    if (actions != null && message.text.isNotEmpty) {
      return GestureDetector(onLongPress: actions, child: bubble);
    }
    return bubble;
  }
}

/// HH:mm 24-hour clock time for the bubble meta row.
String _formatTime(DateTime t) {
  final h = t.hour.toString().padLeft(2, '0');
  final m = t.minute.toString().padLeft(2, '0');
  return '$h:$m';
}

/// Delivery status icon for outgoing messages:
/// clock (sending) → double tick (delivered) → error (failed, tap to retry).
class _DeliveryIcon extends StatelessWidget {
  final MessageStatus status;
  const _DeliveryIcon({required this.status});

  @override
  Widget build(BuildContext context) {
    return switch (status) {
      MessageStatus.pending => Icon(
          Icons.schedule_rounded,
          size: 12,
          color: Colors.white.withValues(alpha: 0.6),
        ),
      MessageStatus.sent => Icon(
          Icons.done_all_rounded,
          size: 13,
          color: Colors.white.withValues(alpha: 0.9),
        ),
      MessageStatus.failed => const Icon(
          Icons.error_outline_rounded,
          size: 12,
          color: Colors.white,
        ),
    };
  }
}
