import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

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

/// The freshest known version of the thread's root event. A thread opened
/// from a notification/search passes a possibly-stale event object (old
/// content, old engagement); this re-reads the store (warm from the ingest
/// pipeline) and backfills from the relay once, so the card shows CURRENT
/// data — the "notification tap shows stale data" bug.
final _freshRootProvider =
    FutureProvider.family<NostrEvent, NostrEvent>((ref, passed) async {
  // Store-first: the pipeline keeps it warm; a newer revision may already
  // be local. Fall back to the passed object if the store is behind/absent.
  final stored = await EventStore.instance.eventById(passed.id);
  var best = (stored != null && stored.createdAt >= passed.createdAt)
      ? stored
      : passed;

  // Relay backfill (bounded): picks up edits + freshens counts/engagement
  // landing since the passed object was created.
  try {
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchEventById(passed.id);
    if (fresh != null) {
      await EventStore.instance.ingest([fresh]);
      if (fresh.createdAt >= best.createdAt) best = fresh;
    }
  } catch (_) {
    // Offline — the store/passed version stands.
  }
  return best;
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
      AppToast.warning(context, 'Log in to reply');
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

      // OPTIMISTIC INSERT: write the reply into the local store BEFORE the
      // relay round-trip. repliesProvider is store-first, so the reply
      // renders immediately (kill the "posted but invisible → double-post"
      // bug) and the parent's reply count includes it right away.
      await EventStore.instance.ingest([replyEvent]);

      // Refresh replies — store-first, so the optimistic reply shows now
      // and the relay backfill merges in behind it.
      ref.invalidate(repliesProvider(threadRoot));

      if (mounted) {
        AppToast.success(context, 'Reply posted!');
      }
    } catch (e) {
      if (mounted) {
        AppToast.error(context, 'Failed to post reply: $e');
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

    // Sort once per build (oldest first), not per item. Root-author replies
    // first within the same second keeps the OP's voice visible (Primal).
    final sortedReplies = repliesAsync.valueOrNull == null
        ? const <NostrEvent>[]
        : (List<NostrEvent>.from(repliesAsync.value!)
          ..sort((a, b) => a.createdAt.compareTo(b.createdAt)));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Thread'),
        leading: IconButton(
          icon: const AppIcon('back'),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Column(
        children: [
          // ─── Thread content ─────────────────────────────────────
          //
          // ONE flat lazy list (Primal pattern): the header (context banner +
          // parent post + "Replies" divider) is item 0 and each reply is its
          // own lazily-built item. The old Column-inside-ListView built ALL
          // reply cards eagerly — a 200-reply thread composed 200 PostCards
          // (each with 6 action buttons + provider watches) on open and
          // froze the screen. ListView.builder builds only what's visible.
          Expanded(
            child: ListView.builder(
              // Header + replies, or header + a single status item while
              // loading / on error / when empty.
              itemCount: 1 +
                  (repliesAsync.hasValue && sortedReplies.isNotEmpty
                      ? sortedReplies.length
                      : 1),
              itemBuilder: (context, index) {
                if (index == 0) {
                  return _buildHeader(
                    colorScheme,
                    // The opened post connects DOWN to the first reply —
                    // Primal's chain starts at the focused note.
                    drawLineBelow:
                        repliesAsync.hasValue && sortedReplies.isNotEmpty,
                  );
                }
                if (repliesAsync.hasValue && sortedReplies.isNotEmpty) {
                  final reply = sortedReplies[index - 1];
                  return PostCard(
                    key: ValueKey(reply.id),
                    event: reply,
                    // Chain lines (Primal drawLineAbove/BelowAvatar): every
                    // reply links up to the card above it; every reply but
                    // the last links down to the next one. Replies keep
                    // isThreadView=false so they stay tappable (open as a
                    // new thread) and skip the entrance fade (the feed-perf
                    // rule — no per-card fades in a list).
                    drawLineAboveAvatar: true,
                    drawLineBelowAvatar: index - 1 < sortedReplies.length - 1,
                  );
                }
                return _buildStatusItem(colorScheme, repliesAsync);
              },
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
                            borderRadius: AppShapes.radiusPill,
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

  /// The thread header: "in reply to" context + the opened post + the
  /// "Replies" divider. Built as item 0 of the lazy list. The root card
  /// renders the FRESHEST known event (notification taps pass stale objects).
  Widget _buildHeader(ColorScheme colorScheme, {bool drawLineBelow = false}) {
    final rootAsync = ref.watch(_freshRootProvider(widget.rootEvent));
    final root = rootAsync.valueOrNull ?? widget.rootEvent;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (root.replyToId != null)
          _ReplyContextBanner(parentId: root.replyToId!),
        PostCard(
          key: ValueKey('root-${root.id}-${root.createdAt}'),
          event: root,
          isThreadView: true,
          drawLineBelowAvatar: drawLineBelow,
        ),
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
      ],
    );
  }

  /// The single status item shown while replies load, on error, or when the
  /// thread has no replies yet.
  Widget _buildStatusItem(
    ColorScheme colorScheme,
    AsyncValue<List<NostrEvent>> repliesAsync,
  ) {
    return repliesAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, _) => Padding(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: Text(
            'Failed to load replies',
            style: TextStyle(color: colorScheme.error),
          ),
        ),
      ),
      data: (_) => Padding(
        padding: const EdgeInsets.all(32),
        child: Center(
          child: Text(
            'No replies yet. Be the first!',
            style: TextStyle(
              color: colorScheme.onSurface.withValues(alpha: 0.5),
            ),
          ),
        ),
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
              AppIcon('comment', size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'In reply to $name',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (parent != null)
                AppIcon('chevron_r', size: 16, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}
