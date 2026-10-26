import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/report_dialog.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/boost/application/boost_providers.dart';
import 'package:nostrfeed_mobile/features/boost/presentation/boost_sheet.dart';
import 'package:nostrfeed_mobile/features/feed/application/post_actions.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/article_card.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/note_content.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/poll_card.dart';
import 'package:nostrfeed_mobile/features/zap/application/quick_zap.dart';
import 'package:nostrfeed_mobile/features/zap/presentation/zap_sheet.dart';
import 'package:share_plus/share_plus.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Resolve the event a kind-6/16 repost points to when the repost's own
/// content is EMPTY (NIP-18 allows empty repost content — the target lives
/// only in the `e` tag). Without this the card collapsed to nothing — the
/// "this account's posts are all empty" bug for repost-heavy accounts.
/// Store-first (no relay hit when we've already ingested the target), then
/// a bounded relay fetch.
final repostTargetProvider = FutureProvider.family<NostrEvent?, NostrEvent>((
  ref,
  repost,
) async {
  // The reposted event id is the LAST e-tag (NIP-18: the first e-tag is the
  // reposted note for kind 6; kind 16 may carry several).
  final eTags = repost.getTags('e');
  if (eTags.isEmpty) return null;
  final targetId = eTags.first;

  // Store first — the feed ingests events into SQLite, so a target we've
  // seen is free.
  final cached = await EventStore.instance.eventById(targetId);
  if (cached != null) return cached;

  // Bounded relay fetch.
  try {
    final nostr = await initNostr(ref);
    final ev = await nostr.fetchEventById(targetId);
    if (ev != null) await EventStore.instance.ingest([ev]);
    return ev;
  } catch (_) {
    return null;
  }
});

/// A rich post card displaying a Nostr event with author info,
/// rich content (links, hashtags, mentions, images), and action buttons.
/// Handles reposts (kind 6/16) by rendering the embedded original event.
class PostCard extends ConsumerStatefulWidget {
  final NostrEvent event;
  final bool isThreadView;

  /// Primal-style thread connector lines drawn behind the avatar column —
  /// the conversation-chain visual. The thread screen computes these from
  /// index adjacency: a reply that's part of a continuous chain draws a line
  /// up to the previous avatar and/or down to the next one. Ignored outside
  /// the thread view.
  final bool drawLineAboveAvatar;
  final bool drawLineBelowAvatar;

  const PostCard({
    super.key,
    required this.event,
    this.isThreadView = false,
    this.drawLineAboveAvatar = false,
    this.drawLineBelowAvatar = false,
  });

  @override
  ConsumerState<PostCard> createState() => _PostCardState();
}

class _PostCardState extends ConsumerState<PostCard> {
  // Optimistic state — updated immediately on tap, then confirmed by relay.
  // null means "no optimistic action taken", true/false means "liked/unliked"
  // or "reposted/unreposted".
  bool? _optimisticLiked;
  bool? _optimisticReposted;

  @override
  void initState() {
    super.initState();
    _syncOptimistic();
  }

  @override
  void didUpdateWidget(PostCard old) {
    super.didUpdateWidget(old);
    if (old.event.id != widget.event.id) {
      _syncOptimistic();
    }
  }

  void _syncOptimistic() {
    // Reset optimistic state when the event changes
    _optimisticLiked = null;
    _optimisticReposted = null;
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    // ─── Handle reposts (kind 6 / 16) ───────────────────────────────
    // The embedded-event JSON parse is memoized per event id — a feed card
    // rebuilds on every provider update, and jsonDecode + NostrEvent.fromJson
    // per rebuild is scroll jank once the feed is long. See _RepostCache.
    var repostedEvent = _RepostCache.extract(widget.event);

    // A repost with EMPTY content (NIP-18 allows it) has no embedded JSON —
    // the target lives only in the e-tag. Resolve it from the store/relays
    // instead of rendering a blank card (the "repost-heavy account looks
    // empty" bug).
    final isRepostKind = widget.event.kind == 6 || widget.event.kind == 16;
    if (repostedEvent == null && isRepostKind) {
      final targetAsync = ref.watch(repostTargetProvider(widget.event));
      final resolved = targetAsync.valueOrNull;
      if (resolved != null && _isDisplayable(resolved)) {
        repostedEvent = resolved;
      } else if (targetAsync.isLoading) {
        // Resolving the target — show a slim placeholder row, not a blank.
        return const _RepostResolvingTile();
      }
      // If it resolved to null or non-displayable, fall through and render
      // the repost shell below (author + "reposted" header) rather than
      // collapsing entirely.
    }

    final displayEvent = repostedEvent ?? widget.event;
    final isRepost = repostedEvent != null;

    if (!_isDisplayable(displayEvent)) {
      return const SizedBox.shrink();
    }

    // Collapse the WHOLE card when there's nothing renderable — author +
    // action bar with no body is the "name, no post" bug. Articles render
    // via ArticleCard (own content path), so this applies to NoteContent
    // kinds only.
    if (displayEvent.kind != 30023 &&
        !NoteContent.hasRenderableContent(displayEvent)) {
      return const SizedBox.shrink();
    }

    // Content filter: spam and explicit content hide; NIP-36 warnings and
    // #nsfw tags render behind a tap-to-reveal cover. Blocked authors
    // disappear entirely.
    final profileAsync = ref.watch(profileProvider(displayEvent.pubkey));
    final verdict = filteredEventVerdict(
      ref,
      displayEvent,
      authorProfile: profileAsync.valueOrNull,
    );
    if (verdict.action == FilterAction.hide) {
      return const SizedBox.shrink();
    }
    final reposterProfileAsync = isRepost
        ? ref.watch(profileProvider(widget.event.pubkey))
        : null;
    final reposterName =
        reposterProfileAsync?.valueOrNull?.displayNameOrName ??
        _truncatedNpub(widget.event.pubkey);

    // Counts come from the LOCAL SQLite engagement index — the feed ingested
    // a page's worth of likes/reposts/replies/zaps in ONE batched relay query,
    // so this card reads a grouped SQL count instead of firing its own relay
    // query (the old per-card `engagementProvider` did ~150 queries per feed).
    final countsAsync = ref.watch(localEngagementProvider(displayEvent.id));

    // The user's own like/repost state still comes from the relay (it's a
    // per-user query the local index doesn't store).
    final interactionsAsync = ref.watch(
      userInteractionsProvider(displayEvent.id),
    );

    final followsAsync = ref.watch(followsProvider);
    final bookmarkedIdsAsync = ref.watch(bookmarkedIdsProvider);
    final auth = ref.watch(authStateProvider);
    // Watched ONCE here (was duplicated per branch below) — read by the
    // sensitive-content cover branches in the content column.
    final sensitiveMode = ref.watch(sensitiveModeProvider);

    final profile = profileAsync.valueOrNull;
    final authorName =
        profile?.displayNameOrName ?? _truncatedNpub(displayEvent.pubkey);
    final authorPicture = profile?.picture;
    final timeAgo = _TimeAgoCache.format(displayEvent.createdAt);

    // Counts from the local engagement index.
    final counts = countsAsync.valueOrNull ?? EventCounts();

    // Apply optimistic deltas
    final replyCount = counts.replies;
    final reactionCount =
        counts.reactions +
        (_optimisticLiked == true ? 1 : (_optimisticLiked == false ? -1 : 0));
    final repostCount =
        counts.reposts +
        (_optimisticReposted == true
            ? 1
            : (_optimisticReposted == false ? -1 : 0));

    // Interaction states: optimistic takes priority, then relay state
    final interactions = interactionsAsync.valueOrNull;
    final isLiked =
        _optimisticLiked ?? (interactions?.likes[displayEvent.id] ?? false);
    final isReposted =
        _optimisticReposted ??
        (interactions?.reposts[displayEvent.id] ?? false);

    // Zap count comes from the local index too (9735 receipts were ingested
    // with the rest of the engagement batch). The sats total still needs the
    // receipts themselves — that stays a relay fetch, but only when the zap
    // button shows amounts.
    final zapCount = counts.zaps;
    final zapReceiptsAsync = zapCount > 0
        ? ref.watch(zapReceiptsProvider(displayEvent.id))
        : null;
    final zapReceipts = zapReceiptsAsync?.valueOrNull ?? [];
    final zapSats = zapReceipts.fold<int>(
      0,
      (sum, r) => sum + _zapAmountSats(r),
    );

    final follows = followsAsync.valueOrNull ?? [];
    final isFollowing = follows.contains(displayEvent.pubkey);
    final isOwnPost = auth.pubkey == displayEvent.pubkey;
    final bookmarkedIds = bookmarkedIdsAsync.valueOrNull ?? <String>{};
    final isBookmarked = bookmarkedIds.contains(displayEvent.id);
    final brightness = Theme.of(context).brightness;

    // Primal-style card grid: a fixed-width avatar column on the LEFT, and
    // the header + content + actions in a column to its RIGHT (indented by
    // the avatar width + gap). The repost notice aligns with the content
    // column, not the card edge — the signature Primal/X feed look.
    const avatarRadius = 20.0;
    const contentIndent = avatarRadius * 2 + 10; // avatar column + gap = 50

    // The entrance fade only runs in a thread view (one card, one moment).
    // In a feed it must NOT run: the fade spawns an AnimationController per
    // card and replays every time a card re-enters the viewport — with the
    // keep-alive tabs holding hundreds of cards, that's pure scroll jank for
    // zero visible benefit (the feed is already on screen).
    final card = Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.5),
            width: 0.5,
          ),
        ),
      ),
      child: InkWell(
        onTap: widget.isThreadView
            ? null
            : () => context.push('/thread', extra: displayEvent),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ─── Repost header — indented to the content column ──
              if (isRepost) ...[
                Padding(
                  padding: const EdgeInsets.only(left: contentIndent),
                  child: Row(
                    children: [
                      AppIcon(
                        'repost',
                        size: AppIconSize.xs,
                        color: colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '$reposterName reposted',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: colorScheme.onSurfaceVariant,
                                fontWeight: FontWeight.w500,
                              ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 6),
              ],

              // ─── Avatar column + content column ─────────────────
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // LEFT: avatar column (tappable → profile)
                  GestureDetector(
                    onTap: () =>
                        context.push('/profile/${displayEvent.pubkey}'),
                    child: SafeAvatar(
                      imageUrl: authorPicture,
                      radius: avatarRadius,
                      backgroundColor: colorScheme.primaryContainer,
                      fallback: Text(
                        firstGrapheme(authorName),
                        style: TextStyle(
                          color: colorScheme.onPrimaryContainer,
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),

                  // RIGHT: header + content + actions, all in one column
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // ─── Header: name / npub·time + follow + menu ──
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Flexible(
                                        child: Text(
                                          authorName,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 15,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      if (profile?.nip05 != null &&
                                          profile!.nip05!.isNotEmpty) ...[
                                        const SizedBox(width: 4),
                                        AppIcon(
                                          'verified',
                                          size: AppIconSize.xs,
                                          color: colorScheme.primary,
                                        ),
                                      ],
                                    ],
                                  ),
                                  const SizedBox(height: 1),
                                  Row(
                                    children: [
                                      Flexible(
                                        child: Text(
                                          '${_truncatedNpub(displayEvent.pubkey)} · $timeAgo',
                                          style: TextStyle(
                                            color: colorScheme.onSurfaceVariant,
                                            fontSize: 13,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      // Paid placement is labeled, always — an
                                      // unlabeled ad is how a feed loses its readers.
                                      if (ref.watch(
                                        isBoostedProvider(displayEvent.id),
                                      ))
                                        const _BoostedChip(),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            // Follow button + options menu share ONE optical
                            // line: both sit in a 30 dp-tall slot nudged
                            // 3 dp down so they center against the two-line
                            // name/handle header, with a real gap between
                            // them (the shrink-wrapped menu alone sat flush
                            // against Follow at the very top).
                            if (auth.isLoggedIn && !isOwnPost)
                              Padding(
                                padding: const EdgeInsets.only(top: 3),
                                child: _FollowButton(
                                  pubkey: displayEvent.pubkey,
                                  isFollowing: isFollowing,
                                ),
                              ),
                            // Post options (report, etc.) — required for
                            // Play review.
                            Padding(
                              padding: const EdgeInsets.only(left: 4, top: 3),
                              child: SizedBox(
                                height: 30,
                                child: Center(
                                  child: _PostOptionsMenu(event: displayEvent),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),

                        // ─── Content (indented under the header) ───
                        // Articles (kind 30023) render as a compact preview
                        // card that opens the full reader — never the full
                        // markdown inline. Sensitive-content display mode
                        // (user preference): hide / blur-until-tapped /
                        // allow. Default blur. (ONE watch for both branches —
                        // a per-branch duplicate rebuilt the card twice.)
                        if (verdict.action == FilterAction.warn &&
                            sensitiveMode == SensitiveContentMode.hide)
                          const SizedBox.shrink()
                        else if (verdict.action == FilterAction.warn &&
                            sensitiveMode == SensitiveContentMode.blur)
                          _ContentWarningCover(
                            reason: verdict.reason,
                            child: displayEvent.kind == 30023
                                ? ArticleCard(event: displayEvent)
                                : NoteContent(event: displayEvent),
                          )
                        else if (displayEvent.kind == 30023)
                          ArticleCard(event: displayEvent)
                        else ...[
                          NoteContent(event: displayEvent),
                          // NIP-88 polls (kind 1068 embedded in feeds or
                          // referenced).
                          if (displayEvent.kind == 1068)
                            PollCard(event: displayEvent),
                        ],
                        const SizedBox(height: 8),

                        // ─── Action bar (Primal palette) ───────────
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _ActionButton(
                              icon: 'comment',
                              count: replyCount,
                              onTap: widget.isThreadView
                                  ? null
                                  : () => context.push(
                                      '/thread',
                                      extra: displayEvent,
                                    ),
                            ),
                            _ActionButton(
                              icon: 'repost',
                              count: repostCount,
                              color: isReposted
                                  ? AppActionColors.repost(brightness)
                                  : null,
                              onTap: () => _handleRepost(
                                context,
                                ref,
                                auth,
                                displayEvent,
                              ),
                            ),
                            _ActionButton(
                              icon: isLiked ? 'heart_filled' : 'heart',
                              count: reactionCount,
                              color: isLiked
                                  ? AppActionColors.like(brightness)
                                  : null,
                              onTap: () =>
                                  _handleLike(context, ref, auth, displayEvent),
                            ),
                            _ActionButton(
                              icon: 'zap',
                              count: zapCount,
                              label: zapSats > 0
                                  ? '${_formatSats(zapSats)} sats'
                                  : null,
                              // Zap keeps its signature amber as an invite,
                              // active or not (Refined muted, AA per mode).
                              color: AppActionColors.zapFor(brightness),
                              tooltip: 'Tap: zap options · Hold: quick zap',
                              onTap: () =>
                                  _handleZap(context, ref, auth, displayEvent),
                              onLongPress: () => _handleQuickZap(
                                context,
                                ref,
                                auth,
                                displayEvent,
                              ),
                            ),
                            _ActionButton(
                              icon: isBookmarked
                                  ? 'bookmark_filled'
                                  : 'bookmark',
                              count: 0,
                              color: isBookmarked
                                  ? AppActionColors.bookmark
                                  : null,
                              onTap: () => _handleBookmark(
                                context,
                                ref,
                                auth,
                                isBookmarked,
                                displayEvent,
                              ),
                            ),
                            _ActionButton(
                              icon: 'share',
                              count: 0,
                              onTap: () =>
                                  _handleShare(context, ref, displayEvent),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    // Thread connector lines (Primal's drawLineAbove/BelowAvatar): one
    // CustomPaint behind the whole card draws the vertical chain segments at
    // the avatar's center-x — from the card's top edge down to the avatar
    // (line above) and/or from the avatar down to the bottom edge (line
    // below). Only the thread screen passes these flags; feeds never do.
    Widget result = card;
    if (widget.drawLineAboveAvatar || widget.drawLineBelowAvatar) {
      result = CustomPaint(
        painter: _ThreadConnectorPainter(
          lineX: 12 + avatarRadius, // card padding + avatar center
          avatarCenterY: 10 + avatarRadius, // card top padding + avatar center
          drawAbove: widget.drawLineAboveAvatar,
          drawBelow: widget.drawLineBelowAvatar,
          color: colorScheme.outlineVariant,
        ),
        child: result,
      );
    }

    if (!widget.isThreadView) return result;
    return result.animate().fadeIn(
      duration: AppMotion.normal,
      curve: AppMotion.curve,
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  String _truncatedNpub(String pubkey) {
    if (pubkey.length <= 16) return pubkey;
    return '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';
  }

  void _handleRepost(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    NostrEvent displayEvent,
  ) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }

    final interactionsAsync = ref.read(
      userInteractionsProvider(displayEvent.id),
    );
    final currentlyReposted =
        _optimisticReposted ??
        (interactionsAsync.valueOrNull?.reposts[displayEvent.id] ?? false);

    // Optimistic UI update; the actual publish/delete + provider refresh
    // is handled by the PostActions controller.
    setState(() => _optimisticReposted = !currentlyReposted);
    ref
        .read(postActionsProvider)
        .toggleRepost(
          event: displayEvent,
          currentlyReposted: currentlyReposted,
        );
    AppToast.success(
      context,
      currentlyReposted ? 'Repost removed' : 'Reposted!',
    );
  }

  void _handleLike(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    NostrEvent displayEvent,
  ) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }

    final interactionsAsync = ref.read(
      userInteractionsProvider(displayEvent.id),
    );
    final currentlyLiked =
        _optimisticLiked ??
        (interactionsAsync.valueOrNull?.likes[displayEvent.id] ?? false);

    setState(() => _optimisticLiked = !currentlyLiked);
    ref
        .read(postActionsProvider)
        .toggleLike(event: displayEvent, currentlyLiked: currentlyLiked);
  }

  void _handleZap(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    NostrEvent displayEvent,
  ) async {
    await showZapDialog(
      context: context,
      targetEvent: displayEvent,
      targetPubkey: displayEvent.pubkey,
    );
    // After the zap sheet closes, refresh zap receipts so the count updates
    ref.read(postActionsProvider).refreshZaps(displayEvent.id);
  }

  /// Long-press on ⚡: send the user's default amount with NO sheet —
  /// small gratitude should cost one gesture, not a flow. Falls back to
  /// the full sheet whenever a decision is genuinely needed (no wallet,
  /// amount out of bounds, big spends).
  void _handleQuickZap(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    NostrEvent displayEvent,
  ) async {
    final amount = ref.read(quickZapAmountProvider);

    // Big spends always get the sheet — one-tap is for small gratitude.
    if (amount > quickZapMaxSats) {
      _handleZap(context, ref, auth, displayEvent);
      return;
    }

    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }

    // Immediate feedback — the zap feels instant while it settles.
    AppToast.info(context, 'Zapping $amount sats…');

    final result = await sendQuickZap(
      ref.read,
      event: displayEvent,
      amountSats: amount,
    );
    if (!context.mounted) return;

    switch (result) {
      case QuickZapResult.sent:
        HapticFeedback.heavyImpact();
        AppToast.success(context, '⚡ Zapped $amount sats!');
        ref.read(postActionsProvider).refreshZaps(displayEvent.id);
      case QuickZapResult.noWallet:
        // No in-app wallet can pay — the sheet shows the QR fallback.
        _handleZap(context, ref, auth, displayEvent);
      case QuickZapResult.noAddress:
        AppToast.warning(context, 'This user has no lightning address set');
      case QuickZapResult.amountOutOfBounds:
        AppToast.warning(
          context,
          "Amount outside this recipient's limits — adjust "
          'your quick-zap amount in the zap sheet',
        );
        _handleZap(context, ref, auth, displayEvent);
      case QuickZapResult.loginRequired:
        _showLoginPrompt(context);
      case QuickZapResult.failed:
        AppToast.error(context, 'Zap failed — try the zap sheet');
        _handleZap(context, ref, auth, displayEvent);
    }
  }

  Future<void> _handleBookmark(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    bool isBookmarked,
    NostrEvent displayEvent,
  ) async {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    try {
      await ref
          .read(postActionsProvider)
          .toggleBookmark(
            event: displayEvent,
            isCurrentlyBookmarked: isBookmarked,
          );
      if (context.mounted) {
        AppToast.success(
          context,
          isBookmarked ? 'Bookmark removed' : 'Bookmarked!',
        );
      }
    } catch (e) {
      if (context.mounted) {
        AppToast.error(context, 'Failed to bookmark: $e');
      }
    }
  }

  void _handleShare(
    BuildContext context,
    WidgetRef ref,
    NostrEvent displayEvent,
  ) {
    final nostr = ref.read(nostrServiceProvider);
    final note1 = nostr.authService.encodeNote(displayEvent.id);
    // sharePositionOrigin is required on iOS to anchor the share sheet
    final box = context.findRenderObject() as RenderBox?;
    final origin = box != null
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 100, 100);
    SharePlus.instance.share(
      ShareParams(text: 'nostr:$note1', sharePositionOrigin: origin),
    );
  }

  void _showLoginPrompt(BuildContext context) {
    AppToast.info(context, 'Log in to interact with posts');
  }

  String _formatSats(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }
}

// ─── Repost-resolving placeholder ───────────────────────────────────

/// A slim shimmer row shown while a repost's empty-content target is being
/// fetched — never a blank gap in the feed.
class _RepostResolvingTile extends StatelessWidget {
  const _RepostResolvingTile();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          SkeletonCircle(radius: 22),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonLine(width: 120, height: 12),
                SizedBox(height: 8),
                SkeletonLine(height: 10),
                SizedBox(height: 6),
                SkeletonLine(width: 200, height: 10),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Post Options Menu ──────────────────────────────────────────────

/// 3-dot menu on every post: Report (NIP-56, required by Google Play's
/// child-safety review), Block author (UGC policy requires a block
/// mechanism), plus Copy text.
class _PostOptionsMenu extends ConsumerWidget {
  final NostrEvent event;
  const _PostOptionsMenu({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isBlocked = ref.watch(blockedAuthorsProvider).contains(event.pubkey);

    return PopupMenuButton<String>(
      icon: AppIcon(
        'more',
        size: AppIconSize.md,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
      tooltip: 'Post options',
      padding: EdgeInsets.zero,
      // Shrink the tap target to the icon (18 dp) instead of Material's
      // default 48 dp box — the card header top-aligns accessories with the
      // name line, and the big box centered the icon ~14 px below it.
      style: IconButton.styleFrom(
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      onSelected: (value) async {
        switch (value) {
          case 'quote':
            final auth = ref.read(authStateProvider);
            if (!auth.isLoggedIn || auth.isReadOnly) {
              AppToast.info(context, 'Log in to quote posts');
              return;
            }
            context.push('/compose', extra: event);
          case 'boost':
            final auth = ref.read(authStateProvider);
            if (!auth.isLoggedIn || auth.isReadOnly) {
              AppToast.info(context, 'Log in to boost posts');
              return;
            }
            showBoostSheet(context, event);
          case 'report':
            showReportDialog(context, eventId: event.id, pubkey: event.pubkey);
          case 'copy_text':
            Clipboard.setData(ClipboardData(text: event.content));
            AppToast.success(context, 'Text copied');
          case 'block':
            final notifier = ref.read(blockedAuthorsProvider.notifier);
            if (isBlocked) {
              await notifier.remove(event.pubkey);
              if (context.mounted) {
                AppToast.success(context, 'Author unblocked');
              }
            } else {
              await notifier.add(event.pubkey);
              if (context.mounted) {
                AppToast.success(
                  context,
                  'Author blocked — their posts are hidden',
                );
              }
            }
        }
      },
      itemBuilder: (context) => [
        const PopupMenuItem(
          value: 'quote',
          child: Row(
            children: [
              AppIcon('article', size: 18),
              SizedBox(width: 10),
              Text('Quote post'),
            ],
          ),
        ),
        if (ref.watch(boostAvailableProvider).valueOrNull ?? false)
          const PopupMenuItem(
            value: 'boost',
            child: Row(
              children: [
                Icon(
                  Icons.rocket_launch_outlined,
                  size: 18,
                  color: Colors.amber,
                ),
                SizedBox(width: 10),
                Text('Boost post'),
              ],
            ),
          ),
        PopupMenuItem(
          value: 'report',
          child: Row(
            children: [
              AppIcon('target', size: 18, color: Theme.of(context).colorScheme.error,
              ),
              const SizedBox(width: 10),
              Text(
                'Report post',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'block',
          child: Row(
            children: [
              Icon(
                isBlocked
                    ? Icons.person_add_outlined
                    : Icons.person_off_outlined,
                size: 18,
              ),
              const SizedBox(width: 10),
              Text(isBlocked ? 'Unblock author' : 'Block author'),
            ],
          ),
        ),
        const PopupMenuItem(
          value: 'copy_text',
          child: Row(
            children: [
              AppIcon('edit', size: 18),
              SizedBox(width: 10),
              Text('Copy text'),
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Boosted chip ───────────────────────────────────────────────────

/// The "⚡ Boosted" label on a promoted post. Always shown when the card is
/// in a paid slot — ads transparency, and Play policy, both require it.
class _BoostedChip extends StatelessWidget {
  const _BoostedChip();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.amber.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const AppIcon('zap', size: 11, color: Colors.amber),
            const SizedBox(width: 2),
            Text(
              'Boosted',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Follow Button ─────────────────────────────────────────────────

class _FollowButton extends ConsumerWidget {
  final String pubkey;
  final bool isFollowing;

  const _FollowButton({required this.pubkey, required this.isFollowing});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;

    // Primal's FollowUnfollowButton treatment: a quiet pill that doesn't
    // compete with the content — follow = onSurface bg / surface fg
    // (inverted, not primary-filled); following = muted container.
    return SizedBox(
      height: 30,
      child: isFollowing
          ? OutlinedButton(
              onPressed: () => _toggleFollow(context, ref),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                side: BorderSide(color: colorScheme.outline),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Text(
                'Following',
                style: TextStyle(
                  fontSize: 12,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
            )
          : FilledButton(
              onPressed: () => _toggleFollow(context, ref),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                backgroundColor: colorScheme.onSurface,
                foregroundColor: colorScheme.surface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Text(
                'Follow',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
    );
  }

  Future<void> _toggleFollow(BuildContext context, WidgetRef ref) async {
    final auth = ref.read(authStateProvider);
    // Silent no-op on a dead tap reads as a broken button — tell the user
    // WHY nothing happened and where to go (Primal prompts sign-in too).
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.info(context, 'Log in to follow people');
      return;
    }

    final nostr = ref.read(nostrServiceProvider);
    final follows = ref.read(followsProvider).valueOrNull ?? [];

    final updated = isFollowing
        ? follows.where((pk) => pk != pubkey).toList()
        : [...follows, pubkey];

    final event = nostr.updateFollows(updated);
    nostr.publish(event);
    ref.invalidate(followsProvider);

    // Confirmation — a follow/unfollow that only flips a label is easy to
    // miss; the toast carries the result (Primal toasts too).
    if (context.mounted) {
      AppToast.success(
        context,
        isFollowing ? 'Unfollowed' : 'Following — their posts join your feed',
      );
    }
  }
}

// ─── Action Button ─────────────────────────────────────────────────

class _ActionButton extends StatelessWidget {
  /// Refined stroke-icon asset name (assets/icons/`icon`.svg).
  final String icon;
  final int count;
  final String? label;
  final VoidCallback? onTap;

  /// Secondary gesture — used by the zap button for one-tap quick zaps.
  final VoidCallback? onLongPress;
  final String? tooltip;
  final Color? color;

  const _ActionButton({
    required this.icon,
    required this.count,
    this.label,
    this.onTap,
    this.onLongPress,
    this.tooltip,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final effectiveColor = color ?? colorScheme.onSurfaceVariant;

    // FEED-PERF RULE: no per-card AnimationController — 6 of these buttons
    // per PostCard × ~15 cards in viewport+cache = ~90 live tickers vsyncing
    // every frame (battery + frame pressure, worse as the keep-alive tab
    // grows). The tap "pop" is a fire-and-forget implicit animation instead:
    // the only per-button State object exists for AppMotion.fast (150 ms)
    // during an actual tap, not for the card's whole lifetime.
    final child = InkWell(
      onTap: onTap != null
          ? () {
              HapticFeedback.lightImpact();
              onTap!();
            }
          : null,
      onLongPress: onLongPress != null
          ? () {
              HapticFeedback.mediumImpact();
              onLongPress!();
            }
          : null,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _PopIcon(icon: icon, color: effectiveColor),
            if (count > 0) ...[
              const SizedBox(width: 5),
              Text(
                label ?? _formatCount(count),
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: effectiveColor,
                      fontWeight: FontWeight.w500,
                    ),
              ),
            ],
          ],
        ),
      ),
    );
    if (tooltip != null) {
      return Tooltip(message: tooltip!, child: child);
    }
    return child;
  }

  static String _formatCount(int count) {
    if (count >= 1000000) return '${(count / 1000000).toStringAsFixed(1)}M';
    if (count >= 1000) return '${(count / 1000).toStringAsFixed(1)}K';
    return count.toString();
  }
}

/// The action icon with a tap "pop" scale — a self-contained implicit
/// animation (restarts on every tap down) so the button needs no
/// AnimationController of its own. The [State] object only lives in the
/// element tree while the parent does, but the animation is driven by
/// [TweenAnimationBuilder]'s shared ticker machinery rather than a
/// dedicated per-button vsync callback.
class _PopIcon extends StatefulWidget {
  /// Refined stroke-icon asset name (assets/icons/`icon`.svg).
  final String icon;
  final Color color;

  const _PopIcon({required this.icon, required this.color});

  @override
  State<_PopIcon> createState() => _PopIconState();
}

class _PopIconState extends State<_PopIcon> {
  /// Monotonic counter bumped on every tap-down — restarting the tween.
  int _pops = 0;

  @override
  Widget build(BuildContext context) {
    return Listener(
      // Translucent so the tap still falls through to the parent's InkWell
      // (this only observes the press to fire the pop; it never claims it).
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => setState(() => _pops++),
      child: TweenAnimationBuilder<double>(
        // A new key per tap-down restarts the tween from 1.25 → 1.0.
        key: ValueKey(_pops),
        tween: Tween(begin: 1.25, end: 1.0),
        duration: AppMotion.fast,
        curve: AppMotion.curveEmphasis,
        builder: (context, value, child) =>
            Transform.scale(scale: value, child: child),
        child: AppIcon(widget.icon, size: AppIconSize.md, color: widget.color),
      ),
    );
  }
}

/// Whether an event should be rendered as a post card.
///
/// Returns false for events whose content is machine-readable JSON rather
/// than human-readable text. This catches:
/// - Kind 0 profile metadata wrapped in a generic repost (kind 16)
/// - Kind 3 contact lists wrapped in a generic repost
/// - Kind 10002 relay lists wrapped in a generic repost
/// - Any kind 1 whose content starts with `{` (JSON payload, not a note)
///
/// The web app handles this by only attempting `JSON.parse` when content
/// starts with `{` and validating the parsed object has `id` and `content`
/// string fields. We mirror that here.
bool _isDisplayable(NostrEvent event) {
  // Only these kinds should be rendered as a post card
  if (![1, 20, 21, 22, 30023].contains(event.kind)) return false;

  final trimmed = event.content.trim();
  if (trimmed.isEmpty) return true; // Empty note is fine (e.g. media-only)

  // Encrypted / token payloads (ecash, NIP-04/44 ciphertext) are NOT hidden
  // — they render as a proper card (`EcashTokenCard`) in NoteContent, never
  // as a base64 text wall. So they stay displayable here.

  // If it starts with `{`, it's almost certainly JSON, not a note.
  // Some clients embed JSON in kind 1 for machine-readable data — those
  // aren't meant to be read as posts.
  if (trimmed.startsWith('{')) {
    // Exception: a tiny number of clients post JSON that IS the note content.
    // We try to parse it and check if it looks like a Nostr event.
    try {
      final parsed = jsonDecode(trimmed) as Map<String, dynamic>;
      // If it has an `id` and `content` field, it's an embedded event,
      // not a note. Don't display it.
      if (parsed.containsKey('id') && parsed.containsKey('content')) {
        return false;
      }
      // If it has a `name` or `about` field, it's profile metadata.
      if (parsed.containsKey('name') || parsed.containsKey('about')) {
        return false;
      }
      // If it has a `relays` field, it's a relay list.
      if (parsed.containsKey('relays')) {
        return false;
      }
      // Otherwise it might be a legitimate note that happens to start with `{`.
      // Let it through — the NoteContent renderer will handle it as text.
      return true;
    } catch (_) {
      // Not valid JSON — treat it as plain text. Some notes genuinely
      // start with `{` (e.g. "{gm}").
      return true;
    }
  }

  return true;
}

/// Extract zap amount in sats from a kind 9735 zap receipt.
///
/// Per NIP-57, the amount is NOT a top-level tag on the receipt. Two sources:
/// 1. The `description` tag contains a JSON-encoded kind 9734 zap request
///    with an `amount` tag in millisats.
/// 2. The `bolt11` tag encodes the amount in the invoice prefix.
int _zapAmountSats(NostrEvent receipt) {
  // Try the description tag first (zap request has the amount tag)
  final desc = receipt.getTag('description');
  if (desc != null) {
    try {
      final zapReq = jsonDecode(desc) as Map<String, dynamic>;
      final tags = (zapReq['tags'] as List?)?.cast<List<dynamic>>() ?? [];
      for (final tag in tags) {
        if (tag.isNotEmpty && tag[0] == 'amount' && tag.length > 1) {
          final msats = int.tryParse(tag[1].toString()) ?? 0;
          return msats ~/ 1000; // msats → sats
        }
      }
    } catch (_) {}
  }

  // Fallback: parse bolt11 prefix
  final bolt11 = receipt.getTag('bolt11');
  if (bolt11 != null) {
    final match = RegExp(
      r'^lnbc(\d+)([munp]?)',
      caseSensitive: false,
    ).firstMatch(bolt11);
    if (match != null) {
      final value = BigInt.parse(match.group(1)!);
      final mult = match.group(2) ?? '';
      const satsPerBtc = 100000000; // 10^8 sats per BTC
      BigInt sats;
      switch (mult.toLowerCase()) {
        case 'm':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000);
          break;
        case 'u':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000000);
          break;
        case 'n':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000000000);
          break;
        case 'p':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000000000000);
          break;
        default:
          sats = value * BigInt.from(satsPerBtc);
      }
      return sats.toInt();
    }
  }

  return 0;
}

/// NIP-36: content the author marked sensitive, behind a tap-to-reveal
/// cover. The cover exists because the poster asked for it — this is their
/// label, respected, not the app second-guessing their post.
class _ContentWarningCover extends StatefulWidget {
  final String reason;
  final Widget child;
  const _ContentWarningCover({required this.reason, required this.child});

  @override
  State<_ContentWarningCover> createState() => _ContentWarningCoverState();
}

class _ContentWarningCoverState extends State<_ContentWarningCover> {
  bool _revealed = false;

  @override
  Widget build(BuildContext context) {
    if (_revealed) return widget.child;

    final scheme = Theme.of(context).colorScheme;
    final label = switch (widget.reason) {
      'nsfw-tag' => 'Tagged #nsfw by the author',
      _ => 'Marked as sensitive by the author',
    };

    return InkWell(
      onTap: () => setState(() => _revealed = true),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(
              Icons.visibility_off_outlined,
              size: 28,
              color: scheme.onSurfaceVariant,
            ),
            const SizedBox(height: 8),
            Text(
              'Sensitive content',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: scheme.onSurface,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Text(
              'Tap to view',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: scheme.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Memoized `timeago.format` keyed on the event's created_at — the string
/// for a given timestamp only changes with wall-clock time, but feed cards
/// rebuild far more often than a "x minutes ago" label meaningfully updates.
/// A 60-second granularity keeps labels honest while making rebuilds cheap.
class _TimeAgoCache {
  _TimeAgoCache._();

  static const int _maxEntries = 400;
  static final Map<int, String> _map = {};

  static String format(int createdAtSeconds) {
    // Bucket to the minute: a post's "5m" label doesn't need to flip at the
    // second level, and bucketing is what makes the cache hit.
    final bucket = createdAtSeconds ~/ 60;
    final cached = _map[bucket];
    if (cached != null) {
      _map.remove(bucket);
      _map[bucket] = cached;
      return cached;
    }
    final formatted = timeago.format(
      DateTime.fromMillisecondsSinceEpoch(createdAtSeconds * 1000),
    );
    _map[bucket] = formatted;
    if (_map.length > _maxEntries) {
      _map.remove(_map.keys.first);
    }
    return formatted;
  }
}

/// Memoized wrapper around `extractRepostedEvent` — a kind-6/16 repost's
/// embedded event costs a full jsonDecode + NostrEvent.fromJson, and a feed
/// card rebuilds on every provider update. Bounded LRU so scrolled-past
/// reposts don't accumulate.
class _RepostCache {
  _RepostCache._();

  static const int _maxEntries = 400;
  static final Map<String, NostrEvent?> _map = {};

  static NostrEvent? extract(NostrEvent event) {
    // Only kinds 6/16 can be reposts — everything else short-circuits free.
    if (event.kind != 6 && event.kind != 16) return null;
    final key = event.id;
    if (_map.containsKey(key)) {
      final cached = _map[key];
      // LRU touch.
      _map.remove(key);
      _map[key] = cached;
      return cached;
    }
    final extracted = extractRepostedEvent(event);
    _map[key] = extracted;
    if (_map.length > _maxEntries) {
      _map.remove(_map.keys.first);
    }
    return extracted;
  }
}

/// Draws the Primal-style thread connector segments behind the avatar
/// column: a 2 dp vertical line at the avatar's center-x, running from the
/// card's top edge to the avatar (chain continues upward) and/or from the
/// avatar to the card's bottom edge (chain continues downward). The line
/// stops at the avatar's edge so it never crosses the avatar image —
/// Primal's `shareableGraphics` does exactly this with `drawWithCache`.
class _ThreadConnectorPainter extends CustomPainter {
  final double lineX;
  final double avatarCenterY;
  final bool drawAbove;
  final bool drawBelow;
  final Color color;

  _ThreadConnectorPainter({
    required this.lineX,
    required this.avatarCenterY,
    required this.drawAbove,
    required this.drawBelow,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.butt;

    // The line stops a couple px clear of the avatar so it reads as
    // "connected to" the avatar, not "drawn under" it.
    const avatarRadius = 20.0;
    const clearance = 2.0;
    final avatarTop = avatarCenterY - avatarRadius - clearance;
    final avatarBottom = avatarCenterY + avatarRadius + clearance;

    if (drawAbove) {
      canvas.drawLine(Offset(lineX, 0), Offset(lineX, avatarTop), paint);
    }
    if (drawBelow) {
      canvas.drawLine(
        Offset(lineX, avatarBottom),
        Offset(lineX, size.height),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_ThreadConnectorPainter old) =>
      old.lineX != lineX ||
      old.avatarCenterY != avatarCenterY ||
      old.drawAbove != drawAbove ||
      old.drawBelow != drawBelow ||
      old.color != color;
}
