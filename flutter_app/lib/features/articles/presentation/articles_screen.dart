import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/utils/markdown.dart';
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
            icon: const Icon(Icons.search),
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
        icon: const Icon(Icons.edit_note),
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

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        onTap: () => _openArticle(context),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (image != null)
              CachedNetworkImage(
                httpHeaders: kImageHttpHeaders,
                imageUrl: image,
                height: 160,
                width: double.infinity,
                fit: BoxFit.cover,
                placeholder: (_, _) => Container(
                  height: 160,
                  color: scheme.surfaceContainerHighest,
                ),
                errorWidget: (_, _, _) => Container(
                  height: 160,
                  color: scheme.surfaceContainerHighest,
                  child: const Center(
                    child: Icon(Icons.article_outlined, size: 40),
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
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
                  const SizedBox(height: 6),
                  Text(
                    summary,
                    style: TextStyle(
                      fontSize: 13,
                      color: scheme.onSurfaceVariant,
                      height: 1.4,
                    ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      profileAsync.when(
                        data: (profile) => SafeAvatar(
                          imageUrl: profile?.picture,
                          radius: 12,
                          fallback: const Icon(Icons.person, size: 12),
                        ),
                        loading: () => const CircleAvatar(radius: 12),
                        error: (_, _) => const CircleAvatar(
                          radius: 12,
                          child: Icon(Icons.person, size: 12),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          profileAsync.value?.displayNameOrName ??
                              '${event.pubkey.substring(0, 8)}…',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      // Zap button + count
                      InkWell(
                        onTap: () => _handleZap(context, ref),
                        borderRadius: BorderRadius.circular(12),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.bolt,
                                size: 16,
                                color: Colors.amber.shade700,
                              ),
                              const SizedBox(width: 2),
                              if (zapCount > 0)
                                Text(
                                  '$zapCount',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Colors.amber.shade700,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (zapSats > 0) ...[
                        const SizedBox(width: 4),
                        Text(
                          '${_formatSats(zapSats)} sats',
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.amber.shade700,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                      const SizedBox(width: 10),
                      Icon(
                        Icons.schedule,
                        size: 13,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '$readTime min read',
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
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
            icon: Badge(
              isLabelVisible: zapCount > 0,
              label: Text(
                zapCount > 999 ? '999+' : '$zapCount',
                style: const TextStyle(fontSize: 9),
              ),
              backgroundColor: Colors.amber.shade700,
              textColor: Colors.white,
              child: Icon(Icons.bolt, color: Colors.amber.shade700),
            ),
            tooltip: 'Zap this article',
            onPressed: () => _handleZap(),
          ),
          IconButton(
            icon: const Icon(Icons.share_outlined),
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
                    fallback: const Icon(Icons.person, size: 16),
                  ),
                  loading: () => const CircleAvatar(radius: 16),
                  error: (_, _) => const CircleAvatar(
                    radius: 16,
                    child: Icon(Icons.person, size: 16),
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
                        style: const TextStyle(fontWeight: FontWeight.w600),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        timeago.format(
                          DateTime.fromMillisecondsSinceEpoch(
                            event.createdAt * 1000,
                          ),
                        ),
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Engagement & action bar — like, comment, repost, zap, share
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(12),
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
                          icon: Icons.favorite_border,
                          count: engagement?.reactions ?? 0,
                          color: Colors.pink.shade400,
                          onTap: auth.isLoggedIn && !auth.isReadOnly
                              ? _handleLike
                              : null,
                        ),
                        const SizedBox(width: 4),
                        // Comments
                        _EngagementChip(
                          icon: Icons.chat_bubble_outline,
                          count: commentCount,
                          color: scheme.primary,
                          onTap: _scrollToComments,
                        ),
                        const SizedBox(width: 4),
                        // Repost
                        _EngagementChip(
                          icon: Icons.repeat,
                          count: engagement?.reposts ?? 0,
                          color: Colors.green.shade600,
                          onTap: auth.isLoggedIn && !auth.isReadOnly
                              ? _handleRepost
                              : null,
                        ),
                        const SizedBox(width: 4),
                        // Zap
                        _EngagementChip(
                          icon: Icons.bolt,
                          count: zapCount,
                          satsLabel: zapSats > 0 ? _formatSats(zapSats) : null,
                          color: Colors.amber.shade700,
                          onTap: _handleZap,
                        ),
                      ],
                    ),
                  ),
                  // Right side: share
                  IconButton(
                    icon: Icon(Icons.share_outlined,
                        size: 20, color: scheme.onSurfaceVariant),
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
                borderRadius: BorderRadius.circular(12),
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
                p: TextStyle(
                  fontSize: 16,
                  height: 1.7,
                  color: scheme.onSurface,
                ),
                h1: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: scheme.onSurface,
                  height: 1.3,
                ),
                h2: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: scheme.onSurface,
                  height: 1.3,
                ),
                h3: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurface,
                  height: 1.3,
                ),
                h4: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurface,
                ),
                blockquote: TextStyle(
                  fontStyle: FontStyle.italic,
                  color: scheme.onSurfaceVariant,
                  fontSize: 15,
                ),
                blockquoteDecoration: BoxDecoration(
                  border: Border(
                    left: BorderSide(color: scheme.primary, width: 3),
                  ),
                ),
                code: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  backgroundColor: scheme.surfaceContainerHighest,
                  color: scheme.onSurface,
                ),
                codeblockDecoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: scheme.outline.withValues(alpha: 0.2),
                  ),
                ),
                a: TextStyle(
                  color: scheme.primary,
                  decoration: TextDecoration.underline,
                ),
                listBullet: TextStyle(color: scheme.onSurface, fontSize: 16),
                img: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                // Tables: fixed column width so wide tables scroll
                // horizontally instead of squishing columns into nothing.
                // Without this a 4+ column table on a phone is unreadable.
                tableHead: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                  color: scheme.onSurface,
                ),
                tableBody: TextStyle(fontSize: 14, color: scheme.onSurface),
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
                  borderRadius: BorderRadius.circular(8),
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
                    borderRadius: BorderRadius.circular(8),
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
                          child: Icon(Icons.broken_image_outlined),
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Liked'),
          duration: Duration(seconds: 1),
          behavior: SnackBarBehavior.floating,
        ),
      );
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Reposted to your feed'),
          duration: Duration(seconds: 2),
          behavior: SnackBarBehavior.floating,
        ),
      );
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
        duration: const Duration(milliseconds: 400),
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
  final IconData icon;
  final int count;
  final String? satsLabel; // Optional suffix like "1.2K" for zap sats
  final Color color;
  final VoidCallback? onTap;

  const _EngagementChip({
    required this.icon,
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
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap == null
            ? null
            : () {
                HapticFeedback.lightImpact();
                onTap!();
              },
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: effectiveColor),
              if (label.isNotEmpty) ...[
                const SizedBox(width: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to post: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
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
            Icon(Icons.chat_bubble_outline, size: 20, color: scheme.primary),
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
                style: TextStyle(
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
              color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: scheme.outlineVariant.withValues(alpha: 0.5),
              ),
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
                    contentPadding: const EdgeInsets.all(16),
                    hintStyle: TextStyle(
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
                            : const Icon(Icons.send_rounded, size: 16),
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
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Icon(Icons.lock_outline, size: 18, color: scheme.onSurfaceVariant),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Log in to comment on this article',
                    style: TextStyle(color: scheme.onSurfaceVariant),
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
            padding: const EdgeInsets.all(16),
            child: Text(
              'Failed to load comments',
              style: TextStyle(color: scheme.error),
            ),
          ),
          data: (comments) {
            if (comments.isEmpty) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: Column(
                    children: [
                      Icon(
                        Icons.chat_bubble_outline,
                        size: 40,
                        color: scheme.onSurfaceVariant.withValues(alpha: 0.4),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'No comments yet',
                        style: TextStyle(
                          color: scheme.onSurfaceVariant,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Be the first to share your thoughts',
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
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
              fallback: const Icon(Icons.person, size: 18),
            ),
            loading: () => const CircleAvatar(radius: 18),
            error: (_, _) => const CircleAvatar(
              radius: 18,
              child: Icon(Icons.person, size: 18),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(12),
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
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                          ),
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
                        style: TextStyle(
                          fontSize: 11,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    event.content,
                    style: TextStyle(
                      fontSize: 14,
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
