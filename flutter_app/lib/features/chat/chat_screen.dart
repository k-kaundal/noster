import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart' show DecryptedDm;
import 'package:nostrfeed_mobile/core/nostr/dm_delivery.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/features/chat/providers/dm_store.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/chat_avatar.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/chat_date_separator.dart';
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
                    icon: const Icon(Icons.arrow_back_rounded),
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
                      const Icon(Icons.error_outline, size: 48),
                      const SizedBox(height: 16),
                      const Text('Invalid recipient identifier'),
                      const SizedBox(height: 8),
                      Text(
                        widget.peerNpub!,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 12,
                        ),
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
                  icon: const Icon(Icons.add_comment_outlined),
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

  Widget _conversationTile(
    BuildContext context,
    ({String peer, NostrEvent lastEvent, DecryptedDm? decrypted}) conv,
  ) {
    final profileAsync = ref.watch(profileProvider(conv.peer));
    final colorScheme = Theme.of(context).colorScheme;
    final lastTimestamp =
        conv.decrypted?.createdAt ?? conv.lastEvent.createdAt;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      lastTimestamp * 1000,
    );
    // Unread count for this peer (cleared when the thread is opened).
    final dms = ref.watch(dmsProvider).valueOrNull ?? const <NostrEvent>[];
    final unread = ref.read(dmStoreProvider).unreadFor(dms, conv.peer);

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
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 16,
                                letterSpacing: -0.2,
                              ),
                            ),
                            loading: () => Text(_shortKey(conv.peer)),
                            error: (_, _) => Text(_shortKey(conv.peer)),
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
                            conv.decrypted?.plaintext ?? '…',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
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
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              unread > 99 ? '99+' : '$unread',
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
    // Rebuild when the outbox/decryption cache changes (e.g. after sending).
    ref.watch(dmStoreVersionProvider);
    // Opening this thread marks its messages as read (clears unread badge).
    // MUST run post-frame: markThreadRead bumps dmStoreVersionProvider, and
    // modifying a provider DURING build is illegal (crashes the frame).
    final store = ref.read(dmStoreProvider);
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
                          icon: const Icon(Icons.arrow_back_rounded),
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
                                    'End-to-end encrypted',
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
                        IconButton(
                          icon: const Icon(Icons.person_outline_rounded),
                          tooltip: 'View profile',
                          onPressed: () =>
                              context.push('/profile/$peerPubkey'),
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
                        icon: const Icon(Icons.arrow_back_rounded),
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
                        icon: const Icon(Icons.arrow_back_rounded),
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
                  // Wait for BOTH the persisted outbox AND event decryption —
                  // a cold start otherwise shows an empty thread because the
                  // outbox hasn't loaded from disk yet.
                  future: store.ready.then((_) => store.prime(events)),
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
                              onRetry: msg.status == MessageStatus.failed
                                  ? () => _retryMessage(peerPubkey, msg)
                                  : null,
                              onDelete: msg.status == MessageStatus.failed
                                  ? () => _deleteFailed(peerPubkey, msg)
                                  : null,
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
    final store = ref.read(dmStoreProvider);
    try {
      final nostr = ref.read(nostrServiceProvider);
      // NIP-17 gift-wrapped DM (kind 1059). Returns TWO wraps: the
      // recipient's and our own copy (so our other devices can decrypt).
      final giftWraps = nostr.createNip17Dm(peerPubkey, text);
      final recipientWrap = giftWraps.first;
      // Record locally so the message renders immediately (pending state).
      final localId = store.recordSent(
        peerPubkey: peerPubkey,
        plaintext: text,
        eventId: recipientWrap.id,
      );
      _messageController.clear();
      // Opening this thread marked incoming messages read; sending also
      // implies read.
      store.markThreadRead(peerPubkey);
      await Future.delayed(const Duration(milliseconds: 100));
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          0,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }

      // ── Fast delivery ─────────────────────────────────────────────
      // Publish IMMEDIATELY to connected relays + the well-known DM relays
      // (relay.primal.net is in both — Primal users read DMs there). The
      // recipient's kind-10050 inbox lookup happens in the background as a
      // boost and never delays the tick.
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

      // Background boost: find the recipient's DM inbox relays (NIP-17
      // kind 10050 + NIP-65 read relays) and republish there, so users on
      // relays outside our defaults still get it.
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

  /// Re-publish a failed message: remove the old entry and send again.
  Future<void> _retryMessage(String peerPubkey, ChatMessage msg) async {
    final auth = ref.read(authStateProvider);
    ref.read(dmStoreProvider).removePending(peerPubkey, msg.id);
    _messageController.text = msg.text;
    await _send(auth, peerPubkey);
  }

  /// Discard a failed outgoing message.
  void _deleteFailed(String peerPubkey, ChatMessage msg) {
    ref.read(dmStoreProvider).removePending(peerPubkey, msg.id);
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
