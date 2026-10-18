import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../providers/app_providers.dart';
import '../../services/relay_pool.dart';
import '../../services/auth_service.dart';

class IdentityScreen extends ConsumerWidget {
  const IdentityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);
    final relayStatus = ref.watch(relayStatusProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Identity')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Profile card
          _ProfileCard(auth: auth),
          const SizedBox(height: 20),

          // Signer status
          _SectionHeader(title: 'Signer'),
          const SizedBox(height: 8),
          _SignerStatusCard(auth: auth),
          const SizedBox(height: 20),

          // NIP-05
          _SectionHeader(title: 'NIP-05 Address'),
          const SizedBox(height: 8),
          _Nip05Card(auth: auth),
          const SizedBox(height: 20),

          // Linked relays
          _SectionHeader(title: 'Linked Relays'),
          const SizedBox(height: 8),
          _RelaysCard(relayStatus: relayStatus),
          const SizedBox(height: 20),

          // Connected apps
          _SectionHeader(title: 'Connected Apps'),
          const SizedBox(height: 8),
          _ConnectedAppsCard(),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _ProfileCard extends ConsumerWidget {
  final AuthState auth;
  const _ProfileCard({required this.auth});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              radius: 30,
              backgroundImage: auth.profile?.picture != null
                  ? CachedNetworkImageProvider(auth.profile!.picture!)
                  : null,
              backgroundColor: scheme.primaryContainer,
              child: auth.profile?.picture == null
                  ? Icon(Icons.person,
                      size: 30, color: scheme.onPrimaryContainer)
                  : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    auth.profile?.displayNameOrName ?? 'Not logged in',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    auth.pubkey != null
                        ? '${auth.pubkey!.substring(0, 16)}…'
                        : 'Sign in to manage your identity',
                    style: TextStyle(
                        fontSize: 12,
                        color: scheme.onSurfaceVariant,
                        fontFamily: 'monospace'),
                  ),
                  if (auth.isReadOnly) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: scheme.tertiaryContainer,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Read-only',
                        style: TextStyle(
                            fontSize: 11,
                            color: scheme.onTertiaryContainer),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SignerStatusCard extends StatelessWidget {
  final AuthState auth;
  const _SignerStatusCard({required this.auth});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final hasKeys = auth.isLoggedIn && !auth.isReadOnly;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          ListTile(
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: hasKeys
                    ? scheme.tertiaryContainer
                    : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                hasKeys ? Icons.key : Icons.key_off,
                color: hasKeys ? scheme.onTertiaryContainer : scheme.onSurfaceVariant,
              ),
            ),
            title: Text(
              hasKeys ? 'Private key signer active' : 'No signer connected',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              hasKeys
                  ? 'Your keys are stored securely on this device.'
                  : 'Log in with an nsec to enable signing.',
            ),
          ),
          if (hasKeys)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(
                children: [
                  _SignerCapability(label: 'NIP-07', supported: true),
                  const SizedBox(width: 8),
                  _SignerCapability(label: 'NIP-44', supported: true),
                  const SizedBox(width: 8),
                  _SignerCapability(label: 'NIP-04', supported: false),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SignerCapability extends StatelessWidget {
  final String label;
  final bool supported;
  const _SignerCapability({required this.label, required this.supported});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: supported
            ? scheme.primaryContainer
            : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            supported ? Icons.check : Icons.close,
            size: 12,
            color: supported
                ? scheme.onPrimaryContainer
                : scheme.onSurfaceVariant,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: supported
                  ? scheme.onPrimaryContainer
                  : scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _Nip05Card extends StatelessWidget {
  final AuthState auth;
  const _Nip05Card({required this.auth});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final nip05 = auth.profile?.nip05;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ListTile(
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: scheme.primaryContainer,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(Icons.verified_user, color: scheme.onPrimaryContainer),
        ),
        title: Text(
          nip05 ?? 'No NIP-05 address',
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          nip05 != null
              ? 'Your verified Nostr address'
              : 'Add a NIP-05 identifier to your profile',
        ),
        trailing: nip05 != null
            ? IconButton(
                icon: const Icon(Icons.copy, size: 18),
                onPressed: () {},
                tooltip: 'Copy',
              )
            : null,
      ),
    );
  }
}

class _RelaysCard extends StatelessWidget {
  final Map<String, RelayState> relayStatus;
  const _RelaysCard({required this.relayStatus});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final relays = relayStatus.isEmpty
        ? ['wss://relay.nostrfeed.com', 'wss://relay.nostr.band', 'wss://nos.lol']
        : relayStatus.keys.toList();

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          for (int i = 0; i < relays.length; i++) ...[
            ListTile(
              dense: true,
              leading: Icon(
                Icons.circle,
                size: 10,
                color: relayStatus[relays[i]] == RelayState.connected
                    ? scheme.tertiary
                    : scheme.onSurfaceVariant,
              ),
              title: Text(
                relays[i],
                style:
                    const TextStyle(fontSize: 13, fontFamily: 'monospace'),
              ),
              trailing: Text(
                relayStatus[relays[i]]?.name ?? 'unknown',
                style: TextStyle(
                    fontSize: 11, color: scheme.onSurfaceVariant),
              ),
            ),
            if (i < relays.length - 1) const Divider(height: 1, indent: 16),
          ],
        ],
      ),
    );
  }
}

class _ConnectedAppsCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          ListTile(
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(Icons.apps, color: scheme.onSurfaceVariant),
            ),
            title: const Text('No connected apps',
                style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: const Text(
                'Apps authorized via Nostr Connect will appear here.'),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(
      title.toUpperCase(),
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: Theme.of(context).colorScheme.primary,
        letterSpacing: 1.2,
      ),
    );
  }
}
