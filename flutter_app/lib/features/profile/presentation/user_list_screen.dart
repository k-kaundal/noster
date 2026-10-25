import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';

/// A list of Nostr users (followers / following), each tappable → profile.
class UserListScreen extends ConsumerWidget {
  final String title;
  final List<String> pubkeys;

  const UserListScreen({
    super.key,
    required this.title,
    required this.pubkeys,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DetailScaffold(
      title: title,
      body: pubkeys.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  'No users yet',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: pubkeys.length,
              separatorBuilder: (_, _) => const Divider(indent: 72),
              itemBuilder: (context, i) => _UserTile(pubkey: pubkeys[i]),
            ),
    );
  }
}

class _UserTile extends ConsumerWidget {
  final String pubkey;
  const _UserTile({required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider(pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayNameOrName ??
        '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';

    return ListTile(
      leading: SafeAvatar(
        imageUrl: profile?.picture,
        radius: 22,
        fallback: Text(firstGrapheme(name)),
      ),
      title: Row(
        children: [
          Flexible(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          if (profile?.nip05 != null && profile!.nip05!.isNotEmpty) ...[
            const SizedBox(width: 4),
            AppIcon('verified', size: 14, color: Theme.of(context).colorScheme.primary,
            ),
          ],
        ],
      ),
      subtitle: profile?.nip05 != null && profile!.nip05!.isNotEmpty
          ? Text(
              profile.nip05!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
            )
          : Text(
              '${pubkey.substring(0, 12)}…',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    fontFamily: 'monospace',
                  ),
            ),
      trailing: AppIcon('chevron_r', color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
      onTap: () => context.push('/profile/$pubkey'),
    );
  }
}
