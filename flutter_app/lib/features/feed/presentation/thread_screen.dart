import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';

/// Resolve the event a reply points to (its direct parent), store-first then
/// a bounded relay fetch — for the "in reply to @name" context line.
final _parentEventProvider =
    FutureProvider.family<NostrEvent?, String>((ref, eventId) async {
  final cached = await EventStore.instance.eventById(eventId);
  if (cached != null) return cached;
  try {
    final nostr = await initNostr(ref);
    final ev = await nostr.fetchEventById(eventId);
    if (ev != null) await EventStore.instance.ingest([ev]);
    return ev;
  } catch (_) {
    return null;
  }
});

class ThreadScreen extends ConsumerStatefulWidget {
  final NostrEvent rootEvent;

  const ThreadScreen({super.key, required this.rootEvent});

  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> {
  final _replyController = TextEditingController();
  bool _isPosting = false;

  @override
  void dispose() {
    _replyController.dispose();
    super.dispose();
  }

  Future<void> _postReply() async {
    final content = _replyController.text.trim();
    if (content.isEmpty) return;

    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Log in to reply')),
      );
      return;
    }

    setState(() => _isPosting = true);

    try {
      final nostr = ref.read(nostrServiceProvider);
      // Reply to the post the thread is open on. If that post is itself a
      // reply, propagate the thread root so the new reply threads correctly
      // (NIP-10); notify the parent's author + the thread participants.
      final parent = widget.rootEvent;
      final threadRoot = parent.rootId ?? parent.id;
      final participants = parent.pubkeyRefs;
      final replyEvent = nostr.createReply(
        content,
        parent.id,
        parent.pubkey,
        rootId: threadRoot,
        notifyPubkeys: participants,
      );
      nostr.publishEvent(replyEvent);
      _replyController.clear();

      // Refresh replies
      ref.invalidate(repliesProvider(threadRoot));

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reply posted!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to post reply: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isPosting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Replies attach to the THREAD ROOT — if the post we opened on is itself
    // a reply, the whole conversation hangs off its root, not this post.
    final threadRootId = widget.rootEvent.rootId ?? widget.rootEvent.id;
    final repliesAsync = ref.watch(repliesProvider(threadRootId));
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Thread'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Column(
        children: [
          // ─── Thread content ─────────────────────────────────────
          Expanded(
            child: ListView(
              children: [
                // "In reply to @name" context when the opened post is itself
                // a reply — so the conversation reads top-down like X.
                if (widget.rootEvent.replyToId != null)
                  _ReplyContextBanner(parentId: widget.rootEvent.replyToId!),

                // Parent post
                PostCard(
                  event: widget.rootEvent,
                  isThreadView: true,
                ),

                // Divider
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      Text(
                        'Replies',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: colorScheme.onSurface.withValues(alpha: 0.7),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(child: Divider(color: colorScheme.outlineVariant)),
                    ],
                  ),
                ),

                // Replies list
                repliesAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(32),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (error, _) => Padding(
                    padding: const EdgeInsets.all(16),
                    child: Center(
                      child: Text(
                        'Failed to load replies',
                        style: TextStyle(color: colorScheme.error),
                      ),
                    ),
                  ),
                  data: (replies) {
                    if (replies.isEmpty) {
                      return Padding(
                        padding: const EdgeInsets.all(32),
                        child: Center(
                          child: Text(
                            'No replies yet. Be the first!',
                            style: TextStyle(
                              color: colorScheme.onSurface.withValues(alpha: 0.5),
                            ),
                          ),
                        ),
                      );
                    }

                    // Sort replies by created_at ascending (oldest first)
                    final sorted = List<NostrEvent>.from(replies)
                      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));

                    return Column(
                      children: sorted
                          .map((reply) => PostCard(event: reply))
                          .toList(),
                    );
                  },
                ),
              ],
            ),
          ),

          // ─── Reply input ────────────────────────────────────────
          if (auth.isLoggedIn && !auth.isReadOnly)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: colorScheme.surface,
                border: Border(
                  top: BorderSide(color: colorScheme.outlineVariant),
                ),
              ),
              child: SafeArea(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _replyController,
                        maxLines: 4,
                        minLines: 1,
                        textInputAction: TextInputAction.newline,
                        decoration: InputDecoration(
                          hintText: 'Write a reply...',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide.none,
                          ),
                          filled: true,
                          fillColor: colorScheme.surfaceContainerHighest,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 10,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _isPosting
                        ? const Padding(
                            padding: EdgeInsets.all(8),
                            child: SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          )
                        : IconButton(
                            onPressed: _postReply,
                            icon: Icon(
                              Icons.send,
                              color: colorScheme.primary,
                            ),
                          ),
                  ],
                ),
              ),
            )
          else
            Container(
              padding: const EdgeInsets.all(16),
              child: Text(
                'Log in to reply',
                style: TextStyle(
                  color: colorScheme.onSurface.withValues(alpha: 0.5),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The "in reply to @name" strip above an opened reply — tap to jump to the
/// parent post. Gives the opened reply its conversation context.
class _ReplyContextBanner extends ConsumerWidget {
  final String parentId;
  const _ReplyContextBanner({required this.parentId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final parentAsync = ref.watch(_parentEventProvider(parentId));
    final parent = parentAsync.valueOrNull;
    final profileAsync = parent != null
        ? ref.watch(profileProvider(parent.pubkey))
        : null;
    final name = profileAsync?.valueOrNull?.displayNameOrName ??
        (parent != null
            ? (parent.pubkey.length > 12
                ? '${parent.pubkey.substring(0, 8)}…'
                : parent.pubkey)
            : 'the parent post');

    return Material(
      color: scheme.surfaceContainerLow,
      child: InkWell(
        onTap: parent == null
            ? null
            : () => context.push('/thread', extra: parent),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Icon(Icons.reply_rounded, size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'In reply to $name',
                  style: TextStyle(
                    fontSize: 13,
                    color: scheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (parent != null)
                Icon(Icons.chevron_right_rounded,
                    size: 16, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}
