import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';

class DocsScreen extends StatefulWidget {
  const DocsScreen({super.key});

  @override
  State<DocsScreen> createState() => _DocsScreenState();
}

class _DocsScreenState extends State<DocsScreen> {
  String _query = '';
  String _selectedCategory = 'All';

  static const _categories = ['All', 'Getting Started', 'Nostr', 'Features', 'Wallet', 'Privacy'];

  static const _docs = [
    _Doc(
      title: 'Getting Started with NostrFeed',
      description: 'Learn how to create an account, set up your profile, and publish your first post.',
      category: 'Getting Started',
      icon: Icons.rocket_launch,
    ),
    _Doc(
      title: 'What is Nostr?',
      description: 'An introduction to the Nostr protocol, keys, relays, and decentralized identity.',
      category: 'Nostr',
      icon: Icons.hub,
    ),
    _Doc(
      title: 'Understanding Your Keys',
      description: 'How npub and nsec keys work, how to keep them safe, and what to do if you lose them.',
      category: 'Nostr',
      icon: Icons.key,
    ),
    _Doc(
      title: 'Connecting a Wallet',
      description: 'Set up your Lightning wallet to send and receive zaps using NWC or WebLN.',
      category: 'Wallet',
      icon: Icons.account_balance_wallet,
    ),
    _Doc(
      title: 'Sending & Receiving Zaps',
      description: 'How Lightning zaps work on Nostr and how to zap content you love.',
      category: 'Wallet',
      icon: Icons.bolt,
    ),
    _Doc(
      title: 'Communities & Groups',
      description: 'Create or join communities, moderate content, and participate in group chats.',
      category: 'Features',
      icon: Icons.groups,
    ),
    _Doc(
      title: 'Writing Long-Form Articles',
      description: 'Publish markdown articles on Nostr using kind 30023. Covers formatting and images.',
      category: 'Features',
      icon: Icons.article,
    ),
    _Doc(
      title: 'Bookmarks & Lists',
      description: 'Save posts for later and organize your favorite accounts into curated lists.',
      category: 'Features',
      icon: Icons.bookmark,
    ),
    _Doc(
      title: 'Privacy Best Practices',
      description: 'Understand what data is public on Nostr and how to protect your privacy.',
      category: 'Privacy',
      icon: Icons.privacy_tip,
    ),
    _Doc(
      title: 'Read-Only Mode',
      description: 'Browse Nostr without a private key using read-only npub login.',
      category: 'Privacy',
      icon: Icons.visibility,
    ),
  ];

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

class _Doc {
  final String title;
  final String description;
  final String category;
  final IconData icon;
  const _Doc({
    required this.title,
    required this.description,
    required this.category,
    required this.icon,
  });
}

class _DocCard extends StatelessWidget {
  final _Doc doc;
  const _DocCard({required this.doc});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => _DocReaderScreen(doc: doc),
          ),
        ),
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
              Icon(Icons.chevron_right,
                  size: 18, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

class _DocReaderScreen extends StatelessWidget {
  final _Doc doc;
  const _DocReaderScreen({required this.doc});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(doc.title)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              doc.title,
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.secondaryContainer,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                doc.category,
                style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context)
                        .colorScheme
                        .onSecondaryContainer),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              doc.description,
              style: const TextStyle(fontSize: 16, height: 1.7),
            ),
            const SizedBox(height: 16),
            Text(
              'Full documentation content will be loaded here. This is a placeholder for the complete guide on "${doc.title}".',
              style: TextStyle(
                fontSize: 14,
                height: 1.7,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

