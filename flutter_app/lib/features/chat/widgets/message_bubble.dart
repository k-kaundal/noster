import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

class MessageBubble extends ConsumerStatefulWidget {
  final NostrEvent event;
  final bool isSent;

  const MessageBubble({super.key, required this.event, required this.isSent});

  @override
  ConsumerState<MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends ConsumerState<MessageBubble> {
  String? _decryptedText;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _decrypt();
  }

  Future<void> _decrypt() async {
    final nostr = ref.read(nostrServiceProvider);
    final result = await nostr.decryptDm(widget.event);
    if (mounted) {
      setState(() {
        _decryptedText = result?.plaintext;
        _failed = result == null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      widget.event.createdAt * 1000,
    );
    final isSent = widget.isSent;

    final displayText = _failed
        ? '🔒 Unable to decrypt'
        : (_decryptedText ?? '…');

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
                fontStyle: _failed ? FontStyle.italic : FontStyle.normal,
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
                    Icons.lock_rounded,
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
