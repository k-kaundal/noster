import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/chat_avatar.dart';

/// Search results list — shows matching users from relays.
class SearchResults extends ConsumerWidget {
  final String query;
  final ValueChanged<String> onSelect;

  const SearchResults({super.key, required this.query, required this.onSelect});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final resultsAsync = ref.watch(userSearchProvider(query));
    final colorScheme = Theme.of(context).colorScheme;

    return resultsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          'Search failed: $e',
          style: TextStyle(color: colorScheme.error),
        ),
      ),
      data: (events) {
        if (events.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'No users found for "$query"',
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            ),
          );
        }
        return ListView.builder(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          itemCount: events.length,
          itemBuilder: (context, i) => _PeerTile(
            event: events[i],
            onTap: () => onSelect(events[i].pubkey),
          ),
        );
      },
    );
  }
}

/// Tile rendering a kind-0 search result.
class _PeerTile extends ConsumerWidget {
  final NostrEvent event;
  final VoidCallback onTap;

  const _PeerTile({required this.event, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    NostrProfile? profile;
    try {
      final json = jsonDecode(event.content) as Map<String, dynamic>;
      profile = NostrProfile.fromJson(json);
    } catch (_) {}
    final name =
        profile?.displayNameOrName ?? '${event.pubkey.substring(0, 8)}…';

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppShapes.radiusMd,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              ChatAvatar(imageUrl: profile?.picture, name: name, radius: 24),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                        if (profile?.nip05 != null &&
                            profile!.nip05!.isNotEmpty) ...[
                          const SizedBox(width: 4),
                          AppIcon(
                            'verified',
                            size: AppIconSize.sm,
                            color: colorScheme.primary,
                          ),
                        ],
                      ],
                    ),
                    if (profile?.nip05 != null && profile!.nip05!.isNotEmpty)
                      Text(
                        profile.nip05!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colorScheme.primary,
                        ),
                      ),
                  ],
                ),
              ),
              AppIcon(
                'chat',
                size: AppIconSize.md,
                color: colorScheme.primary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
