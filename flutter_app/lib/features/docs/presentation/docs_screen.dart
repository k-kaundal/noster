import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/features/docs/docs_data.dart';
import 'package:url_launcher/url_launcher.dart';

class DocsScreen extends StatefulWidget {
  const DocsScreen({super.key});

  @override
  State<DocsScreen> createState() => _DocsScreenState();
}

class _DocsScreenState extends State<DocsScreen> {
  String _query = '';
  String _selectedCategory = 'All';

  static const _categories = docCategories;
  static const _docs = appDocs;

  @override
  Widget build(BuildContext context) {
    final filtered = _docs.where((d) {
      final matchesCategory =
          _selectedCategory == 'All' || d.category == _selectedCategory;
      final matchesQuery = _query.isEmpty ||
          d.title.toLowerCase().contains(_query) ||
          d.description.toLowerCase().contains(_query);
      return matchesCategory && matchesQuery;
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Documentation'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(108),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: SearchBar(
                  hintText: 'Search docs…',
                  leading: const Icon(Icons.search),
                  elevation: const WidgetStatePropertyAll(0),
                  backgroundColor: WidgetStatePropertyAll(
                    Theme.of(context).colorScheme.surfaceContainerHighest,
                  ),
                  onChanged: (v) => setState(() => _query = v.toLowerCase()),
                ),
              ),
              SizedBox(
                height: 42,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _categories.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, i) {
                    final cat = _categories[i];
                    return ChoiceChip(
                      label: Text(cat),
                      selected: _selectedCategory == cat,
                      onSelected: (_) =>
                          setState(() => _selectedCategory = cat),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Community links ─────────────────────────────────────
          if (_selectedCategory == 'All' && _query.isEmpty) ...[
            const _CommunitySection(),
            const SizedBox(height: 16),
          ],

          // ── Doc cards ──────────────────────────────────────────
          if (filtered.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: EmptyState(
                icon: Icons.menu_book_outlined,
                title: 'No docs found',
                subtitle: 'Try a different search term.',
              ),
            )
          else
            for (final doc in filtered)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _DocCard(doc: doc),
              ),
        ],
      ),
    );
  }
}

// ─── Community section ─────────────────────────────────────────────

class _CommunitySection extends StatelessWidget {
  const _CommunitySection();

  static const _discordUrl = 'https://discord.gg/CDe6sRwDsd';
  static const _telegramUrl = 'https://t.me/nostrfeed';

  Future<void> _open(String url) async {
    final uri = Uri.parse(url);
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            'COMMUNITY',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.5,
              color: scheme.primary,
            ),
          ),
        ),
        Row(
          children: [
            Expanded(
              child: _CommunityCard(
                icon: Icons.discord_rounded,
                title: 'Discord',
                subtitle: 'Nostr dev server',
                color: const Color(0xFF5865F2),
                onTap: () => _open(_discordUrl),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _CommunityCard(
                icon: Icons.telegram_rounded,
                title: 'Telegram',
                subtitle: '@nostrfeed channel',
                color: const Color(0xFF229ED9),
                onTap: () => _open(_telegramUrl),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _CommunityCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _CommunityCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 26),
              ),
              const SizedBox(height: 10),
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DocCard extends StatelessWidget {
  final AppDoc doc;
  const _DocCard({required this.doc});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          // Guides with real sections open the reader (the route, if any,
          // becomes the "Open it" button at the end). Only a section-less
          // guide deep-links straight to its screen.
          if (doc.sections.isNotEmpty || doc.route == null) {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => _DocReaderScreen(doc: doc)),
            );
          } else {
            context.push(doc.route!);
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(doc.icon,
                    size: 22, color: scheme.onPrimaryContainer),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      doc.title,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      doc.description,
                      style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                          height: 1.4),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: scheme.secondaryContainer,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        doc.category,
                        style: TextStyle(
                            fontSize: 10,
                            color: scheme.onSecondaryContainer),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                doc.route != null
                    ? Icons.open_in_new_rounded
                    : Icons.chevron_right,
                size: 18,
                color: scheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Reads one guide: its sections as headed paragraphs.
class _DocReaderScreen extends StatelessWidget {
  final AppDoc doc;
  const _DocReaderScreen({required this.doc});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: Text(doc.title)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            doc.title,
            style: textTheme.headlineSmall
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: scheme.secondaryContainer,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              doc.category,
              style: TextStyle(
                  fontSize: 12, color: scheme.onSecondaryContainer),
            ),
          ),
          const SizedBox(height: 16),
          for (final section in doc.sections) ...[
            const SizedBox(height: 12),
            Text(
              section.heading,
              style: textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            for (final paragraph in section.paragraphs)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text(
                  paragraph,
                  style: TextStyle(
                    fontSize: 15,
                    height: 1.65,
                    color: scheme.onSurface,
                  ),
                ),
              ),
          ],
          // A guide that deep-links keeps the link at the end of the read.
          if (doc.route != null) ...[
            const SizedBox(height: 20),
            FilledButton.tonalIcon(
              onPressed: () => context.push(doc.route!),
              icon: const Icon(Icons.open_in_new_rounded, size: 18),
              label: const Text('Open it'),
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

