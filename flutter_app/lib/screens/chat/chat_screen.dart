import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:go_router/go_router.dart';

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';

/// Chat / DM screen with end-to-end encryption (NIP-04/NIP-17).
/// - No [peerNpub]: shows the conversation list.
/// - [peerNpub] set: shows the direct chat thread.
class ChatScreen extends ConsumerStatefulWidget {
  final String? peerNpub;

  const ChatScreen({super.key, this.peerNpub});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  bool _isSending = false;

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.peerNpub == null) {
      return _buildConversationList(context);
    }
    return _buildChatThread(context);
  }

  // ─── Conversation list ─────────────────────────────────────────────

  Widget _buildConversationList(BuildContext context) {
    final dmsAsync = ref.watch(dmsProvider);
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.menu_rounded),
          tooltip: 'Menu',
          onPressed: () {
            HapticFeedback.lightImpact();
            Scaffold.of(context).openDrawer();
          },
        ),
        title: const Text('Messages'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search_rounded),
            tooltip: 'Search',
            onPressed: () {
              HapticFeedback.lightImpact();
              context.push('/search');
            },
          ),
          IconButton(
            icon: const Icon(Icons.add_comment_outlined),
            tooltip: 'New message',
            onPressed: () {
              HapticFeedback.lightImpact();
              _showNewMessageDialog(context);
            },
          ),
        ],
      ),
      body: dmsAsync.when(
        loading: () => _buildLoadingState(colorScheme),
        error: (err, _) => _buildErrorState(context),
        data: (events) {
          final conversations = _groupIntoConversations(events, auth.pubkey);
          if (conversations.isEmpty) {
            return _buildEmptyState(context);
          }
          return RefreshIndicator(
            onRefresh: () async {
              HapticFeedback.mediumImpact();
              ref.invalidate(dmsProvider);
              await ref.read(dmsProvider.future);
            },
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: conversations.length,
              separatorBuilder: (_, _) => Divider(
                height: 1,
                indent: 84,
                color: colorScheme.outlineVariant.withValues(alpha: 0.3),
              ),
              itemBuilder: (context, index) =>
                  _conversationTile(context, conversations[index]),
            ),
          );
        },
      ),
    );
  }

  Widget _buildLoadingState(ColorScheme colorScheme) {
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: 5,
      separatorBuilder: (_, _) => const SizedBox(height: 16),
      itemBuilder: (context, i) => Row(
        children: [
          CircleAvatar(radius: 28, backgroundColor: colorScheme.surfaceContainerHighest),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 14,
                  width: 120,
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  height: 12,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: colorScheme.errorContainer.withValues(alpha: 0.3),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.error_outline_rounded, size: 48, color: colorScheme.error),
            ),
            const SizedBox(height: 24),
            Text('Failed to load messages',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () {
                HapticFeedback.lightImpact();
                ref.invalidate(dmsProvider);
              },
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  List<Conversation> _groupIntoConversations(
      List<NostrEvent> events, String? myPubkey) {
    final map = <String, List<NostrEvent>>{};
    for (final e in events) {
      final peer = e.pubkey == myPubkey ? e.getTag('p') ?? '' : e.pubkey;
      if (peer.isEmpty) continue;
      map.putIfAbsent(peer, () => []).add(e);
    }
    return map.entries.map((entry) {
      final msgs = entry.value
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return Conversation(
        peerPubkey: entry.key,
        lastMessage: msgs.first,
        unreadCount: 0,
      );
    }).toList()
      ..sort((a, b) => (b.lastMessage?.createdAt ?? 0)
          .compareTo(a.lastMessage?.createdAt ?? 0));
  }

  Widget _conversationTile(BuildContext context, Conversation conv) {
    final profileAsync = ref.watch(profileProvider(conv.peerPubkey));
    final colorScheme = Theme.of(context).colorScheme;
    final lastMsg = conv.lastMessage;
    final timestamp = lastMsg != null
        ? DateTime.fromMillisecondsSinceEpoch(lastMsg.createdAt * 1000)
        : null;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          context.push('/chat/${conv.peerPubkey}');
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Row(
            children: [
              profileAsync.when(
                data: (profile) => _Avatar(
                  imageUrl: profile?.picture,
                  name: profile?.displayNameOrName ?? conv.peerPubkey,
                ),
                loading: () => _Avatar(name: conv.peerPubkey),
                error: (_, _) => _Avatar(name: conv.peerPubkey),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: profileAsync.when(
                            data: (profile) => Text(
                              profile?.displayNameOrName ?? _shortKey(conv.peerPubkey),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 16,
                                letterSpacing: -0.2,
                              ),
                            ),
                            loading: () => Text(_shortKey(conv.peerPubkey)),
                            error: (_, _) => Text(_shortKey(conv.peerPubkey)),
                          ),
                        ),
                        if (timestamp != null)
                          Text(
                            timeago.format(timestamp, locale: 'en_short'),
                            style: TextStyle(
                              fontSize: 12,
                              color: colorScheme.onSurfaceVariant,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        if (lastMsg != null) ...[
                          Icon(Icons.lock_rounded,
                              size: 12,
                              color: colorScheme.onSurfaceVariant.withValues(alpha: 0.6)),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              lastMsg.content,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14,
                                color: colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                        if (conv.unreadCount > 0) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: colorScheme.primary,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '${conv.unreadCount}',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: colorScheme.onPrimary,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─── Chat thread ───────────────────────────────────────────────────

  Widget _buildChatThread(BuildContext context) {
    final peerPubkey = widget.peerNpub!;
    final dmsAsync = ref.watch(dmsProvider);
    final profileAsync = ref.watch(profileProvider(peerPubkey));
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        elevation: 0,
        scrolledUnderElevation: 2,
        backgroundColor: colorScheme.surface,
        titleSpacing: 0,
        title: profileAsync.when(
          data: (profile) => InkWell(
            onTap: () => context.push('/profile/$peerPubkey'),
            child: Row(
              children: [
                _Avatar(
                  imageUrl: profile?.picture,
                  name: profile?.displayNameOrName ?? peerPubkey,
                  radius: 18,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        profile?.displayNameOrName ?? _shortKey(peerPubkey),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                      Row(
                        children: [
                          Icon(Icons.lock_rounded, size: 11, color: colorScheme.primary),
                          const SizedBox(width: 3),
                          Text(
                            'Encrypted',
                            style: TextStyle(
                              fontSize: 11,
                              color: colorScheme.primary,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          loading: () => Text(_shortKey(peerPubkey)),
          error: (_, _) => Text(_shortKey(peerPubkey)),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_vert_rounded),
            onPressed: () => context.push('/profile/$peerPubkey'),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: dmsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(
                child: Text('Failed to load messages',
                    style: TextStyle(color: colorScheme.error)),
              ),
              data: (events) {
                final thread = _filterThread(events, auth.pubkey, peerPubkey);
                if (thread.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            padding: const EdgeInsets.all(20),
                            decoration: BoxDecoration(
                              color: colorScheme.primaryContainer.withValues(alpha: 0.3),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(Icons.waving_hand_rounded,
                                size: 48, color: colorScheme.primary),
                          ),
                          const SizedBox(height: 24),
                          Text(
                            'No messages yet',
                            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                  fontWeight: FontWeight.bold,
                                ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Say hello! Messages are end-to-end encrypted.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: colorScheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                return ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  itemCount: thread.length,
                  itemBuilder: (context, index) {
                    final msg = thread[index];
                    final isSent = msg.pubkey == auth.pubkey;
                    final showDateSeparator = index == thread.length - 1 ||
                        !_isSameDay(
                          thread[index].createdAt,
                          thread[index + 1].createdAt,
                        );
                    return Column(
                      children: [
                        if (showDateSeparator)
                          _DateSeparator(timestamp: msg.createdAt),
                        _MessageBubble(event: msg, isSent: isSent),
                      ],
                    );
                  },
                );
              },
            ),
          ),
          _buildInputBar(context, auth, peerPubkey),
        ],
      ),
    );
  }

  bool _isSameDay(int ts1, int ts2) {
    final d1 = DateTime.fromMillisecondsSinceEpoch(ts1 * 1000);
    final d2 = DateTime.fromMillisecondsSinceEpoch(ts2 * 1000);
    return d1.year == d2.year && d1.month == d2.month && d1.day == d2.day;
  }

  List<NostrEvent> _filterThread(
      List<NostrEvent> events, String? myPubkey, String peerPubkey) {
    return events
        .where((e) =>
            (e.pubkey == myPubkey && e.getTag('p') == peerPubkey) ||
            (e.pubkey == peerPubkey && e.getTag('p') == myPubkey))
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  Widget _buildInputBar(
      BuildContext context, AuthState auth, String peerPubkey) {
    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      padding: EdgeInsets.only(
        left: 16,
        right: 8,
        top: 8,
        bottom: MediaQuery.of(context).viewPadding.bottom + 8,
      ),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        border: Border(
          top: BorderSide(color: colorScheme.outlineVariant.withValues(alpha: 0.5)),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.7),
                borderRadius: BorderRadius.circular(24),
              ),
              child: TextField(
                controller: _messageController,
                decoration: InputDecoration(
                  hintText: 'Message…',
                  hintStyle: TextStyle(
                    color: colorScheme.onSurfaceVariant.withValues(alpha: 0.6),
                  ),
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 20, vertical: 12),
                ),
                minLines: 1,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                enabled: auth.isLoggedIn && !auth.isReadOnly,
                onSubmitted: (_) => _send(auth, peerPubkey),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [colorScheme.primary, colorScheme.tertiary],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              shape: BoxShape.circle,
            ),
            child: IconButton(
              onPressed:
                  _isSending || !auth.isLoggedIn ? null : () => _send(auth, peerPubkey),
              icon: _isSending
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _send(AuthState auth, String peerPubkey) async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    HapticFeedback.mediumImpact();
    setState(() => _isSending = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final event = nostr.createEncryptedDm(peerPubkey, text);
      nostr.publish(event);
      _messageController.clear();
      ref.invalidate(dmsProvider);
      await Future.delayed(const Duration(milliseconds: 100));
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          0,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to send: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  Widget _buildEmptyState(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: colorScheme.primaryContainer.withValues(alpha: 0.3),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.chat_bubble_outline_rounded,
                  size: 64, color: colorScheme.primary),
            ),
            const SizedBox(height: 24),
            Text('No conversations yet',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    )),
            const SizedBox(height: 8),
            Text(
              'Start a new message to get going.\nAll messages are end-to-end encrypted.',
              textAlign: TextAlign.center,
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () {
                HapticFeedback.lightImpact();
                _showNewMessageDialog(context);
              },
              icon: const Icon(Icons.add_rounded),
              label: const Text('New Message'),
            ),
          ],
        ),
      ),
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  String _shortKey(String pubkey) =>
      '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';

  void _showNewMessageDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('New Message'),
        content: TextField(
          controller: controller,
          decoration: InputDecoration(
            labelText: 'Recipient npub or hex pubkey',
            hintText: 'npub1…',
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final key = controller.text.trim();
              if (key.isNotEmpty) {
                Navigator.pop(ctx);
                context.push('/chat/$key');
              }
            },
            child: const Text('Open Chat'),
          ),
        ],
      ),
    );
  }
}

/// A single DM conversation with a peer.
class Conversation {
  final String peerPubkey;
  final NostrProfile? profile;
  final NostrEvent? lastMessage;
  final int unreadCount;
  const Conversation({
    required this.peerPubkey,
    this.profile,
    this.lastMessage,
    this.unreadCount = 0,
  });
}

// ─── Avatar ─────────────────────────────────────────────────────────

class _Avatar extends StatelessWidget {
  final String? imageUrl;
  final String name;
  final double radius;

  const _Avatar({this.imageUrl, required this.name, this.radius = 28});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final url = imageUrl;

    if (url != null && url.isNotEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundImage: CachedNetworkImageProvider(url),
        onBackgroundImageError: (_, _) {},
        backgroundColor: colorScheme.surfaceContainerHighest,
      );
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: colorScheme.primaryContainer,
      child: Text(
        name.isNotEmpty ? name[0].toUpperCase() : '?',
        style: TextStyle(
          color: colorScheme.onPrimaryContainer,
          fontWeight: FontWeight.w600,
          fontSize: radius * 0.7,
        ),
      ),
    );
  }
}

// ─── Date Separator ─────────────────────────────────────────────────

class _DateSeparator extends StatelessWidget {
  final int timestamp;
  const _DateSeparator({required this.timestamp});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
    final now = DateTime.now();
    final isToday =
        date.year == now.year && date.month == now.month && date.day == now.day;
    final isYesterday = date.year == now.year &&
        date.month == now.month &&
        date.day == now.day - 1;

    final label = isToday
        ? 'Today'
        : isYesterday
            ? 'Yesterday'
            : '${date.day}/${date.month}/${date.year}';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Message Bubble ─────────────────────────────────────────────────

class _MessageBubble extends ConsumerStatefulWidget {
  final NostrEvent event;
  final bool isSent;

  const _MessageBubble({
    required this.event,
    required this.isSent,
  });

  @override
  ConsumerState<_MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends ConsumerState<_MessageBubble> {
  String? _decrypted;
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
        _decrypted = result;
        _failed = result == null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final timestamp =
        DateTime.fromMillisecondsSinceEpoch(widget.event.createdAt * 1000);
    final isSent = widget.isSent;

    final displayText = _failed ? '🔒 Unable to decrypt' : (_decrypted ?? '…');

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
          crossAxisAlignment:
              isSent ? CrossAxisAlignment.end : CrossAxisAlignment.start,
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
