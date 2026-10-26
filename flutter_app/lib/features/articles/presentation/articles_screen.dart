import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/utils/markdown.dart';
import 'package:nostrfeed_mobile/core/widgets/app_badge.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/articles/presentation/article_editor_screen.dart';
import 'package:nostrfeed_mobile/features/zap/presentation/zap_sheet.dart';
import 'package:share_plus/share_plus.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:url_launcher/url_launcher.dart';

class ArticlesScreen extends ConsumerWidget {
  const ArticlesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final articles = ref.watch(articlesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Articles'),
        actions: [
          IconButton(
            icon: const AppIcon('search'),
            onPressed: () => context.push('/search'),
            tooltip: 'Search articles',
          ),
        ],
      ),
      body: AsyncFeedList<NostrEvent>(
        value: articles,
        onRefresh: () => ref.refresh(articlesProvider.future),
        emptyState: const EmptyState(
          icon: Icons.article_outlined,
          title: 'No articles yet',
          subtitle: 'Long-form content published on Nostr will appear here.',
        ),
        separator: const SizedBox(height: 12),
        padding: const EdgeInsets.all(16),
        itemBuilder: (context, event) => _ArticleCard(event: event),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openEditor(context, ref),
        icon: const AppIcon('edit'),
        label: const Text('Write'),
      ),
    );
  }

  /// Open the NIP-23 article editor (login-gated).
  void _openEditor(BuildContext context, WidgetRef ref) {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to write articles');
      context.push('/login');
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const ArticleEditorScreen()),
    );
  }
}

class _ArticleCard extends ConsumerWidget {
  final NostrEvent event;
  const _ArticleCard({required this.event});

  int _estimateReadTime(String content) {
    final words = content.split(RegExp(r'\s+')).length;
    final minutes = (words / 200).ceil();
    return minutes < 1 ? 1 : minutes;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    // Content filter (Play compliance): spam/explicit articles hide — the
    // same verdict PostCard applies, articles were the unfiltered gap.
    final verdict = filteredEventVerdict(ref, event);
    if (verdict.action == FilterAction.hide) {
      return const SizedBox.shrink();
    }
    final title = event.getTag('title') ?? 'Untitled';
    // Use markdownToText for a clean summary without formatting artifacts
    final summary =
        event.getTag('summary') ??
        () {
          final plain = sanitizeMarkdownText(markdownToText(event.content));
          return plain.length > 180 ? plain.substring(0, 180) : plain;
        }();
    final image = event.getTag('image');
    final readTime = _estimateReadTime(event.content);
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final zapReceiptsAsync = ref.watch(zapReceiptsProvider(event.id));

    final zapReceipts = zapReceiptsAsync.valueOrNull ?? [];
    final zapCount = zapReceipts.length;
    final zapSats = zapReceipts.fold<int>(
      0,
      (sum, r) => sum + _zapAmountSats(r),
    );

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: InkWell(
        onTap: () => _openArticle(context),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (image != null)
              Stack(
                children: [
                  CachedNetworkImage(
                    httpHeaders: kImageHttpHeaders,
                    imageUrl: image,
                    height: 160,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    placeholder: (_, _) => Container(
                      height: 160,
                      color: scheme.surfaceContainerHigh,
                    ),
                    errorWidget: (_, _, _) => Container(
                      height: 160,
                      color: scheme.surfaceContainerHigh,
                      child: const Center(
                        child: AppIcon('article', size: AppIconSize.xl),
                      ),
                    ),
                  ),
                  // Read-time overlay on cover
                  Positioned(
                    bottom: AppSpacing.xs,
                    right: AppSpacing.xs,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.xs,
                        vertical: AppSpacing.xxs,
                      ),
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerLowest
                            .withValues(alpha: 0.9),
                        borderRadius: AppShapes.radiusSm,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          AppIcon(
                            'clock',
                            size: AppIconSize.xs,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: AppSpacing.xxs),
                          Text(
                            '$readTime min read',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            Padding(
              padding: AppSpacing.paddingMd,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppSpacing.xxs + 2),
                  Text(
                    summary,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(
                          color: scheme.onSurfaceVariant,
                          height: 1.4,
                        ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  // Hairline separator
                  Divider(
                    height: 1,
                    color: scheme.outlineVariant,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      profileAsync.when(
                        data: (profile) => SafeAvatar(
                          imageUrl: profile?.picture,
                          radius: 12,
                          fallback: const AppIcon('users', size: AppIconSize.xs),
                        ),
                        loading: () => const CircleAvatar(radius: 12),
                        error: (_, _) => const CircleAvatar(
                          radius: 12,
                          child: AppIcon('users', size: AppIconSize.xs),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      Expanded(
                        child: Text(
                          profileAsync.value?.displayNameOrName ??
                              '${event.pubkey.substring(0, 8)}…',
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(fontWeight: FontWeight.w500),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      // Zap button + count
                      InkWell(
                        onTap: () => _handleZap(context, ref),
                        borderRadius: AppShapes.radiusMd,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.xs - 2,
                            vertical: 2,
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              AppIcon(
                                'zap',
                                size: AppIconSize.sm,
                                color: AppActionColors.zapFor(
                                    scheme.brightness),
                              ),
                              const SizedBox(width: 2),
                              if (zapCount > 0)
                                Text(
                                  '$zapCount',
                                  style: Theme.of(context)
                                      .textTheme
                                      .labelLarge
                                      ?.copyWith(
                                        color: AppActionColors.zapFor(
                                            scheme.brightness),
                                        fontWeight: FontWeight.w600,
                                      ),
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (zapSats > 0) ...[
                        const SizedBox(width: AppSpacing.xxs),
                        Text(
                          '${_formatSats(zapSats)} sats',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(
                                color: AppActionColors.zapFor(
                                    scheme.brightness),
                                fontWeight: FontWeight.w500,
                              ),
                        ),
                      ],
                      // Read time (when no cover image)
                      if (image == null) ...[
                        const SizedBox(width: AppSpacing.sm - 2),
                        AppIcon(
                          'clock',
                          size: AppIconSize.xs,
                          color: scheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: AppSpacing.xxs),
                        Text(
                          '$readTime min read',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
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
    );
  }

  void _handleZap(BuildContext context, WidgetRef ref) async {
    await showZapDialog(
      context: context,
      targetEvent: event,
      targetPubkey: event.pubkey,
      eventKind: 30023,
    );
    // Refresh zap receipts after dialog closes
    Future.delayed(const Duration(seconds: 2), () {
      ref.invalidate(zapReceiptsProvider(event.id));
    });
  }

  String _formatSats(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }

  void _openArticle(BuildContext context) {
    context.push('/articles/reader', extra: event);
  }
}

/// Full article reader with proper Markdown rendering via flutter_markdown.
class ArticleReaderScreen extends ConsumerStatefulWidget {
  final NostrEvent event;
  const ArticleReaderScreen({super.key, required this.event});

  @override
  ConsumerState<ArticleReaderScreen> createState() =>
      _ArticleReaderScreenState();
}

class _ArticleReaderScreenState extends ConsumerState<ArticleReaderScreen> {
  NostrEvent get event => widget.event;

  /// Article coordinate for addressable lookups: `kind:pubkey:d`
  String get _coordinate {
    final d = event.getTag('d') ?? '';
    return '${event.kind}:${event.pubkey}:$d';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final title = event.getTag('title') ?? 'Untitled';
    final image = event.getTag('image');
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final zapReceiptsAsync = ref.watch(zapReceiptsProvider(event.id));
    final engagementAsync = ref.watch(
      addressableEngagementProvider(_coordinate),
    );
    final commentsAsync = ref.watch(articleCommentsProvider(_coordinate));
    final auth = ref.watch(authStateProvider);

    final zapReceipts = zapReceiptsAsync.valueOrNull ?? [];
    final zapCount = zapReceipts.length;
    final zapSats = zapReceipts.fold<int>(
      0,
      (sum, r) => sum + _zapAmountSats(r),
    );
    final engagement = engagementAsync.valueOrNull;
    final commentCount = commentsAsync.valueOrNull?.length ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          // Zap button in app bar
          IconButton(
            icon: AppBadge.count(
              count: zapCount,
              max: 999,
              color: AppActionColors.zap,
              textColor: Colors.white, // token-guard: allow — on zap-orange badge
              child: const AppIcon('zap', color: AppActionColors.zap),
            ),
            tooltip: 'Zap this article',
            onPressed: () => _handleZap(),
          ),
          IconButton(
            icon: const AppIcon('share'),
            tooltip: 'Share',
            onPressed: _handleShare,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Title
            Text(
              title,
              style: Theme.of(context).textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold, height: 1.3),
            ),
            const SizedBox(height: 12),

            // Author row
            Row(
              children: [
                profileAsync.when(
                  data: (profile) => SafeAvatar(
                    imageUrl: profile?.picture,
                    radius: 16,
                    fallback: const AppIcon('users', size: 16),
                  ),
                  loading: () => const CircleAvatar(radius: 16),
                  error: (_, _) => const CircleAvatar(
                    radius: 16,
                    child: AppIcon('users', size: 16),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        profileAsync.value?.displayNameOrName ??
                            '${event.pubkey.substring(0, 8)}…',
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        timeago.format(
                          DateTime.fromMillisecondsSinceEpoch(
                            event.createdAt * 1000,
                          ),
                        ),
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Engagement & action bar — like, comment, repost, zap, share
            Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.xs, vertical: AppSpacing.xxs),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerLowest,
                borderRadius: AppShapes.radiusMd,
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // Left side: engagement actions
                  Expanded(
                    child: Row(
                      children: [
                        // Like
                        _EngagementChip(
                          iconName: 'heart',
                          count: engagement?.reactions ?? 0,
                          color: AppActionColors.like(scheme.brightness),
                          onTap: auth.isLoggedIn && !auth.isReadOnly
                              ? _handleLike
                              : null,
                        ),
                        const SizedBox(width: AppSpacing.xxs),
                        // Comments
                        _EngagementChip(
                          iconName: 'comment',
                          count: commentCount,
                          color: scheme.primary,
                          onTap: _scrollToComments,
                        ),
                        const SizedBox(width: AppSpacing.xxs),
                        // Repost
                        _EngagementChip(
                          iconName: 'repost',
                          count: engagement?.reposts ?? 0,
                          color: AppActionColors.repost(scheme.brightness),
                          onTap: auth.isLoggedIn && !auth.isReadOnly
                              ? _handleRepost
                              : null,
                        ),
                        const SizedBox(width: AppSpacing.xxs),
                        // Zap
                        _EngagementChip(
                          iconName: 'zap',
                          count: zapCount,
                          satsLabel: zapSats > 0 ? _formatSats(zapSats) : null,
                          color: AppActionColors.zapFor(scheme.brightness),
                          onTap: _handleZap,
                        ),
                      ],
                    ),
                  ),
                  // Right side: share
                  IconButton(
                    icon: AppIcon('share',
                        size: AppIconSize.lg,
                        color: scheme.onSurfaceVariant),
                    onPressed: _handleShare,
                    tooltip: 'Share',
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Hero image
            if (image != null)
              ClipRRect(
                borderRadius: AppShapes.radiusMd,
                child: CachedNetworkImage(
                  httpHeaders: kImageHttpHeaders,
                  imageUrl: image,
                  width: double.infinity,
                  fit: BoxFit.cover,
                  errorWidget: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            if (image != null) const SizedBox(height: 20),

            // Markdown content
            MarkdownBody(
              data: event.content,
              selectable: true,
              shrinkWrap: true,
              softLineBreak: true,
              styleSheet: MarkdownStyleSheet(
                p: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      height: 1.7,
                      color: scheme.onSurface,
                    ),
                h1: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: scheme.onSurface,
                    ),
                h2: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: scheme.onSurface,
                    ),
                h3: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface,
                    ),
                h4: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface,
                    ),
                blockquote: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontStyle: FontStyle.italic,
                      color: scheme.onSurfaceVariant,
                    ),
                blockquoteDecoration: BoxDecoration(
                  border: Border(
                    left: BorderSide(color: scheme.primary, width: 3),
                  ),
                ),
                code: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontFamily: 'monospace',
                      backgroundColor: scheme.surfaceContainerHighest,
                      color: scheme.onSurface,
                    ),
                codeblockDecoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: AppShapes.radiusSm,
                  border: Border.all(
                    color: scheme.outline.withValues(alpha: 0.2),
                  ),
                ),
                a: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: scheme.primary,
                      decoration: TextDecoration.underline,
                    ),
                listBullet: Theme.of(context)
                    .textTheme
                    .bodyLarge
                    ?.copyWith(color: scheme.onSurface),
                img: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: scheme.onSurfaceVariant),
                // Tables: fixed column width so wide tables scroll
                // horizontally instead of squishing columns into nothing.
                // Without this a 4+ column table on a phone is unreadable.
                tableHead: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface,
                    ),
                tableBody: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: scheme.onSurface),
                tableHeadAlign: TextAlign.left,
                tableColumnWidth: const IntrinsicColumnWidth(),
                tableScrollbarThumbVisibility: true,
                tableCellsPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                tableCellsDecoration: BoxDecoration(
                  border: Border.all(color: scheme.outlineVariant, width: 1),
                ),
                tableBorder: TableBorder.all(
                  color: scheme.outlineVariant,
                  width: 1,
                  borderRadius: AppShapes.radiusSm,
                ),
              ),
              onTapLink: (text, href, title) {
                if (href != null) {
                  _openLink(href);
                }
              },
              sizedImageBuilder: (config) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: ClipRRect(
                    borderRadius: AppShapes.radiusSm,
                    child: CachedNetworkImage(
                      httpHeaders: kImageHttpHeaders,
                      imageUrl: config.uri.toString(),
                      fit: BoxFit.cover,
                      placeholder: (_, _) => Container(
                        height: 200,
                        color: scheme.surfaceContainerHighest,
                        child: const Center(child: CircularProgressIndicator()),
                      ),
                      errorWidget: (_, _, _) => Container(
                        height: 120,
                        color: scheme.surfaceContainerHighest,
                        child: const Center(
                          child: AppIcon('image'),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),

            const SizedBox(height: 32),

            // ── Comments section ─────────────────────────────────
            Container(
              key: _commentsScrollKey,
              child: _CommentsSection(
                coordinate: _coordinate,
                rootEvent: event,
                isLoggedIn: auth.isLoggedIn && !auth.isReadOnly,
              ),
            ),

            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Future<void> _openLink(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // ── Action handlers ─────────────────────────────────────────────

  void _handleLike() {
    final nostr = ref.read(nostrServiceProvider);
    final reaction = nostr.createReaction(event, content: '+');
    nostr.publishEvent(reaction);
    HapticFeedback.mediumImpact();
    // Refresh engagement
    Future.delayed(const Duration(seconds: 1), () {
      ref.invalidate(addressableEngagementProvider(_coordinate));
    });
    if (mounted) {
      AppToast.success(context, 'Liked');
    }
  }

  void _handleRepost() {
    final nostr = ref.read(nostrServiceProvider);
    final repost = nostr.createRepost(event);
    nostr.publishEvent(repost);
    HapticFeedback.mediumImpact();
    Future.delayed(const Duration(seconds: 1), () {
      ref.invalidate(addressableEngagementProvider(_coordinate));
    });
    if (mounted) {
      AppToast.success(context, 'Reposted to your feed');
    }
  }

  void _handleZap() async {
    await showZapDialog(
      context: context,
      targetEvent: event,
      targetPubkey: event.pubkey,
      eventKind: 30023,
    );
    // Refresh zap receipts after dialog closes
    Future.delayed(const Duration(seconds: 2), () {
      ref.invalidate(zapReceiptsProvider(event.id));
    });
  }

  void _handleShare() async {
    final title = event.getTag('title') ?? 'Untitled';
    // Build a naddr1… NIP-19 link for this article using the tested encoder.
    final nostr = ref.read(nostrServiceProvider);
    final naddr = nostr.authService.encodeNaddr(
      identifier: event.getTag('d') ?? '',
      pubkey: event.pubkey,
      kind: event.kind,
      relays: const ['wss://relay.nostrfeed.com', 'wss://relay.damus.io'],
    );
    final url = 'https://njump.me/$naddr';

    final box = context.findRenderObject() as RenderBox?;
    final origin = box != null
        ? box.localToGlobal(Offset.zero) & box.size
        : null;

    await SharePlus.instance.share(
      ShareParams(
        text: '"$title"\n\n$url',
        subject: title,
        sharePositionOrigin: origin,
      ),
    );
  }

  final _commentsScrollKey = GlobalKey();

  void _scrollToComments() {
    final ctx = _commentsScrollKey.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(
        ctx,
        duration: AppMotion.slow,
        curve: Curves.easeInOut,
      );
    }
  }

  String _formatSats(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }
}

// ─── Compact engagement chip: icon + count (no label) ──────────────

class _EngagementChip extends StatelessWidget {
  final String iconName;
  final int count;
  final String? satsLabel; // Optional suffix like "1.2K" for zap sats
  final Color color;
  final VoidCallback? onTap;

  const _EngagementChip({
    required this.iconName,
    required this.count,
    this.satsLabel,
    required this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final effectiveColor = enabled ? color : Theme.of(context).disabledColor;

    // Show "0" only if there's no engagement — hide zeros for cleaner look
    final showCount = count > 0;
    final label = satsLabel ?? (showCount ? '$count' : '');

    return Material(
      color: Colors.transparent, // token-guard: allow — ink surface
      child: InkWell(
        onTap: onTap == null
            ? null
            : () {
                HapticFeedback.lightImpact();
                onTap!();
              },
        borderRadius: AppShapes.radiusXl,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm - 2, vertical: AppSpacing.xs - 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppIcon(iconName, size: AppIconSize.md, color: effectiveColor),
              if (label.isNotEmpty) ...[
                const SizedBox(width: AppSpacing.xxs),
                Text(
                  label,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: effectiveColor,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
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

// ─── Comments section (NIP-22 kind 1111) ───────────────────────────

class _CommentsSection extends ConsumerStatefulWidget {
  final String coordinate;
  final NostrEvent rootEvent;
  final bool isLoggedIn;

  const _CommentsSection({
    required this.coordinate,
    required this.rootEvent,
    required this.isLoggedIn,
  });

  @override
  ConsumerState<_CommentsSection> createState() => _CommentsSectionState();
}

class _CommentsSectionState extends ConsumerState<_CommentsSection> {
  final _commentController = TextEditingController();
  bool _isPosting = false;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _postComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty || _isPosting) return;

    setState(() => _isPosting = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final comment = nostr.createComment(
        content: text,
        root: widget.rootEvent,
      );
      nostr.publishEvent(comment);
      _commentController.clear();
      HapticFeedback.mediumImpact();
      // Refresh comments and engagement
      Future.delayed(const Duration(seconds: 1), () {
        ref.invalidate(articleCommentsProvider(widget.coordinate));
        ref.invalidate(addressableEngagementProvider(widget.coordinate));
      });
    } catch (e) {
      if (mounted) {
        AppToast.error(context, 'Failed to post: $e');
      }
    } finally {
      if (mounted) setState(() => _isPosting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final commentsAsync = ref.watch(articleCommentsProvider(widget.coordinate));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Row(
          children: [
            AppIcon('comment', size: 20, color: scheme.primary),
            const SizedBox(width: 8),
            Text(
              'Comments',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(width: 8),
            commentsAsync.when(
              data: (comments) => Text(
                '(${comments.length})',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                      fontWeight: FontWeight.w500,
                    ),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, _) => const SizedBox.shrink(),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // Comment input
        if (widget.isLoggedIn) ...[
          Container(
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLowest,
              borderRadius: AppShapes.radiusLg,
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Column(
              children: [
                TextField(
                  controller: _commentController,
                  maxLines: 3,
                  minLines: 1,
                  decoration: InputDecoration(
                    hintText: 'Add a comment…',
                    border: InputBorder.none,
                    contentPadding: AppSpacing.paddingMd,
                    hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: scheme.onSurfaceVariant.withValues(alpha: 0.6),
                        ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      FilledButton.icon(
                        onPressed: _isPosting ? null : _postComment,
                        icon: _isPosting
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const AppIcon('send', size: 16),
                        label: Text(_isPosting ? 'Posting…' : 'Post'),
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
        ] else ...[
          Container(
            padding: AppSpacing.paddingMd,
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLowest,
              borderRadius: AppShapes.radiusMd,
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Row(
              children: [
                AppIcon('key',
                    size: AppIconSize.md, color: scheme.onSurfaceVariant),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'Log in to comment on this article',
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
        ],

        // Comments list
        commentsAsync.when(
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: CircularProgressIndicator(),
            ),
          ),
          error: (err, _) => Padding(
            padding: AppSpacing.paddingMd,
            child: Text(
              'Failed to load comments',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.error),
            ),
          ),
          data: (comments) {
            if (comments.isEmpty) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: Column(
                    children: [
                      AppIcon('comment',
                          size: AppIconSize.xl + 16,
                          color: scheme.onSurfaceVariant
                              .withValues(alpha: 0.4)),
                      const SizedBox(height: AppSpacing.sm),
                      Text(
                        'No comments yet',
                        style:
                            Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: scheme.onSurfaceVariant,
                                  fontWeight: FontWeight.w500,
                                ),
                      ),
                      const SizedBox(height: AppSpacing.xxs),
                      Text(
                        'Be the first to share your thoughts',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(
                              color: scheme.onSurfaceVariant
                                  .withValues(alpha: 0.7),
                            ),
                      ),
                    ],
                  ),
                ),
              );
            }

            // Sort newest first for display
            final sorted = comments.toList()
              ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

            return Column(
              children: sorted
                  .map((c) => _CommentTile(event: c))
                  .toList(),
            );
          },
        ),
      ],
    );
  }
}

// ─── Single comment tile ───────────────────────────────────────────

class _CommentTile extends ConsumerWidget {
  final NostrEvent event;
  const _CommentTile({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          profileAsync.when(
            data: (profile) => SafeAvatar(
              imageUrl: profile?.picture,
              radius: 18,
              fallback: const AppIcon('users', size: 18),
            ),
            loading: () => const CircleAvatar(radius: 18),
            error: (_, _) => const CircleAvatar(
              radius: 18,
              child: AppIcon('users', size: 18),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Container(
              padding: AppSpacing.paddingSm,
              decoration: BoxDecoration(
                color: scheme.surfaceContainerLowest,
                borderRadius: AppShapes.radiusMd,
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          profileAsync.value?.displayNameOrName ??
                              '${event.pubkey.substring(0, 8)}…',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(fontWeight: FontWeight.w600),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        timeago.format(
                          DateTime.fromMillisecondsSinceEpoch(
                            event.createdAt * 1000,
                          ),
                          locale: 'en_short',
                        ),
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    event.content,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          height: 1.4,
                          color: scheme.onSurface,
                        ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
