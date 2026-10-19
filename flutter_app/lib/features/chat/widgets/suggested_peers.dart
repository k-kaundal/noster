import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/chat/widgets/chat_avatar.dart';

/// Suggested peers (people you follow) when the query is empty.
class SuggestedPeers extends ConsumerWidget {
  final ValueChanged<String> onSelect;

  const SuggestedPeers({super.key, required this.onSelect});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final followsAsync = ref.watch(followsProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return followsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, _) => const SizedBox.shrink(),
      data: (follows) {
        if (follows.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Search for a user to start a conversation',
              style: TextStyle(color: colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
          );
        }
        // Show first 20 follows
        final shown = follows.take(20).toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text(
                'People you follow',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                itemCount: shown.length,
                itemBuilder: (context, i) => _PeerTileByPubkey(
                  pubkey: shown[i],
                  onTap: () => onSelect(shown[i]),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Tile that fetches profile by pubkey (for "people you follow" list).
class _PeerTileByPubkey extends ConsumerWidget {
  final String pubkey;
  final VoidCallback onTap;

  const _PeerTileByPubkey({required this.pubkey, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(pubkey));

    return profileAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (profile) {
        final name = profile?.displayNameOrName ?? '${pubkey.substring(0, 8)}…';
        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  ChatAvatar(imageUrl: profile?.picture, name: name),
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
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 15,
                                ),
                              ),
                            ),
                            if (profile?.nip05 != null &&
                                profile!.nip05!.isNotEmpty) ...[
                              const SizedBox(width: 4),
                              Icon(
                                Icons.verified_rounded,
                                size: 14,
                                color: colorScheme.primary,
                              ),
                            ],
                          ],
                        ),
                        if (profile?.nip05 != null &&
                            profile!.nip05!.isNotEmpty)
                          Text(
                            profile.nip05!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              color: colorScheme.primary,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.chat_bubble_outline_rounded,
                    size: 18,
                    color: colorScheme.primary,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
