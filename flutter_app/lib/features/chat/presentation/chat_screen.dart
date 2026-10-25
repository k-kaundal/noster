import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart'
    show DecryptedDm;
import 'package:nostrfeed_mobile/core/nostr/relay/dm_delivery.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_thread_provider.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/chat_avatar.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/chat_date_separator.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/message_bubble.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/new_message_sheet.dart';
import 'package:nostrfeed_mobile/features/compose/data/upload_service.dart';
import 'package:timeago/timeago.dart' as timeago;

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
  bool _isUploading = false;

  /// The message being replied to (NIP-17 reply via 'e' tag). Set by
  /// swiping a bubble, cleared after send or via the cancel button.
  ChatMessage? _replyingTo;

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
      // Invalid identifier — friendly error with its own back button
      // (the shell AppBar is hidden on chat threads).
      return Scaffold(
        body: Column(
          children: [
            Padding(
              padding: EdgeInsets.only(
                top: MediaQuery.of(context).viewPadding.top,
              ),
              child: Row(
                children: [
                  IconButton(
                    icon: const AppIcon('back', size: AppIconSize.lg),
                    tooltip: 'Back',
                    onPressed: () => context.pop(),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const AppIcon('eye_off', size: 48, color: Colors.grey),
                      const SizedBox(height: 16),
                      const Text('Invalid recipient identifier'),
                      const SizedBox(height: 8),
                      Text(
                        widget.peerNpub!,
                        style: Theme.of(context).textTheme.bodySmall
                            ?.copyWith(fontFamily: 'monospace'),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
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
    final convosAsync = ref.watch(conversationListProvider);
    final colorScheme = Theme.of(context).colorScheme;

    // AppBar is owned by AppShell (hamburger → drawer). This view adds its
    // action row (search + new message) inline at the top of the body.
    return Scaffold(
      backgroundColor: colorScheme.surface,
      body: Column(
        children: [
          // Action row: new message (search lives in the AppBar).
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
            child: Row(
              children: [
                const Spacer(),
                IconButton(
                  icon: const AppIcon('edit', size: AppIconSize.lg),
                  tooltip: 'New message',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    _showNewMessageDialog(context);
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: convosAsync.when(
              loading: () => _buildLoadingState(colorScheme),
              error: (err, _) => _buildErrorState(context),
              data: (conversations) {
                return RefreshIndicator(
                  onRefresh: () async {
                    HapticFeedback.mediumImpact();
                    ref.invalidate(dmsProvider);
                    await ref.read(dmsProvider.future);
                  },
                  child: conversations.isEmpty
                      ? ListView(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          children: [
                            // Pinned first: the AI assistant, always first
                            // in the chat list — even with zero DMs.
                            const _AiChatTile(),
                            SizedBox(
                              height: MediaQuery.of(context).size.height * 0.45,
                              child: _buildEmptyState(context),
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          // Pinned row 0: the AI assistant (Telegram "Saved
                          // Messages" pattern).
                          itemCount: conversations.length + 1,
                          separatorBuilder: (_, index) => Divider(
                            height: 1,
                            indent: 84,
                            color: colorScheme.outlineVariant.withValues(
                              alpha: 0.3,
                            ),
                          ),
                          itemBuilder: (context, index) {
                            if (index == 0) return const _AiChatTile();
                            return _conversationTile(
                              context,
                              conversations[index - 1],
                            );
                          },
                        ),
                );
              },
            ),
          ),
        ],
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
                    borderRadius: AppShapes.radiusXs,
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  height: 12,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: AppShapes.radiusXs,
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

  Widget _conversationTile(
    BuildContext context,
    ({String peer, NostrEvent lastEvent, DecryptedDm? decrypted}) conv,
  ) {
    final profileAsync = ref.watch(profileProvider(conv.peer));
    final colorScheme = Theme.of(context).colorScheme;
    final lastTimestamp = conv.decrypted?.createdAt ?? conv.lastEvent.createdAt;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(lastTimestamp * 1000);
    // Unread count for this peer (cleared when the thread is opened).
    final dms = ref.watch(dmsProvider).valueOrNull ?? const <NostrEvent>[];
    final unread = ref.read(dmStoreProvider.notifier).unreadFor(dms, conv.peer);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          context.push('/chat/${conv.peer}');
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Row(
            children: [
              profileAsync.when(
                data: (profile) => ChatAvatar(
                  imageUrl: profile?.picture,
                  name: profile?.displayNameOrName ?? conv.peer,
                ),
                loading: () => ChatAvatar(name: conv.peer),
                error: (_, _) => ChatAvatar(name: conv.peer),
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
                                  _shortKey(conv.peer),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.titleMedium
                                  ?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: -0.2,
                                  ),
                            ),
                            loading: () => Text(_shortKey(conv.peer)),
                            error: (_, _) => Text(_shortKey(conv.peer)),
                          ),
                        ),
                        Text(
                          timeago.format(timestamp, locale: 'en_short'),
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: colorScheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        AppIcon(
                          'key',
                          size: 12,
                          color: colorScheme.onSurfaceVariant.withValues(
                            alpha: 0.6,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            conv.decrypted?.plaintext ?? '…',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodyMedium
                                ?.copyWith(
                                  color: colorScheme.onSurfaceVariant,
                                  fontWeight: unread > 0
                                      ? FontWeight.w600
                                      : FontWeight.normal,
                                ),
                          ),
                        ),
                        if (unread > 0) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: colorScheme.primary,
                              borderRadius: AppShapes.radiusFull,
                            ),
                            child: Text(
                              unread > 99 ? '99+' : '$unread',
                              style: Theme.of(context).textTheme.labelSmall
                                  ?.copyWith(
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
    // Rebuild when the outbox/decryption cache changes (e.g. after sending).
    ref.watch(dmStoreVersionProvider);
    // Opening this thread marks its messages as read (clears unread badge).
    // MUST run post-frame: markThreadRead bumps dmStoreVersionProvider, and
    // modifying a provider DURING build is illegal (crashes the frame).
    final store = ref.read(dmStoreProvider.notifier);
    final dmsForRead = dmsAsync.valueOrNull ?? const <NostrEvent>[];
    var latestTs = 0;
    for (final e in dmsForRead) {
      if (e.createdAt > latestTs) latestTs = e.createdAt;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        store.markThreadRead(peerPubkey, latestKnownTs: latestTs);
      }
    });
    final colorScheme = Theme.of(context).colorScheme;

    // Chat threads are IMMERSIVE: AppShell hides its AppBar on /chat/<pubkey>,
    // so this header owns the whole top area — back button, peer identity,
    // encryption status, and profile shortcut in one row (WhatsApp/Telegram
    // style). The conversation list ("/chat" tab) keeps the shell AppBar.
    return Scaffold(
      backgroundColor: colorScheme.surface,
      body: Column(
        children: [
          // Immersive thread header.
          Material(
            color: colorScheme.surface,
            child: Padding(
              padding: EdgeInsets.only(
                top: MediaQuery.of(context).viewPadding.top,
              ),
              child: profileAsync.when(
                data: (profile) => InkWell(
                  onTap: () => context.push('/profile/$peerPubkey'),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
                    child: Row(
                      children: [
                        // Back button (shell AppBar is hidden on threads).
                        IconButton(
                          icon: const AppIcon('back', size: AppIconSize.lg),
                          tooltip: 'Back',
                          onPressed: () {
                            HapticFeedback.lightImpact();
                            context.pop();
                          },
                        ),
                        ChatAvatar(
                          imageUrl: profile?.picture,
                          name: profile?.displayNameOrName ?? peerPubkey,
                          radius: 20,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                profile?.displayNameOrName ??
                                    _shortKey(peerPubkey),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              Row(
                                children: [
                                  AppIcon(
                                    'key',
                                    size: 11,
                                    color: colorScheme.primary,
                                  ),
                                  const SizedBox(width: 3),
                                  Text(
                                    'End-to-end encrypted',
                                    style: Theme.of(context)
                                        .textTheme
                                        .labelSmall
                                        ?.copyWith(
                                          color: colorScheme.primary,
                                          fontWeight: FontWeight.w500,
                                        ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          icon: const AppIcon('users', size: AppIconSize.lg),
                          tooltip: 'View profile',
                          onPressed: () => context.push('/profile/$peerPubkey'),
                        ),
                      ],
                    ),
                  ),
                ),
                loading: () => SizedBox(
                  height: 64,
                  child: Row(
                    children: [
                      IconButton(
                        icon: const AppIcon('back', size: AppIconSize.lg),
                        onPressed: () => context.pop(),
                      ),
                      const SizedBox(width: 12),
                      Text(_shortKey(peerPubkey)),
                    ],
                  ),
                ),
                error: (_, _) => SizedBox(
                  height: 64,
                  child: Row(
                    children: [
                      IconButton(
                        icon: const AppIcon('back', size: AppIconSize.lg),
                        onPressed: () => context.pop(),
                      ),
                      const SizedBox(width: 12),
                      Text(_shortKey(peerPubkey)),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Divider(
            height: 1,
            color: colorScheme.outlineVariant.withValues(alpha: 0.5),
          ),
          Expanded(
            child: ref
                .watch(dmThreadProvider(peerPubkey))
                .when(
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (err, _) => ErrorView.fromError(
                    err,
                    onRetry: () => ref.invalidate(dmThreadProvider(peerPubkey)),
                  ),
                  data: (thread) {
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
                        // Primal grouped bubbles: this message CONTINUES a group
                        // when the next (older) message is from the same sender
                        // (the list is reversed — index+1 is older in time).
                        final continuesGroup =
                            index < thread.length - 1 &&
                            thread[index + 1].senderPubkey == msg.senderPubkey;
                        return Column(
                          children: [
                            if (showDateSeparator)
                              ChatDateSeparator(timestamp: msg.createdAt),
                            // Swipe right → reply to this message (NIP-17
                            // 'e' tag reply). Only for text messages.
                            GestureDetector(
                              onHorizontalDragEnd: msg.text.isNotEmpty
                                  ? (_) {
                                      HapticFeedback.lightImpact();
                                      setState(() => _replyingTo = msg);
                                    }
                                  : null,
                              child: MessageBubble(
                                key: ValueKey(msg.id),
                                message: msg,
                                isSent: isSent,
                                isGroupContinuation: continuesGroup,
                                onRetry: msg.status == MessageStatus.failed
                                    ? () => _retryMessage(peerPubkey, msg)
                                    : null,
                                onDelete: msg.status == MessageStatus.failed
                                    ? () => _deleteFailed(peerPubkey, msg)
                                    : null,
                              ),
                            ),
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

  Widget _buildInputBar(
    BuildContext context,
    AuthState auth,
    String peerPubkey,
  ) {
    final colorScheme = Theme.of(context).colorScheme;
    final replying = _replyingTo;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Reply preview (NIP-17 reply): shows what you're replying to.
        if (replying != null)
          Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
            decoration: BoxDecoration(
              color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
              border: Border(
                left: BorderSide(color: colorScheme.primary, width: 3),
              ),
            ),
            child: Row(
              children: [
                AppIcon(
                  'back',
                  size: AppIconSize.sm,
                  color: colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Reply to',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: colorScheme.primary,
                        ),
                      ),
                      Text(
                        replying.text.isEmpty ? '🔒 message' : replying.text,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall
                            ?.copyWith(color: colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: AppIcon(
                    'plus',
                    size: AppIconSize.sm,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  onPressed: () => setState(() => _replyingTo = null),
                ),
              ],
            ),
          ),
        Container(
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
              // Attach (image) — kind-15 file message, WhatsApp-style.
              IconButton(
                icon: _isUploading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const AppIcon('image', size: AppIconSize.lg),
                tooltip: 'Send an image',
                onPressed: _isUploading || !auth.isLoggedIn || auth.isReadOnly
                    ? null
                    : () => _sendImage(auth, peerPubkey),
              ),
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest.withValues(
                      alpha: 0.7,
                    ),
                    borderRadius: AppShapes.radiusPill,
                  ),
                  child: TextField(
                    controller: _messageController,
                    decoration: InputDecoration(
                      hintText: 'Message…',
                      hintStyle: TextStyle(
                        color: colorScheme.onSurfaceVariant.withValues(
                          alpha: 0.6,
                        ),
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
                  color: colorScheme
                      .primary, // Refined: flat accent, not a gradient
                  shape: BoxShape.circle,
                ),
                child: IconButton(
                  onPressed: _isSending || !auth.isLoggedIn
                      ? null
                      : () => _send(auth, peerPubkey),
                  icon: _isSending
                      ? SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: colorScheme.onPrimary,
                          ),
                        )
                      : AppIcon('send', color: colorScheme.onPrimary, size: 20),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _send(AuthState auth, String peerPubkey) async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    HapticFeedback.mediumImpact();
    setState(() => _isSending = true);
    final store = ref.read(dmStoreProvider.notifier);
    try {
      final nostr = ref.read(nostrServiceProvider);
      // NIP-17 gift-wrapped DM (kind 1059). Returns TWO wraps: the
      // recipient's and our own copy (so our other devices can decrypt).
      final giftWraps = nostr.createNip17Dm(
        peerPubkey,
        text,
        replyToId: _replyingTo?.id,
      );
      final repliedTo = _replyingTo;
      final recipientWrap = giftWraps.first;
      // Record locally so the message renders immediately (pending state).
      final localId = store.recordSent(
        peerPubkey: peerPubkey,
        plaintext: text,
        eventId: recipientWrap.id,
      );
      _messageController.clear();
      // Clear the reply state AFTER capturing it for the wrap.
      if (repliedTo != null) setState(() => _replyingTo = null);
      // Opening this thread marked incoming messages read; sending also
      // implies read.
      store.markThreadRead(peerPubkey);
      await Future.delayed(const Duration(milliseconds: 100));
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          0,
          duration: AppMotion.normal,
          curve: AppMotion.curve,
        );
      }

      // ── Targeted delivery (NIP-17: 1–3 relays, not a spray) ────────
      // Publish immediately to OUR connected relays (for the self-copy and
      // our own history) + the small fallback DM set. The recipient's
      // kind-10050 inbox lookup runs in the background as a targeted boost.
      final selfWrap = giftWraps.length > 1 ? giftWraps[1] : null;
      final immediateTargets = {
        ...nostr.relayPool.connectedUrls,
        ...DmDelivery.fallbackDmRelays,
      }.toList();
      final delivered = await nostr.relayPool.publishWithAckTo(
        recipientWrap,
        immediateTargets,
      );
      if (selfWrap != null) {
        // Self copy — fire and forget, not on the critical path.
        nostr.publishWithAck(selfWrap).ignore();
      }
      if (!mounted) return;
      store.markStatus(
        peerPubkey,
        localId,
        delivered ? MessageStatus.sent : MessageStatus.failed,
      );
      if (!delivered) {
        AppToast.warning(
          context,
          'Message not delivered — no relay acknowledged it. Tap the message to retry.',
        );
      }

      // Targeted boost: publish to the recipient's ACTUAL inbox (their
      // kind-10050, 1–3 relays) + their NIP-65 read relays — not already-
      // covered ones, capped at 4. This is how a Primal/Damus/Amethyst user
      // on different relays still gets the message, without spraying 8.
      Future(() async {
        try {
          final inbox = await nostr.dmDelivery.deliveryRelaysFor(peerPubkey);
          final readRelays = await nostr.relayRouter.getReadRelays(peerPubkey);
          final extra = {...inbox, ...readRelays}
              .where((u) => !nostr.relayPool.connectedUrls.contains(u))
              .take(4)
              .toList();
          if (extra.isNotEmpty) {
            await nostr.relayPool.publishWithAckTo(recipientWrap, extra);
          }
        } catch (_) {
          // Boost is best-effort — the message already went out.
        }
      }).ignore();
      // Refresh relay DMs shortly after so our self-copy wrap arrives and
      // the outbox entry reconciles into a real relay-backed message.
      Future.delayed(const Duration(seconds: 3), () {
        if (!mounted) return;
        ref.invalidate(dmsProvider);
      });
    } catch (e) {
      if (mounted) AppToast.error(context, 'Failed to send: $e');
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  /// Pick an image → upload to Blossom → send as a kind-15 file message.
  /// Same targeted delivery as text (recipient inbox + home relay).
  Future<void> _sendImage(AuthState auth, String peerPubkey) async {
    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
      imageQuality: 85,
    );
    if (file == null || !mounted) return;

    setState(() => _isUploading = true);
    final store = ref.read(dmStoreProvider.notifier);
    try {
      final nostr = ref.read(nostrServiceProvider);
      // 1. Upload to Blossom (public URL).
      final url = await UploadService(
        nostr.authService,
        nostr,
      ).uploadImage(file);
      if (!mounted) return;

      // 2. Wrap as a kind-15 file message (plaintext = the URL).
      final giftWraps = nostr.dms.createNip17FileMessage(
        peerPubkey,
        url: url,
        mimeType: 'image/${file.name.split('.').last.toLowerCase()}',
        alt: file.name,
      );
      final recipientWrap = giftWraps.first;
      final localId = store.recordSent(
        peerPubkey: peerPubkey,
        plaintext: url,
        eventId: recipientWrap.id,
      );
      // Mark the outbox entry as a file so the bubble renders the image.
      store.markFileMessage(peerPubkey, localId, mimeType: 'image/');
      store.markThreadRead(peerPubkey);
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          0,
          duration: AppMotion.normal,
          curve: AppMotion.curve,
        );
      }

      // 3. Same targeted delivery as text.
      final selfWrap = giftWraps.length > 1 ? giftWraps[1] : null;
      final immediateTargets = {
        ...nostr.relayPool.connectedUrls,
        ...DmDelivery.fallbackDmRelays,
      }.toList();
      final delivered = await nostr.relayPool.publishWithAckTo(
        recipientWrap,
        immediateTargets,
      );
      if (selfWrap != null) nostr.publishWithAck(selfWrap).ignore();
      if (!mounted) return;
      store.markStatus(
        peerPubkey,
        localId,
        delivered ? MessageStatus.sent : MessageStatus.failed,
      );

      // Targeted boost to the recipient's inbox.
      Future(() async {
        try {
          final inbox = await nostr.dmDelivery.deliveryRelaysFor(peerPubkey);
          final extra = inbox
              .where((u) => !nostr.relayPool.connectedUrls.contains(u))
              .take(3)
              .toList();
          if (extra.isNotEmpty) {
            await nostr.relayPool.publishWithAckTo(recipientWrap, extra);
          }
        } catch (_) {}
      }).ignore();

      Future.delayed(const Duration(seconds: 3), () {
        if (mounted) ref.invalidate(dmsProvider);
      });
    } catch (e) {
      if (mounted) AppToast.error(context, 'Could not send image: $e');
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  /// Re-publish a failed message: remove the old entry and send again.
  Future<void> _retryMessage(String peerPubkey, ChatMessage msg) async {
    final auth = ref.read(authStateProvider);
    ref.read(dmStoreProvider.notifier).removePending(peerPubkey, msg.id);
    _messageController.text = msg.text;
    await _send(auth, peerPubkey);
  }

  /// Discard a failed outgoing message.
  void _deleteFailed(String peerPubkey, ChatMessage msg) {
    ref.read(dmStoreProvider.notifier).removePending(peerPubkey, msg.id);
    AppToast.info(context, 'Message deleted');
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
        icon: const AppIcon('plus', size: AppIconSize.lg),
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

/// The pinned first row of the conversation list: the AI assistant.
///
/// Always first (Telegram "Saved Messages" pattern) and always visible —
/// even with zero DM conversations. Shows the live credit balance / free
/// trial as the subtitle so the row carries real state, not just a link.
class _AiChatTile extends ConsumerWidget {
  const _AiChatTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final available = ref.watch(aiAvailableProvider);
    final balance = ref.watch(aiCreditsProvider).value?.balance ?? 0;
    final trialLeft = ref.watch(aiTrialRemainingProvider);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          context.push('/ai');
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Row(
            children: [
              // Flat accent circle — visually distinct from every DM peer
              // (Refined: no gradients except the logo mark).
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: colorScheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: AppIcon(
                    'sparkle',
                    color: colorScheme.onPrimary,
                    size: 26,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'NostrFeed AI',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      !available
                          ? 'Assistant (not configured)'
                          : trialLeft > 0
                          ? 'Summarize, translate, create · '
                                '$trialLeft free today'
                          : 'Summarize, translate, create · '
                                '$balance credits',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: available
                            ? colorScheme.onSurfaceVariant
                            : colorScheme.onSurfaceVariant.withValues(
                                alpha: 0.5,
                              ),
                      ),
                    ),
                  ],
                ),
              ),
              AppIcon(
                'sparkle',
                size: 18,
                color: colorScheme.primary.withValues(alpha: 0.7),
              ),
            ],
          ),
        ),
      ),
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
