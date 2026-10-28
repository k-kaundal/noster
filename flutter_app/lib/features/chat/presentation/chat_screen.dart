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
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_thread_provider.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/chat_avatar.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/chat_date_separator.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/message_bubble.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/new_message_sheet.dart';
import 'package:nostrfeed_mobile/features/compose/data/upload_service.dart';
import 'package:share_plus/share_plus.dart';

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

  /// Whether the ↓ jump-to-latest pill is visible (user scrolled up into
  /// history, away from the newest message at offset 0).
  bool _showJumpToLatest = false;

  /// The message being replied to (NIP-17 reply via 'e' tag). Set by
  /// swiping a bubble, cleared after send or via the cancel button.
  ChatMessage? _replyingTo;

  /// Scroll anchoring for NEW messages arriving while the user reads
  /// history: the reversed list's maxScrollExtent grows by exactly the new
  /// item's height (items insert at index 0 = the offset-0 side). Capturing
  /// the extent BEFORE the frame and restoring offset + (newMax − oldMax)
  /// AFTER is EXACT — no per-message height estimate (the old 80px guess
  /// caused the visible scroll jumps on long/short messages).
  double? _preRebuildMaxExtent;

  /// The newest message id of the CURRENT rendered thread — the re-anchor
  /// gate. Only a change here (a genuinely new message at index 0) justifies
  /// an extent-delta correction: history pages append at the TOP (end of the
  /// reversed list), which also grows maxScrollExtent but must NEVER shift
  /// the viewport (the "scroll jumps while paging old chat" bug).
  String? _newestRenderedId;

  /// The watermark we already marked this thread read to — the
  /// markThreadRead gate. Without it the post-frame mark fired on EVERY
  /// build (every store bump anywhere), bumping dmStoreVersionProvider and
  /// rebuilding the thread a second time per interaction.
  int _lastMarkedReadTs = 0;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// Show the ↓ pill only when the user has scrolled a meaningful distance
  /// away from the newest message (reversed list: bottom = offset 0).
  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    final show = _scrollController.offset > 400;
    if (show != _showJumpToLatest) {
      setState(() => _showJumpToLatest = show);
    }
    // Scroll-up pagination: nearing the TOP (maxScrollExtent in a reversed
    // list) → load the next older page. Appending older messages at the END
    // of a reversed list does NOT move the viewport, so this needs no
    // scroll-position correction at all.
    if (pos.maxScrollExtent > 0 &&
        _scrollController.offset > pos.maxScrollExtent - 600) {
      final peer = _activePeer;
      if (peer != null) {
        final oldestTs = _oldestVisibleTs;
        if (oldestTs != null) {
          ref.read(dmHistoryProvider(peer).notifier).loadOlder(oldestTs);
        }
      }
    }
  }

  /// The peer whose thread is open (null on the conversation list).
  String? _activePeer;

  /// created_at of the oldest message currently rendered (the keyset
  /// cursor for the next "load older" page). Tracked by _buildThreadList.
  int? _oldestVisibleTs;

  /// Jump back to the newest message (bottom of the reversed list).
  void _scrollToLatest() {
    if (!_scrollController.hasClients) return;
    HapticFeedback.lightImpact();
    _scrollController.animateTo(
      0,
      duration: AppMotion.normal,
      curve: AppMotion.curve,
    );
  }

  /// Capture the scroll extent BEFORE a thread rebuild that may add items
  /// at index 0 (a new incoming/sent message at the bottom).
  void _captureScrollExtent() {
    if (!_scrollController.hasClients) return;
    _preRebuildMaxExtent = _scrollController.position.maxScrollExtent;
  }

  /// Restore the scroll offset AFTER the rebuild: the extent grew by the
  /// new items' exact total height, so shifting the offset by the same
  /// delta keeps the SAME message anchored in the viewport. Skipped when
  /// the user is already near the bottom (they want to follow new messages).
  void _restoreScrollExtent() {
    final oldMax = _preRebuildMaxExtent;
    if (oldMax == null) return;
    _preRebuildMaxExtent = null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      final newMax = _scrollController.position.maxScrollExtent;
      final grew = newMax - oldMax;
      if (grew <= 0) return;
      // Only re-anchor when the user scrolled UP into history — near the
      // bottom the normal follow-newest behavior applies (no jump).
      if (_scrollController.offset > 400) {
        _scrollController.jumpTo(_scrollController.offset + grew);
      }
    });
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

    // AppBar is owned by AppShell. New message lives on the floating action
    // button (bottom-right, above the bottom nav).
    return Scaffold(
      backgroundColor: colorScheme.surface,
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 90),
        child: FloatingActionButton(
          onPressed: () {
            HapticFeedback.lightImpact();
            _showNewMessageDialog(context);
          },
          tooltip: 'New message',
          elevation: 3,
          highlightElevation: 6,
          child: const AppIcon('edit', size: AppIconSize.lg),
        ),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                      : ListView.builder(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          // Pinned row 0: the AI assistant (Telegram "Saved
                          // Messages" pattern).
                          itemCount: conversations.length + 1,
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
    final textTheme = Theme.of(context).textTheme;
    final lastTimestamp = conv.decrypted?.createdAt ?? conv.lastEvent.createdAt;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(lastTimestamp * 1000);
    // Unread count for this peer (cleared when the thread is opened).
    final dms = ref.watch(dmsProvider).valueOrNull ?? const <NostrEvent>[];
    final unread = ref.read(dmStoreProvider.notifier).unreadFor(dms, conv.peer);
    final hasUnread = unread > 0;

    final tile = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          context.push('/chat/${conv.peer}');
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          // Unread conversations get a whisper of accent so they pop from
          // the read ones (WhatsApp/Telegram unread emphasis).
          color: hasUnread
              ? colorScheme.primary.withValues(alpha: 0.05)
              : Colors.transparent,
          child: Row(
            children: [
              profileAsync.when(
                data: (profile) => ChatAvatar(
                  imageUrl: profile?.picture,
                  name: profile?.displayNameOrName ?? conv.peer,
                  radius: 26,
                ),
                loading: () => ChatAvatar(name: conv.peer, radius: 26),
                error: (_, _) => ChatAvatar(name: conv.peer, radius: 26),
              ),
              const SizedBox(width: 12),
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
                              style: textTheme.titleMedium?.copyWith(
                                fontWeight: hasUnread
                                    ? FontWeight.w800
                                    : FontWeight.w600,
                                letterSpacing: -0.2,
                              ),
                            ),
                            loading: () => Text(
                              _shortKey(conv.peer),
                              style: textTheme.titleMedium,
                            ),
                            error: (_, _) => Text(
                              _shortKey(conv.peer),
                              style: textTheme.titleMedium,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _listTimestamp(timestamp),
                          style: textTheme.labelSmall?.copyWith(
                            color: hasUnread
                                ? colorScheme.primary
                                : colorScheme.onSurfaceVariant,
                            fontWeight: hasUnread
                                ? FontWeight.w700
                                : FontWeight.normal,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            conv.decrypted?.plaintext ?? '…',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: textTheme.bodyMedium?.copyWith(
                              color: hasUnread
                                  ? colorScheme.onSurface
                                  : colorScheme.onSurfaceVariant,
                              fontWeight: hasUnread
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            ),
                          ),
                        ),
                        if (hasUnread) ...[
                          const SizedBox(width: 8),
                          Container(
                            constraints: const BoxConstraints(minWidth: 20),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: colorScheme.primary,
                              borderRadius: AppShapes.radiusFull,
                            ),
                            child: Text(
                              unread > 99 ? '99+' : '$unread',
                              textAlign: TextAlign.center,
                              style: textTheme.labelSmall?.copyWith(
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

    // Swipe left → delete the whole conversation (WhatsApp muscle memory).
    // confirmDismiss returns false — the tile springs back, only the delete
    // confirmation fires. The threshold keeps vertical-scroll-vs-swipe
    // unambiguous.
    return Dismissible(
      key: ValueKey('conv-${conv.peer}'),
      direction: DismissDirection.endToStart,
      dismissThresholds: const {DismissDirection.endToStart: 0.35},
      confirmDismiss: (_) async {
        HapticFeedback.mediumImpact();
        final confirmed = await _confirmDeleteConversation(conv.peer);
        return confirmed; // true → the tile dismisses; false → springs back
      },
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: colorScheme.error,
        child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
      ),
      child: tile,
    );
  }

  /// Confirm + delete a whole conversation (all messages with a peer).
  Future<bool> _confirmDeleteConversation(String peerPubkey) async {
    final colorScheme = Theme.of(context).colorScheme;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete conversation?'),
        content: const Text(
          'This deletes ALL messages with this person from your device. '
          'Messages already on relays may still exist.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: colorScheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return false;
    try {
      await ref.read(dmStoreProvider.notifier).deleteConversation(peerPubkey);
      if (mounted) {
        AppToast.success(context, 'Conversation deleted');
      }
      return true;
    } catch (e) {
      if (mounted) {
        AppToast.error(context, 'Delete failed: $e');
      }
      return false;
    }
  }

  /// Conversation-list timestamp: HH:mm today, weekday this week, date older.
  String _listTimestamp(DateTime t) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(t.year, t.month, t.day);
    final diff = today.difference(day).inDays;
    if (diff <= 0) {
      return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    }
    if (diff == 1) return 'Yesterday';
    if (diff < 7) {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return days[t.weekday - 1];
    }
    return '${t.day.toString().padLeft(2, '0')}/${t.month.toString().padLeft(2, '0')}/${t.year % 100}';
  }

  // ─── Chat thread ───────────────────────────────────────────────────

  Widget _buildChatThread(BuildContext context, String peerPubkey) {
    _activePeer = peerPubkey;
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
    // Gate the read-mark: only when there is genuinely NEWER content than
    // the last mark. Without this the post-frame mark fired on EVERY build
    // (scrolls, history merges, unrelated store bumps) — each one bumped
    // dmStoreVersionProvider and rebuilt the thread a second time.
    if (latestTs > _lastMarkedReadTs) {
      _lastMarkedReadTs = latestTs;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          store.markThreadRead(peerPubkey, latestKnownTs: latestTs);
        }
      });
    }
    final colorScheme = Theme.of(context).colorScheme;

    // Chat threads are IMMERSIVE: AppShell hides its AppBar on /chat/<pubkey>,
    // so this header owns the whole top area — back button, peer identity,
    // encryption status, and profile shortcut in one row (WhatsApp/Telegram
    // style). The conversation list ("/chat" tab) keeps the shell AppBar.
    final headerRow = profileAsync.when(
      data: (profile) => InkWell(
        onTap: () => context.push('/profile/$peerPubkey'),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 6, 8, 10),
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
                radius: 19,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      profile?.displayNameOrName ?? _shortKey(peerPubkey),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 1),
                    // E2EE status pill — the trust signal, quiet but present.
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: colorScheme.primary.withValues(alpha: 0.08),
                        borderRadius: AppShapes.radiusFull,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          AppIcon('key', size: 10, color: colorScheme.primary),
                          const SizedBox(width: 3),
                          Text(
                            'End-to-end encrypted',
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  fontSize: 10,
                                  color: colorScheme.primary,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ],
                      ),
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
    );

    return Scaffold(
      backgroundColor: colorScheme.surface,
      body: Column(
        children: [
          // Immersive thread header.
          Material(
            color: colorScheme.surface,
            child: Container(
              padding: EdgeInsets.only(
                top: MediaQuery.of(context).viewPadding.top,
              ),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: colorScheme.outlineVariant.withValues(alpha: 0.5),
                  ),
                ),
              ),
              child: headerRow,
            ),
          ),
          Expanded(
            child: ref
                .watch(dmThreadProvider(peerPubkey))
                .when(
                  loading: () {
                    // Cold start: paint from the DURABLE store instantly
                    // (no skeleton while the merged result resolves).
                    final stored = ref.watch(dmThreadStoreProvider(peerPubkey));
                    return stored.when(
                      loading: () => const SkeletonList(itemCount: 6),
                      error: (_, _) => const SkeletonList(itemCount: 6),
                      data: (thread) {
                        if (thread.isEmpty) {
                          return const SkeletonList(itemCount: 6);
                        }
                        return _buildThreadList(thread, auth, peerPubkey);
                      },
                    );
                  },
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
                    // Re-anchor ONLY when the newest message changed (a real
                    // new message at index 0) — history pages landing at the
                    // top must never shift the viewport.
                    final newestId = thread.isEmpty ? null : thread.first.id;
                    final isNewMessage =
                        newestId != null && newestId != _newestRenderedId;
                    if (isNewMessage) _captureScrollExtent();
                    _newestRenderedId = newestId;
                    final list = _buildThreadList(thread, auth, peerPubkey);
                    if (isNewMessage) _restoreScrollExtent();
                    return list;
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

  /// The thread's message list — extracted so the cold-start store paint
  /// and the merged provider result share ONE list builder (no duplicate
  /// logic drift between the two paths).
  Widget _buildThreadList(
    List<ChatMessage> thread,
    AuthState auth,
    String peerPubkey,
  ) {
    // Merge the live window with the paged history (scroll-up "load older").
    // The live window (`thread`) holds the newest messages; `history.older`
    // holds pages fetched from the store beneath it. Dedupe by id — the
    // first page overlaps the live window's tail.
    final history = ref.watch(dmHistoryProvider(peerPubkey));
    final List<ChatMessage> merged;
    if (history.older.isEmpty) {
      merged = thread;
    } else {
      final liveIds = thread.map((m) => m.id).toSet();
      merged = [
        ...thread,
        ...history.older.where((m) => !liveIds.contains(m.id)),
      ];
    }
    // Track the oldest rendered message — the keyset cursor for the next
    // "load older" page (used by the scroll listener).
    if (merged.isNotEmpty) {
      _oldestVisibleTs = merged.last.createdAt;
    }
    final showHistorySpinner = history.isLoading;
    final showEndOfHistory = !history.hasMore && merged.length > 30;

    // WhatsApp-style reversed list (the standard Flutter chat pattern):
    // `merged` is newest-first and item 0 renders at the BOTTOM. Short
    // conversations bottom-anchor with NO spacer hack, the list stays glued
    // to the newest message when the keyboard opens, and sending scrolls to
    // offset 0. A jump-to-latest pill appears when the user scrolls up.
    return Stack(
      children: [
        ListView.builder(
          controller: _scrollController,
          reverse: true,
          // Same list padding as the AI chat page.
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          itemCount: merged.length +
              (showHistorySpinner || showEndOfHistory ? 1 : 0),
          itemBuilder: (context, index) {
            // Trailing slot (top of the reversed list): history spinner or
            // the "beginning of conversation" marker.
            if (index >= merged.length) {
              if (showHistorySpinner) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Center(
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                );
              }
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Center(
                  child: Text(
                    'Beginning of conversation',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: Theme.of(context)
                              .colorScheme
                              .onSurfaceVariant,
                        ),
                  ),
                ),
              );
            }
            final msg = merged[index];
            final isSent = msg.senderPubkey == auth.pubkey;
            // The date separator attaches to the OLDEST message of each day
            // (the next item in the list is older in time).
            final showDateSeparator =
                index == merged.length - 1 ||
                !_isSameDay(
                  merged[index].createdAt,
                  merged[index + 1].createdAt,
                );
            // Grouping: this message CONTINUES a group when the next (older)
            // message is from the same sender.
            final continuesGroup =
                index < merged.length - 1 &&
                merged[index + 1].senderPubkey == msg.senderPubkey;
            return Column(
              children: [
                if (showDateSeparator)
                  ChatDateSeparator(timestamp: msg.createdAt),
                // Swipe right → reply to this message (NIP-17 'e' tag reply).
                // Only for text messages.
                GestureDetector(
                  // Only trigger reply on a deliberate rightward swipe
                  // (velocity > threshold). Leftward swipes and slow drags
                  // are ignored — they conflict with vertical scrolling.
                  onHorizontalDragEnd: msg.text.isNotEmpty
                      ? (details) {
                          final velocity = details.primaryVelocity ?? 0;
                          if (velocity > 300) {
                            HapticFeedback.lightImpact();
                            setState(() => _replyingTo = msg);
                          }
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
                    // Long-press → copy/share, same as the AI chat bubble.
                    onLongPress: msg.text.isNotEmpty && !msg.isFile
                        ? () => _showMessageActions(msg)
                        : null,
                  ),
                ),
              ],
            );
          },
        ),
        // WhatsApp's round ↓ button — floats above the input bar when the
        // user has scrolled away from the newest message.
        if (_showJumpToLatest)
          Positioned(
            right: 16,
            bottom: 12,
            child: _JumpToLatestButton(onTap: _scrollToLatest),
          ),
      ],
    );
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
        // Same input-bar language as the AI chat: borderless filled pill
        // field + M3 filled send button on a clean SafeArea row.
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 12, 10),
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
                      : AppIcon(
                          'image',
                          size: AppIconSize.lg,
                          color: colorScheme.onSurfaceVariant,
                        ),
                  tooltip: 'Send an image',
                  onPressed: _isUploading || !auth.isLoggedIn || auth.isReadOnly
                      ? null
                      : () => _sendImage(auth, peerPubkey),
                ),
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    decoration: InputDecoration(
                      hintText: 'Message…',
                      filled: true,
                      fillColor: colorScheme.surfaceContainerHighest,
                      border: OutlineInputBorder(
                        borderRadius: AppShapes.radiusPill,
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                    ),
                    minLines: 1,
                    maxLines: 5,
                    textInputAction: TextInputAction.send,
                    textCapitalization: TextCapitalization.sentences,
                    enabled: auth.isLoggedIn && !auth.isReadOnly,
                    onSubmitted: (_) => _send(auth, peerPubkey),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
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
                      : const AppIcon('send'),
                  tooltip: 'Send',
                ),
              ],
            ),
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
      // Only auto-scroll when the user is already near the bottom — yanking
      // them to the newest message while they're reading history is the
      // "scroll up, list jumps down" bug. 400 px ≈ the same threshold as
      // the jump-to-latest pill.
      if (_scrollController.hasClients && _scrollController.offset < 400) {
        await Future.delayed(const Duration(milliseconds: 100));
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            0,
            duration: AppMotion.normal,
            curve: AppMotion.curve,
          );
        }
      }

      // ── Tier-aware targeted delivery (NIP-17: 1–3 relays, not a spray) ──
      // Paid↔Paid pairs go to the paid relay (premium lane); everyone else
      // goes to our connected relays + the small fallback DM set. The
      // recipient's kind-10050 inbox lookup runs in the background as a
      // targeted boost for external users.
      final selfWrap = giftWraps.length > 1 ? giftWraps[1] : null;
      final myPubkey = auth.pubkey;
      final deliveryTargets = myPubkey != null
          ? await nostr.dmDelivery.deliveryRelaysFor(
              peerPubkey,
              senderPubkey: myPubkey,
            )
          : <String>[];
      final immediateTargets = {
        ...nostr.relayPool.connectedUrls,
        ...deliveryTargets,
        ...DmDelivery.fallbackDmRelays,
      }.toList();
      var delivered = await nostr.relayPool.publishWithAckTo(
        recipientWrap,
        immediateTargets,
      );
      if (selfWrap != null) {
        // Self copy — fire and forget, not on the critical path.
        nostr.publishWithAck(selfWrap).ignore();
      }
      // Retry once on failure before marking failed — a transient relay
      // blip (socket reconnecting, ad-hoc connection still establishing)
      // shouldn't permanently fail the message.
      if (!delivered && mounted) {
        await Future.delayed(const Duration(seconds: 2));
        if (!mounted) return;
        delivered = await nostr.relayPool.publishWithAckTo(
          recipientWrap,
          immediateTargets,
        );
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
      // (Skipped for paid↔paid pairs — the premium lane already delivered.)
      Future(() async {
        try {
          final inbox = await nostr.dmDelivery.deliveryRelaysFor(
            peerPubkey,
            senderPubkey: myPubkey,
          );
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
      // Only auto-scroll when the user is already near the bottom (same
      // rule as _send — don't yank them out of history).
      if (_scrollController.hasClients && _scrollController.offset < 400) {
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

  /// Long-press actions on a message — copy the text, share it out, or
  /// delete it (own messages only, per NIP-17 gift-wrapped kind-5).
  void _showMessageActions(ChatMessage msg) {
    final colorScheme = Theme.of(context).colorScheme;
    HapticFeedback.lightImpact();
    // Only own messages can be deleted (NIP-17: delete is a kind-5 wrap
    // from the sender — you can't delete someone else's message).
    final isOwn = msg.senderPubkey == ref.read(authStateProvider).pubkey;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: AppIcon('edit', color: colorScheme.primary),
              title: const Text('Copy text'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                Clipboard.setData(ClipboardData(text: msg.text));
                AppToast.success(context, 'Copied');
              },
            ),
            ListTile(
              leading: AppIcon('share', color: colorScheme.primary),
              title: const Text('Share…'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                SharePlus.instance.share(ShareParams(text: msg.text));
              },
            ),
            // Delete (own messages only) — NIP-17 gift-wrapped kind-5.
            if (isOwn)
              ListTile(
                leading: AppIcon('eye_off', color: colorScheme.error),
                title: Text(
                  'Delete message',
                  style: TextStyle(color: colorScheme.error),
                ),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  _confirmDeleteMessage(msg);
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// Confirm + delete a message (NIP-17 gift-wrapped kind-5).
  Future<void> _confirmDeleteMessage(ChatMessage msg) async {
    final colorScheme = Theme.of(context).colorScheme;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete message?'),
        content: const Text(
          'This will delete the message for you and notify the recipient. '
          'The message may still exist on relays that already stored it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: colorScheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final peerPubkey = widget.peerNpub;
    if (peerPubkey == null) return;
    try {
      await ref
          .read(dmStoreProvider.notifier)
          .deleteMessage(peerPubkey: peerPubkey, eventId: msg.id);
      if (mounted) {
        AppToast.success(context, 'Message deleted');
      }
    } catch (e) {
      if (mounted) {
        AppToast.error(context, 'Delete failed: $e');
      }
    }
  }

  /// Re-publish a failed message: remove the old entry and send again.
  Future<void> _retryMessage(String peerPubkey, ChatMessage msg) async {
    final auth = ref.read(authStateProvider);
    ref.read(dmStoreProvider.notifier).removePending(peerPubkey, msg.id);
    _messageController.text = msg.text;
    await _send(auth, peerPubkey);
  }

  /// Discard a failed outgoing message (also offers full NIP-17 delete for
  /// sent messages).
  void _deleteFailed(String peerPubkey, ChatMessage msg) {
    // For failed messages, just remove from outbox (they never reached a relay).
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
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: colorScheme.outlineVariant.withValues(alpha: 0.4),
              ),
            ),
          ),
          child: Row(
            children: [
              // Flat accent circle — visually distinct from every DM peer
              // (Refined: no gradients except the logo mark).
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: colorScheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: AppIcon(
                    'sparkle',
                    color: colorScheme.onPrimary,
                    size: 24,
                  ),
                ),
              ),
              const SizedBox(width: 12),
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
                'chevron_r',
                size: 18,
                color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// WhatsApp's round ↓ jump-to-latest button — floats above the input bar
/// when the user has scrolled up into history.
class _JumpToLatestButton extends StatelessWidget {
  final VoidCallback onTap;

  const _JumpToLatestButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Material(
      color: colorScheme.surfaceContainerLowest,
      shape: CircleBorder(
        side: BorderSide(
          color: colorScheme.outlineVariant.withValues(alpha: 0.8),
        ),
      ),
      elevation: 3,
      shadowColor: colorScheme.shadow.withValues(alpha: 0.3),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: AppIcon(
            'arrow_down',
            size: AppIconSize.md,
            color: colorScheme.primary,
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
