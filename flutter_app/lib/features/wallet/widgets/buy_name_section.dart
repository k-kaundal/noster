import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/identity/providers/address_providers.dart';
import 'package:nostrfeed_mobile/features/identity/services/address_service.dart';

// ── Buy Name Section ──────────────────────────────────────────────────

class BuyNameSection extends ConsumerWidget {
  const BuyNameSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final nip5 = ref.watch(nip5Provider);
    final hasNip5 = ref.watch(hasNip5Provider);
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);

    // Hide if the NIP-05 extension isn't available on this server.
    if (!nip5.isAvailable && !nip5.isLoading) {
      return const SizedBox.shrink();
    }

    final published = auth.profile?.nip05;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_outlined, color: colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Verified Name',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              nip5Domains.length > 1
                  ? 'A NIP-05 name under ${nip5Domains.map((d) => d.domain).join(' or ')} — proves who you are across Nostr clients.'
                  : 'A NIP-05 name like you@${nip5Domains.isEmpty ? Env.nip5Domain : nip5Domains.first.domain} — proves who you are across Nostr clients.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 12),
            if (nip5.isLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(8),
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              )
            else if (nip5.identifier != null) ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      nip5.identifier!,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy, size: 18),
                    tooltip: 'Copy name',
                    onPressed: () {
                      Clipboard.setData(
                          ClipboardData(text: nip5.identifier!));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Name copied')),
                      );
                    },
                  ),
                ],
              ),
              if (published != null && published == nip5.identifier) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(Icons.check_circle,
                        size: 16, color: Colors.green.shade600),
                    const SizedBox(width: 4),
                    Text(
                      'Published on your Nostr profile',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.green.shade600,
                      ),
                    ),
                  ],
                ),
              ] else if (!hasNip5) ...[
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: () async {
                    try {
                      await ref
                          .read(nip5Provider.notifier)
                          .publishToProfile();
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Published to your profile')),
                        );
                      }
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('$e')),
                        );
                      }
                    }
                  },
                  icon: const Icon(Icons.publish, size: 16),
                  label: const Text('Publish to profile'),
                  style: TextButton.styleFrom(
                    foregroundColor: colorScheme.primary,
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, 36),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
              ],
            ] else ...[
              SizedBox(
                width: double.infinity,
                child: FilledButton.tonalIcon(
                  onPressed: () => context.push('/wallet/buy-name'),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Get a verified name'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
