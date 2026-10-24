import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/note_content.dart';
import 'package:nostrfeed_mobile/features/groups/application/group_providers.dart';
import 'package:nostrfeed_mobile/features/groups/group_info_sheet.dart';
import 'package:timeago/timeago.dart' as timeago;

/// NIP-29 relay-group chat room: kind 9 (chat) / kind 11 (thread) / kind 1
/// messages tagged with the group's `h` id, fetched from relays + live
/// subscription for new messages.
class GroupChatScreen extends ConsumerStatefulWidget {
  final NostrEvent groupEvent;

  const GroupChatScreen({super.key, required this.groupEvent});

  @override
  ConsumerState<GroupChatScreen> createState() => _GroupChatScreenState();
}

class _GroupChatScreenState extends ConsumerState<GroupChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  final List<NostrEvent> _messages = [];
  final Set<String> _seen = {};
  StreamSubscription<NostrEvent>? _liveSub;
  bool _loading = true;
  bool _sending = false;

  String get _groupId => widget.groupEvent.getTag('d') ?? widget.groupEvent.id;
  String get _groupName => widget.groupEvent.getTag('name') ?? 'Group';

  @override
  void initState() {
    super.initState();
    _load();
    _subscribeLive();
  }

  @override
  void dispose() {
    _liveSub?.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();
      final events = await nostr.fetchGroupChat(_groupId);
      if (!mounted) return;
      setState(() {
        for (final e in events) {
          if (_seen.add(e.id)) _messages.add(e);
        }
        _messages.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _subscribeLive() {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) return;
    _liveSub = nostr.subscribeGroupChat(_groupId).listen((event) {
      if (!mounted) return;
      if (_seen.add(event.id)) {
        setState(() {
          _messages.insert(0, event);
        });
      }
    });
  }

  /// Admin: delete a group message (NIP-29 kind 9005).
  Future<void> _deleteMessage(NostrEvent event) async {
    try {
      await ref.read(groupControllerProvider).deleteMessage(_groupId, event.id);
      setState(() {
        _messages.removeWhere((m) => m.id == event.id);
        _seen.remove(event.id);
      });
      if (mounted) AppToast.info(context, 'Message deleted');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Delete failed: $e');
    }
  }

  Future<void> _send() async {
    final text = _messageController.text.trim();
    if (text.isEmpty || _sending) return;
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to send messages');
      return;
    }
    HapticFeedback.mediumImpact();
    setState(() => _sending = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final event = nostr.createGroupChatMessage(_groupId, text);
      nostr.publishEvent(event);
      _messageController.clear();
      // Optimistic insert (the live sub will dedupe on echo).
      if (_seen.add(event.id)) {
        setState(() => _messages.insert(0, event));
      }
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          0,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Failed to send: $e');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);
    final picture = widget.groupEvent.getTag('picture');
    final about = widget.groupEvent.getTag('about') ?? '';

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            SafeAvatar(
              imageUrl: picture,
              radius: 18,
              fallback: Icon(Icons.group_rounded,
                  size: 20, color: colorScheme.primary),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _groupName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (about.isNotEmpty)
                    Text(
                      about,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline_rounded),
            tooltip: 'Group info',
            onPressed: () => showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              backgroundColor: Colors.transparent,
              builder: (_) => Container(
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(20)),
                ),
                child: GroupInfoSheet(groupEvent: widget.groupEvent),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.forum_outlined,
                                size: 48,
                                color: colorScheme.onSurfaceVariant),
                            const SizedBox(height: 12),
                            Text(
                              'No messages yet',
                              style: TextStyle(
                                color: colorScheme.onSurfaceVariant,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Start the conversation',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(
                                    color: colorScheme.onSurfaceVariant
                                        .withValues(alpha: 0.7),
                                  ),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          controller: _scrollController,
                          reverse: true,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                          itemCount: _messages.length,
                          itemBuilder: (context, index) => _ChatBubble(
                            event: _messages[index],
                            isMine:
                                _messages[index].pubkey == auth.pubkey,
                            canDelete: ref
                                    .watch(isGroupAdminProvider(_groupId))
                                    .value ??
                                false,
                            onDelete: () =>
                                _deleteMessage(_messages[index]),
                          ),
                        ),
                      ),
          ),
          // Input bar
          Container(
            padding: EdgeInsets.only(
              left: 12,
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
              children: [
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      color: colorScheme.surfaceContainerHighest
                          .withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: TextField(
                      controller: _messageController,
                      decoration: const InputDecoration(
                        hintText: 'Message the group…',
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 10,
                        ),
                      ),
                      minLines: 1,
                      maxLines: 4,
                      enabled: auth.isLoggedIn && !auth.isReadOnly,
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [colorScheme.primary, colorScheme.tertiary],
                    ),
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
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
          ),
        ],
      ),
    );
  }
}

class _ChatBubble extends ConsumerWidget {
  final NostrEvent event;
  final bool isMine;
  final bool canDelete;
  final VoidCallback? onDelete;

  const _ChatBubble({
    required this.event,
    required this.isMine,
    this.canDelete = false,
    this.onDelete,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final time = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    final bubble = Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment:
            isMine ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!isMine) ...[
            SafeAvatar(
              imageUrl: profile?.picture,
              radius: 14,
              fallback: Text(
                firstGrapheme(name),
                style: const TextStyle(fontSize: 11),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment:
                  isMine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                if (!isMine)
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 2),
                    child: Text(
                      name,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: colorScheme.primary,
                      ),
                    ),
                  ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: isMine
                        ? colorScheme.primaryContainer
                        : colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(14),
                      topRight: const Radius.circular(14),
                      bottomLeft: Radius.circular(isMine ? 14 : 4),
                      bottomRight: Radius.circular(isMine ? 4 : 14),
                    ),
                  ),
                  child: NoteContent(
                    event: event,
                    textStyle: TextStyle(
                      fontSize: 14,
                      height: 1.35,
                      color: isMine
                          ? colorScheme.onPrimaryContainer
                          : colorScheme.onSurface,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 2, left: 4, right: 4),
                  child: Text(
                    timeago.format(time, locale: 'en_short'),
                    style: TextStyle(
                      fontSize: 10,
                      color: colorScheme.onSurfaceVariant
                          .withValues(alpha: 0.6),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );

    // Admin: long-press a bubble → delete (NIP-29 kind 9005).
    if (canDelete && onDelete != null) {
      return GestureDetector(
        onLongPress: onDelete,
        child: bubble,
      );
    }
    return bubble;
  }
}
