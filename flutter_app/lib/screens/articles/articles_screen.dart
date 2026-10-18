import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

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
            onPressed: () {},
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
    final summary = event.getTag('summary') ??
        (event.content.length > 140
            ? '${event.content.substring(0, 140)}…'
            : event.content);
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
        builder: (_) => _ArticleReaderScreen(event: event),
      ),
    );
  }
}

class _ArticleReaderScreen extends StatelessWidget {
  final NostrEvent event;
  const _ArticleReaderScreen({required this.event});

  @override
  Widget build(BuildContext context) {
    final title = event.getTag('title') ?? 'Untitled';
    final image = event.getTag('image');

    return Scaffold(
      appBar: AppBar(title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
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
            const SizedBox(height: 16),
            Text(
              event.content,
              style: const TextStyle(fontSize: 16, height: 1.7),
            ),
          ],
        ),
      ),
    );
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
