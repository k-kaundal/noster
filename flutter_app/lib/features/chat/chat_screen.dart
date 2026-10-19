import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/chat_avatar.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/chat_date_separator.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/conversation.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/decrypted_preview.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/message_bubble.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/new_message_sheet.dart';

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
    // Normalize: if we were handed an npub/nprofile instead of hex, decode it
    // here so all downstream code (which expects 64-char hex) works.
    final normalized = normalizePubkey(widget.peerNpub!);
    if (normalized == null) {
      // Invalid identifier — show a friendly error
      return Scaffold(
        appBar: AppBar(title: const Text('Chat')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, size: 48),
                const SizedBox(height: 16),
                const Text('Invalid recipient identifier'),
                const SizedBox(height: 8),
                Text(
                  widget.peerNpub!,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (normalized != widget.peerNpub) {
      // Replace the route with the normalized hex so deep links work cleanly
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.replace('/chat/$normalized');
      });
    }
    return _buildChatThread(context, normalized);
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
          return FutureBuilder<List<Conversation>>(
            future: _groupIntoConversations(events, auth.pubkey),
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return _buildLoadingState(colorScheme);
              }
              final conversations = snapshot.data ?? const <Conversation>[];
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
          CircleAvatar(
            radius: 28,
            backgroundColor: colorScheme.surfaceContainerHighest,
          ),
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
    return ErrorView(
      message: 'Failed to load messages',
      onRetry: () {
        HapticFeedback.lightImpact();
        ref.invalidate(dmsProvider);
      },
    );
  }

  /// Group DM events into conversations by REAL peer pubkey.
  ///
  /// For kind 4: the peer is the event author or the 'p' tag.
  /// For kind 1059 (NIP-17): the event author is an ephemeral key, so we
  /// must decrypt to find the real sender. We cache decrypted messages so
  /// we don't re-decrypt on every rebuild.
  Future<List<Conversation>> _groupIntoConversations(
    List<NostrEvent> events,
    String? myPubkey,
  ) async {
    final map = <String, List<NostrEvent>>{};
    final nostr = ref.read(nostrServiceProvider);

    for (final e in events) {
      String peer = '';
      if (e.kind == 1059) {
        // Decrypt to get the real sender from the inner rumor
        final decrypted = await nostr.decryptDm(e);
        if (decrypted == null) continue; // skip un-decryptable
        peer = decrypted.senderPubkey;
        _decryptedCache[e.id] = decrypted;
      } else if (e.kind == 4) {
        peer = e.pubkey == myPubkey ? e.getTag('p') ?? '' : e.pubkey;
      }
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
    }).toList()..sort(
      (a, b) => (b.lastMessage?.createdAt ?? 0).compareTo(
        a.lastMessage?.createdAt ?? 0,
      ),
    );
  }

  /// Cache of decrypted DMs to avoid re-decrypting on every rebuild.
  final Map<String, DecryptedDm> _decryptedCache = {};

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
                data: (profile) => ChatAvatar(
                  imageUrl: profile?.picture,
                  name: profile?.displayNameOrName ?? conv.peerPubkey,
                ),
                loading: () => ChatAvatar(name: conv.peerPubkey),
                error: (_, _) => ChatAvatar(name: conv.peerPubkey),
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
                              profile?.displayNameOrName ??
                                  _shortKey(conv.peerPubkey),
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
                          Icon(
                            Icons.lock_rounded,
                            size: 12,
                            color: colorScheme.onSurfaceVariant.withValues(
                              alpha: 0.6,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: DecryptedPreview(
                              event: lastMsg,
                              cached: _decryptedCache[lastMsg.id],
                            ),
                          ),
                        ],
                        if (conv.unreadCount > 0) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
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

  Widget _buildChatThread(BuildContext context, String peerPubkey) {
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
                ChatAvatar(
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
                          Icon(
                            Icons.lock_rounded,
                            size: 11,
                            color: colorScheme.primary,
                          ),
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
                child: Text(
                  'Failed to load messages',
                  style: TextStyle(color: colorScheme.error),
                ),
              ),
              data: (events) {
                final thread = _filterThread(events, auth.pubkey, peerPubkey);
                if (thread.isEmpty) {
                  return const EmptyState(
                    icon: Icons.waving_hand_rounded,
                    title: 'No messages yet',
                    subtitle: 'Say hello! Messages are end-to-end encrypted.',
                  );
                }
                return ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  itemCount: thread.length,
                  itemBuilder: (context, index) {
                    final msg = thread[index];
                    final isSent = msg.pubkey == auth.pubkey;
                    final showDateSeparator =
                        index == thread.length - 1 ||
                        !_isSameDay(
                          thread[index].createdAt,
                          thread[index + 1].createdAt,
                        );
                    return Column(
                      children: [
                        if (showDateSeparator)
                          ChatDateSeparator(timestamp: msg.createdAt),
                        MessageBubble(event: msg, isSent: isSent),
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
    List<NostrEvent> events,
    String? myPubkey,
    String peerPubkey,
  ) {
    return events.where((e) {
      if (e.kind == 1059) {
        // For NIP-17, look up the decrypted sender in the cache.
        final decrypted = _decryptedCache[e.id];
        if (decrypted == null) return false;
        return decrypted.senderPubkey == peerPubkey ||
            (decrypted.senderPubkey == myPubkey && e.getTag('p') == peerPubkey);
      }
      // kind 4
      return (e.pubkey == myPubkey && e.getTag('p') == peerPubkey) ||
          (e.pubkey == peerPubkey && e.getTag('p') == myPubkey);
    }).toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  Widget _buildInputBar(
    BuildContext context,
    AuthState auth,
    String peerPubkey,
  ) {
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
          top: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerHighest.withValues(
                  alpha: 0.7,
                ),
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
                    horizontal: 20,
                    vertical: 12,
                  ),
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
              onPressed: _isSending || !auth.isLoggedIn
                  ? null
                  : () => _send(auth, peerPubkey),
              icon: _isSending
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(
                      Icons.send_rounded,
                      color: Colors.white,
                      size: 20,
                    ),
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
      // Use NIP-17 gift-wrapped DM (kind 1059) — modern standard with
      // metadata privacy, compatible with Amethyst/0xchat/Damus.
      final event = nostr.createNip17Dm(peerPubkey, text);
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
    return EmptyState(
      icon: Icons.chat_bubble_outline_rounded,
      title: 'No conversations yet',
      subtitle:
          'Start a new message to get going.\nAll messages are end-to-end encrypted.',
      action: FilledButton.icon(
        onPressed: () {
          HapticFeedback.lightImpact();
          _showNewMessageDialog(context);
        },
        icon: const Icon(Icons.add_rounded),
        label: const Text('New Message'),
      ),
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  String _shortKey(String pubkey) =>
      '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';

  void _showNewMessageDialog(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => const NewMessageSheet(),
    );
  }
}

/// Normalize any user-supplied identifier (npub, nprofile, hex pubkey) to a
/// 64-char hex pubkey. Returns null if the input cannot be resolved.
String? normalizePubkey(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return null;

  // Raw hex pubkey
  if (trimmed.length == 64 && RegExp(r'^[0-9a-fA-F]+$').hasMatch(trimmed)) {
    return trimmed.toLowerCase();
  }

  // NIP-19 bech32 (npub1, nprofile1)
  final decoded = decodeNip19(trimmed);
  if (decoded is Nip19Pubkey) return decoded.pubkey;
  if (decoded is Nip19Profile) return decoded.pubkey;

  return null;
}
