import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:shimmer/shimmer.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';
import '../../utils/markdown.dart';

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
      body: articles.when(
        loading: () => const _ArticlesSkeleton(),
        error: (err, _) => _ErrorView(
          message: 'Failed to load articles',
          onRetry: () => ref.invalidate(articlesProvider),
        ),
        data: (events) {
          if (events.isEmpty) return const _EmptyArticles();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(articlesProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: events.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, index) =>
                  _ArticleCard(event: events[index]),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {},
        icon: const Icon(Icons.edit_note),
        label: const Text('Write'),
      ),
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
    final summary = event.getTag('summary') ??
        markdownToText(event.content).substring(
          0,
          markdownToText(event.content).length > 180
              ? 180
              : markdownToText(event.content).length,
        );
    final image = event.getTag('image');
    final publishedAt = event.getTag('published_at') != null
        ? DateTime.fromMillisecondsSinceEpoch(
            int.parse(event.getTag('published_at')!) * 1000)
        : DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);
    final readTime = _estimateReadTime(event.content);
    final profileAsync = ref.watch(profileProvider(event.pubkey));

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
                      child: Icon(Icons.article_outlined, size: 40)),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
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
                        height: 1.4),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      profileAsync.when(
                        data: (profile) => CircleAvatar(
                          radius: 12,
                          backgroundImage: profile?.picture != null
                              ? CachedNetworkImageProvider(profile!.picture!)
                              : null,
                          child: profile?.picture == null
                              ? const Icon(Icons.person, size: 12)
                              : null,
                        ),
                        loading: () => const CircleAvatar(radius: 12),
                        error: (_, _) => const CircleAvatar(
                            radius: 12, child: Icon(Icons.person, size: 12)),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          profileAsync.value?.displayNameOrName ??
                              '${event.pubkey.substring(0, 8)}…',
                          style: const TextStyle(
                              fontSize: 12, fontWeight: FontWeight.w500),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Icon(Icons.schedule,
                          size: 13, color: scheme.onSurfaceVariant),
                      const SizedBox(width: 4),
                      Text(
                        '$readTime min read',
                        style: TextStyle(
                            fontSize: 12, color: scheme.onSurfaceVariant),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        timeago.format(publishedAt),
                        style: TextStyle(
                            fontSize: 12, color: scheme.onSurfaceVariant),
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

  void _openArticle(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ArticleReaderScreen(event: event),
      ),
    );
  }
}

/// Full article reader with proper Markdown rendering via flutter_markdown.
class ArticleReaderScreen extends ConsumerWidget {
  final NostrEvent event;
  const ArticleReaderScreen({super.key, required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final title = event.getTag('title') ?? 'Untitled';
    final image = event.getTag('image');
    final profileAsync = ref.watch(profileProvider(event.pubkey));

    return Scaffold(
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.share_outlined),
            tooltip: 'Share',
            onPressed: () {
              // Share the article
            },
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
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    height: 1.3,
                  ),
            ),
            const SizedBox(height: 12),

            // Author row
            Row(
              children: [
                profileAsync.when(
                  data: (profile) => CircleAvatar(
                    radius: 16,
                    backgroundImage: profile?.picture != null
                        ? CachedNetworkImageProvider(profile!.picture!)
                        : null,
                    child: profile?.picture == null
                        ? const Icon(Icons.person, size: 16)
                        : null,
                  ),
                  loading: () => const CircleAvatar(radius: 16),
                  error: (_, _) => const CircleAvatar(
                      radius: 16, child: Icon(Icons.person, size: 16)),
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
                              event.createdAt * 1000),
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
            const SizedBox(height: 20),

            // Hero image
            if (image != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: CachedNetworkImage(
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
                    left: BorderSide(
                      color: scheme.primary,
                      width: 3,
                    ),
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
                listBullet: TextStyle(
                  color: scheme.onSurface,
                  fontSize: 16,
                ),
                img: TextStyle(
                  color: scheme.onSurfaceVariant,
                  fontSize: 12,
                ),
                // Tables: fixed column width so wide tables scroll
                // horizontally instead of squishing columns into nothing.
                // Without this a 4+ column table on a phone is unreadable.
                tableHead: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                  color: scheme.onSurface,
                ),
                tableBody: TextStyle(
                  fontSize: 14,
                  color: scheme.onSurface,
                ),
                tableHeadAlign: TextAlign.left,
                tableColumnWidth: const IntrinsicColumnWidth(),
                tableScrollbarThumbVisibility: true,
                tableCellsPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                tableCellsDecoration: BoxDecoration(
                  border: Border.all(
                    color: scheme.outlineVariant,
                    width: 1,
                  ),
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
                      imageUrl: config.uri.toString(),
                      fit: BoxFit.cover,
                      placeholder: (_, _) => Container(
                        height: 200,
                        color: scheme.surfaceContainerHighest,
                        child: const Center(
                          child: CircularProgressIndicator(),
                        ),
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
}

class _EmptyArticles extends StatelessWidget {
  const _EmptyArticles();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.article_outlined, size: 64, color: scheme.primary),
          const SizedBox(height: 16),
          Text(
            'No articles yet',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Long-form content published on Nostr will appear here.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _ArticlesSkeleton extends StatelessWidget {
  const _ArticlesSkeleton();

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: 4,
      itemBuilder: (context, _) => Shimmer.fromColors(
        baseColor: base,
        highlightColor: Theme.of(context).colorScheme.surface,
        child: Card(
          margin: const EdgeInsets.only(bottom: 12),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(height: 140, color: Colors.white),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(height: 16, width: 220, color: Colors.white),
                    const SizedBox(height: 8),
                    Container(height: 12, color: Colors.white),
                    const SizedBox(height: 6),
                    Container(height: 12, width: 160, color: Colors.white),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off, size: 56, color: scheme.error),
          const SizedBox(height: 16),
          Text(message, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
