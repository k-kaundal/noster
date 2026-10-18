import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:go_router/go_router.dart';

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';

/// Chat / DM screen.
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

  // ---------------------------------------------------------------------------
  // Conversation list
  // ---------------------------------------------------------------------------

  Widget _buildConversationList(BuildContext context) {
    final dmsAsync = ref.watch(dmsProvider);
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Messages'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_comment_outlined),
            tooltip: 'New message',
            onPressed: () => _showNewMessageDialog(context),
          ),
        ],
      ),
      body: dmsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline,
                  size: 48, color: Theme.of(context).colorScheme.error),
              const SizedBox(height: 12),
              Text('Failed to load messages',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              FilledButton.tonal(
                onPressed: () => ref.refresh(dmsProvider),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (events) {
          final conversations = _groupIntoConversations(events, auth.pubkey);
          if (conversations.isEmpty) {
            return _buildEmptyState(context);
          }
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(dmsProvider),
            child: ListView.separated(
              itemCount: conversations.length,
              separatorBuilder: (_, _) => const Divider(indent: 72),
              itemBuilder: (context, index) =>
                  _conversationTile(context, conversations[index]),
            ),
          );
        },
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

    return ListTile(
      leading: profileAsync.when(
        data: (profile) => CircleAvatar(
          backgroundImage: profile?.picture != null
              ? CachedNetworkImageProvider(profile!.picture!)
              : null,
          child: profile?.picture == null ? const Icon(Icons.person) : null,
        ),
        loading: () => const CircleAvatar(child: Icon(Icons.person)),
        error: (_, _) => const CircleAvatar(child: Icon(Icons.person)),
      ),
      title: profileAsync.when(
        data: (profile) => Text(
          profile?.displayNameOrName ?? _shortKey(conv.peerPubkey),
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        loading: () => Text(_shortKey(conv.peerPubkey)),
        error: (_, _) => Text(_shortKey(conv.peerPubkey)),
      ),
      subtitle: lastMsg != null
          ? Text(
              lastMsg.content,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            )
          : null,
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (timestamp != null)
            Text(
              timeago.format(timestamp),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          if (conv.unreadCount > 0) ...[
            const SizedBox(height: 4),
            Badge(
              label: Text('${conv.unreadCount}'),
              backgroundColor: colorScheme.primary,
            ),
          ],
        ],
      ),
      onTap: () {
        // Navigate to the thread; use npub encoding for the route.
        context.push('/chat/${conv.peerPubkey}');
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Chat thread
  // ---------------------------------------------------------------------------

  Widget _buildChatThread(BuildContext context) {
    final peerPubkey = widget.peerNpub!;
    final dmsAsync = ref.watch(dmsProvider);
    final profileAsync = ref.watch(profileProvider(peerPubkey));
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: profileAsync.when(
          data: (profile) => Row(
            children: [
              CircleAvatar(
                radius: 16,
                backgroundImage: profile?.picture != null
                    ? CachedNetworkImageProvider(profile!.picture!)
                    : null,
                child: profile?.picture == null
                    ? const Icon(Icons.person, size: 18)
                    : null,
              ),
              const SizedBox(width: 10),
              Text(profile?.displayNameOrName ?? _shortKey(peerPubkey)),
            ],
          ),
          loading: () => Text(_shortKey(peerPubkey)),
          error: (_, _) => Text(_shortKey(peerPubkey)),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: dmsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(
                child: Text('Failed to load messages',
                    style: TextStyle(
                        color: Theme.of(context).colorScheme.error)),
              ),
              data: (events) {
                final thread = _filterThread(events, auth.pubkey, peerPubkey);
                if (thread.isEmpty) {
                  return Center(
                    child: Text(
                      'No messages yet.\nSay hello!',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color:
                              Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                  );
                }
                return ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  itemCount: thread.length,
                  itemBuilder: (context, index) {
                    final msg = thread[index];
                    final isSent = msg.pubkey == auth.pubkey;
                    return _MessageBubble(
                      event: msg,
                      isSent: isSent,
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

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          border:
              Border(top: BorderSide(color: colorScheme.outlineVariant)),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _messageController,
                decoration: InputDecoration(
                  hintText: 'Message…',
                  filled: true,
                  fillColor: colorScheme.surfaceContainerHighest,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 10),
                ),
                minLines: 1,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                enabled: auth.isLoggedIn && !auth.isReadOnly,
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed:
                  _isSending || !auth.isLoggedIn ? null : () => _send(auth, peerPubkey),
              icon: _isSending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _send(AuthState auth, String peerPubkey) async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    setState(() => _isSending = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final event = nostr.createEncryptedDm(peerPubkey, text);
      nostr.publish(event);
      _messageController.clear();
      ref.invalidate(dmsProvider);
      // Scroll to bottom after send
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
          SnackBar(content: Text('Failed to send: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  Widget _buildEmptyState(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.chat_bubble_outline,
              size: 64, color: colorScheme.onSurfaceVariant),
          const SizedBox(height: 16),
          Text('No conversations yet',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            'Start a new message to get going',
            style: TextStyle(color: colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: () => _showNewMessageDialog(context),
            icon: const Icon(Icons.add),
            label: const Text('New Message'),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _shortKey(String pubkey) =>
      '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';

  void _showNewMessageDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Message'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'Recipient npub or hex pubkey',
            hintText: 'npub1…',
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

/// A message bubble that decrypts its content on demand.
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

    final displayText = _failed
        ? '🔒 Unable to decrypt'
        : (_decrypted ?? '…');

    return Align(
      alignment: isSent ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.72,
        ),
        decoration: BoxDecoration(
          color: isSent
              ? colorScheme.primary
              : colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isSent ? 16 : 4),
            bottomRight: Radius.circular(isSent ? 4 : 16),
          ),
        ),
        child: Column(
          crossAxisAlignment:
              isSent ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(
              displayText,
              style: TextStyle(
                color: isSent
                    ? colorScheme.onPrimary
                    : colorScheme.onSurfaceVariant,
                fontStyle: _failed ? FontStyle.italic : FontStyle.normal,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              timeago.format(timestamp),
              style: TextStyle(
                fontSize: 10,
                color: isSent
                    ? colorScheme.onPrimary.withValues(alpha: 0.7)
                    : colorScheme.onSurfaceVariant.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
