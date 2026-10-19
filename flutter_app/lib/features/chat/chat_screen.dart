import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/features/chat/providers/dm_store.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/chat_avatar.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/chat_date_separator.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/conversation.dart';
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
        leading: widget.peerNpub == null
            ? Builder(
                builder: (scaffoldContext) => IconButton(
                  icon: const Icon(Icons.menu_rounded),
                  tooltip: 'Menu',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    Scaffold.of(scaffoldContext).openDrawer();
                  },
                ),
              )
            : IconButton(
                icon: const Icon(Icons.arrow_back_rounded),
                tooltip: 'Back',
                onPressed: () {
                  HapticFeedback.lightImpact();
                  context.pop();
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
          return FutureBuilder<List<ConversationItem>>(
            future: _groupIntoConversations(events, auth.pubkey),
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return _buildLoadingState(colorScheme);
              }
              final conversations = snapshot.data ?? const <ConversationItem>[];
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

  /// Group DM events into conversations via the shared [DmStore].
  /// Decryption happens once in the store; the UI just reads the results.
  Future<List<ConversationItem>> _groupIntoConversations(
    List<NostrEvent> events,
    String? myPubkey,
  ) async {
    final store = ref.read(dmStoreProvider);
    await store.prime(events);
    return store
        .conversations(events)
        .map(
          (c) => ConversationItem(
            peerPubkey: c.peer,
            lastMessage: c.lastEvent,
            lastText: c.decrypted?.plaintext,
            lastTimestamp: c.decrypted?.createdAt ?? c.lastEvent.createdAt,
          ),
        )
        .toList();
  }

  Widget _conversationTile(BuildContext context, ConversationItem conv) {
    final profileAsync = ref.watch(profileProvider(conv.peerPubkey));
    final colorScheme = Theme.of(context).colorScheme;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      conv.lastTimestamp * 1000,
    );

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
                        Icon(
                          Icons.lock_rounded,
                          size: 12,
                          color: colorScheme.onSurfaceVariant.withValues(
                            alpha: 0.6,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            conv.lastText ?? '…',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              color: colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
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
                final store = ref.read(dmStoreProvider);
                return FutureBuilder<void>(
                  future: store.prime(events),
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    final thread = store.threadFor(events, peerPubkey);
                    if (thread.isEmpty) {
                      return const EmptyState(
                        icon: Icons.waving_hand_rounded,
                        title: 'No messages yet',
                        subtitle:
                            'Say hello! Messages are end-to-end encrypted.',
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
                        final isSent = msg.senderPubkey == auth.pubkey;
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
                            MessageBubble(
                              key: ValueKey(msg.id),
                              message: msg,
                              isSent: isSent,
                            ),
                          ],
                        );
                      },
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
      // NIP-17 wraps can't be decrypted by their sender and have a randomized
      // (up-to-2-days-ago) timestamp — so we can't rely on the relay echo to
      // show our own message. Record it in the local outbox so it renders
      // immediately with the correct time.
      ref
          .read(dmStoreProvider)
          .recordSent(
            peerPubkey: peerPubkey,
            plaintext: text,
            eventId: event.id,
          );
      _messageController.clear();
      // Rebuild the thread immediately with the outbox message.
      ref.invalidate(dmsProvider);
      setState(() {});
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
      subtitle: 'Start a new message to get going.\nAll messages are end-to-end encrypted.',
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
