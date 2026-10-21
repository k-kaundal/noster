import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/identity/providers/address_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/identity/services/address_service.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/features/auth/services/key_backup_service.dart';

/// Identity screen: profile, signer, lightning address, NIP-05, and relays.
class IdentityScreen extends ConsumerWidget {
  const IdentityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

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

          // Lightning Address
          _SectionHeader(title: 'Lightning Address'),
          const SizedBox(height: 8),
          const _LightningAddressCard(),
          const SizedBox(height: 20),

          // NIP-05 Verified Name
          _SectionHeader(title: 'Verified Name (NIP-05)'),
          const SizedBox(height: 8),
          const _Nip5Card(),
          const SizedBox(height: 20),

          // Free Address
          _SectionHeader(title: 'Free Address'),
          const SizedBox(height: 8),
          const _FreeAddressCard(),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

// ── Profile Card ─────────────────────────────────────────────────────

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
            SafeAvatar(
              imageUrl: auth.profile?.picture,
              radius: 30,
              backgroundColor: scheme.primaryContainer,
              fallback: Icon(Icons.person,
                  size: 30, color: scheme.onPrimaryContainer),
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

// ── Signer Status Card ───────────────────────────────────────────────

class _SignerStatusCard extends ConsumerWidget {
  final AuthState auth;
  const _SignerStatusCard({required this.auth});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
          if (hasKeys) ...[
            const Divider(height: 1, indent: 16, endIndent: 16),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(Icons.shield_outlined,
                          size: 16, color: scheme.error),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Back up your key — there is no password reset.',
                          style: TextStyle(
                            fontSize: 12.5,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _exportKey(context, ref),
                          icon: const Icon(Icons.download_outlined, size: 18),
                          label: const Text('Download key file'),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _copyKey(context, ref),
                          icon: const Icon(Icons.copy_outlined, size: 18),
                          label: const Text('Copy nsec'),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _exportKey(BuildContext context, WidgetRef ref) async {
    final privHex = auth.privateKey;
    final pubHex = auth.pubkey;
    if (privHex == null || pubHex == null) return;
    try {
      final authService = ref.read(nostrServiceProvider).authService;
      final saved = await KeyBackupService.saveKeyFile(
        nsec: authService.encodeNsec(privHex),
        hexPrivateKey: privHex,
        npub: authService.encodeNpub(pubHex),
        pubkey: pubHex,
      );
      if (saved && context.mounted) {
        AppToast.success(context, 'Key file saved — keep it private');
      }
    } catch (e) {
      if (context.mounted) AppToast.error(context, 'Could not save file: $e');
    }
  }

  Future<void> _copyKey(BuildContext context, WidgetRef ref) async {
    final privHex = auth.privateKey;
    if (privHex == null) return;
    final nsec = ref.read(nostrServiceProvider).authService.encodeNsec(privHex);
    await Clipboard.setData(ClipboardData(text: nsec));
    if (context.mounted) {
      AppToast.success(context, 'nsec copied — store it somewhere safe');
    }
  }
}

// ── Lightning Address Card ───────────────────────────────────────────

class _LightningAddressCard extends ConsumerWidget {
  const _LightningAddressCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final lightning = ref.watch(lightningAddressProvider);
    final auth = ref.watch(authStateProvider);
    final lnbits = ref.watch(lnbitsAuthProvider);
    final hasAddress = ref.watch(hasLightningAddressProvider);

    if (!lnbits.isConnected) {
      return Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.bolt_outlined, color: scheme.onSurfaceVariant),
          ),
          title: const Text('No wallet connected',
              style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text(
              'Connect your wallet to get a lightning address'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push('/wallet/lnbits'),
        ),
      );
    }

    if (lightning.isLoading) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    final address = lightning.primaryAddress;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          if (address != null) ...[
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.amber.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.bolt, color: Colors.amber),
              ),
              title: Text(
                address,
                style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontFamily: 'monospace',
                    fontSize: 14),
              ),
              subtitle: Text(
                hasAddress
                    ? 'Published on your profile — anyone can zap you'
                    : 'Not on your profile yet — publish it to receive zaps',
              ),
              trailing: IconButton(
                icon: const Icon(Icons.copy, size: 18),
                tooltip: 'Copy address',
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: address));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Address copied')),
                  );
                },
              ),
            ),
            if (!hasAddress && auth.isLoggedIn && !auth.isReadOnly)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.tonalIcon(
                    onPressed: () async {
                      try {
                        await ref
                            .read(lightningAddressProvider.notifier)
                            .publishToProfile();
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('Profile updated — zaps enabled!')),
                          );
                        }
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Failed: $e')),
                          );
                        }
                      }
                    },
                    icon: const Icon(Icons.publish, size: 18),
                    label: const Text('Publish to Profile'),
                  ),
                ),
              ),
          ] else ...[
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.bolt_outlined, color: scheme.onSurfaceVariant),
              ),
              title: const Text('No lightning address',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text(
                  'Claim a lightning address to receive zaps'),
            ),
            if (auth.isLoggedIn && !auth.isReadOnly)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => _showClaimDialog(context, ref),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Claim Address'),
                  ),
                ),
              ),
          ],
          // Show all addresses if there are multiple
          if (lightning.addresses.length > 1) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'All addresses (${lightning.addresses.length})',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 8),
                  for (final addr in lightning.addresses)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        children: [
                          Icon(
                            addr == address
                                ? Icons.check_circle
                                : Icons.circle_outlined,
                            size: 14,
                            color: addr == address
                                ? Colors.green
                                : scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              addr,
                              style: TextStyle(
                                fontSize: 12,
                                fontFamily: 'monospace',
                                color: addr == address
                                    ? scheme.onSurface
                                    : scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          // Silent addresses warning
          if (lightning.silentAddresses.isNotEmpty) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(Icons.warning_amber,
                      size: 16, color: Colors.orange.shade700),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${lightning.silentAddresses.length} address(es) receive money but don\'t publish zap receipts on Nostr.',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.orange.shade700,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () =>
                        ref.read(lightningAddressProvider.notifier).enableZaps(),
                    child: const Text('Fix', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _showClaimDialog(BuildContext context, WidgetRef ref) {
    final controller = TextEditingController();
    bool isClaiming = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Claim Lightning Address'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: controller,
                decoration: InputDecoration(
                  labelText: 'Username',
                  hintText: 'alice',
                  prefixIcon: const Icon(Icons.alternate_email),
                  suffixText: '@${Env.lightningAddressDomain}',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'This creates a lightning address that people can zap from any Nostr client.',
                style: Theme.of(ctx).textTheme.bodySmall,
              ),
              if (errorMsg != null) ...[
                const SizedBox(height: 12),
                Text(errorMsg!,
                    style: TextStyle(
                        color: Theme.of(ctx).colorScheme.error,
                        fontSize: 12)),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: isClaiming ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: isClaiming
                  ? null
                  : () async {
                      final username = controller.text.trim().toLowerCase();
                      if (username.isEmpty) return;
                      setState(() {
                        isClaiming = true;
                        errorMsg = null;
                      });
                      try {
                        await ref
                            .read(lightningAddressProvider.notifier)
                            .claim(username: username);
                        if (ctx.mounted) Navigator.pop(ctx);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                                content: Text(
                                    '$username@${Env.lightningAddressDomain} is yours!')),
                          );
                        }
                      } catch (e) {
                        setState(() {
                          isClaiming = false;
                          errorMsg = e.toString();
                        });
                      }
                    },
              child: const Text('Claim'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── NIP-05 Card ──────────────────────────────────────────────────────

class _Nip5Card extends ConsumerWidget {
  const _Nip5Card();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final nip5 = ref.watch(nip5Provider);
    final auth = ref.watch(authStateProvider);
    final lnbits = ref.watch(lnbitsAuthProvider);
    final hasNip5 = ref.watch(hasNip5Provider);

    if (!lnbits.isConnected) {
      return Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.verified_outlined, color: scheme.onSurfaceVariant),
          ),
          title: const Text('No wallet connected',
              style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text(
              'Connect your wallet to get a verified NIP-05 name'),
        ),
      );
    }

    if (nip5.isLoading) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    if (!nip5.isAvailable) {
      return Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.verified_outlined, color: scheme.onSurfaceVariant),
          ),
          title: const Text('Not available',
              style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text(
              'Verified names are not enabled on this LNbits instance'),
        ),
      );
    }

    final identifier = nip5.identifier;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          if (identifier != null) ...[
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.verified, color: scheme.onPrimaryContainer),
              ),
              title: Text(
                identifier,
                style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontFamily: 'monospace',
                    fontSize: 14),
              ),
              subtitle: Text(
                hasNip5
                    ? 'Published on your profile — shows the ✓ badge'
                    : 'Not on your profile yet — publish it to show the ✓',
              ),
              trailing: IconButton(
                icon: const Icon(Icons.copy, size: 18),
                tooltip: 'Copy identifier',
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: identifier));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Identifier copied')),
                  );
                },
              ),
            ),
            if (!hasNip5 && auth.isLoggedIn && !auth.isReadOnly)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.tonalIcon(
                    onPressed: () async {
                      try {
                        await ref
                            .read(nip5Provider.notifier)
                            .publishToProfile();
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('Profile updated — you\'re verified!')),
                          );
                        }
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Failed: $e')),
                          );
                        }
                      }
                    },
                    icon: const Icon(Icons.publish, size: 18),
                    label: const Text('Publish to Profile'),
                  ),
                ),
              ),
          ] else ...[
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.verified_outlined, color: scheme.onSurfaceVariant),
              ),
              title: const Text('No verified name',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text(
                  'Buy a NIP-05 verified name to show the ✓ badge'),
            ),
            if (auth.isLoggedIn && !auth.isReadOnly)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => _showNip5ClaimDialog(context, ref),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Get Verified Name'),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  void _showNip5ClaimDialog(BuildContext context, WidgetRef ref) {
    final controller = TextEditingController();
    bool isSearching = false;
    bool isClaiming = false;
    Nip5SearchResult? searchResult;
    String? errorMsg;

    // Domain selection: the first configured domain is the default.
    final domains = nip5Domains;
    Nip5Domain? selectedDomain = domains.isEmpty ? null : domains.first;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) {
          Future<void> search(String query) async {
            if (query.length < 2 || selectedDomain == null) {
              setState(() => searchResult = null);
              return;
            }
            setState(() => isSearching = true);
            try {
              final result = await ref
                  .read(nip5Provider.notifier)
                  .search(
                    localPart: query,
                    domainId: selectedDomain!.id,
                  );
              setState(() {
                searchResult = result;
                isSearching = false;
              });
            } catch (e) {
              setState(() {
                isSearching = false;
                searchResult = null;
              });
            }
          }

          return AlertDialog(
            title: const Text('Get Verified Name'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: controller,
                    decoration: InputDecoration(
                      labelText: 'Choose a name',
                      hintText: 'alice',
                      prefixIcon: const Icon(Icons.verified_outlined),
                      suffixText: selectedDomain != null
                          ? '@${selectedDomain!.domain}'
                          : null,
                    ),
                    onChanged: (v) => search(v.trim().toLowerCase()),
                  ),
                  // Domain picker — only shown when there's a choice to make.
                  if (domains.length > 1) ...[
                    const SizedBox(height: 16),
                    Text(
                      'Domain',
                      style: Theme.of(ctx).textTheme.labelLarge,
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final d in domains)
                          ChoiceChip(
                            label: Text(d.domain),
                            selected: selectedDomain?.id == d.id,
                            onSelected: (_) {
                              setState(() {
                                selectedDomain = d;
                                searchResult = null;
                              });
                              final q = controller.text.trim().toLowerCase();
                              if (q.length >= 2) search(q);
                            },
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 12),
                  if (isSearching)
                    const Padding(
                      padding: EdgeInsets.all(8),
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  else if (searchResult != null)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: searchResult!.available
                            ? Colors.green.withValues(alpha: 0.1)
                            : Colors.red.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            searchResult!.available
                                ? Icons.check_circle
                                : Icons.cancel,
                            color: searchResult!.available
                                ? Colors.green
                                : Colors.red,
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              children: [
                                Text(
                                  searchResult!.available
                                      ? 'Available! ${searchResult!.describePrice()}'
                                      : searchResult!.reason ??
                                          'Not available',
                                  style: TextStyle(
                                    color: searchResult!.available
                                        ? Colors.green.shade700
                                        : Colors.red.shade700,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                if (searchResult!.available &&
                                    searchResult!.priceReason != null &&
                                    searchResult!.priceReason!.isNotEmpty)
                                  Padding(
                                    padding:
                                        const EdgeInsets.only(top: 4),
                                    child: Text(
                                      searchResult!.priceReason!,
                                      style: TextStyle(
                                        color: Colors.green.shade700,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (errorMsg != null) ...[
                    const SizedBox(height: 12),
                    Text(errorMsg!,
                        style: TextStyle(
                            color: Theme.of(ctx).colorScheme.error,
                            fontSize: 12)),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: isClaiming ? null : () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: isClaiming ||
                        searchResult == null ||
                        !searchResult!.available ||
                        selectedDomain == null
                    ? null
                    : () async {
                        final name = controller.text.trim().toLowerCase();
                        if (name.isEmpty) return;
                        setState(() {
                          isClaiming = true;
                          errorMsg = null;
                        });
                        try {
                          final result = await ref
                              .read(nip5Provider.notifier)
                              .claim(
                                localPart: name,
                                years: 1,
                                domainId: selectedDomain!.id,
                              );
                          if (ctx.mounted) Navigator.pop(ctx);
                          if (context.mounted) {
                            final fullName =
                                '$name@${selectedDomain!.domain}';
                            if (result.bolt11.isNotEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content: Text(
                                        'Invoice created — pay to activate $fullName')),
                              );
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content: Text(
                                        '$fullName is reserved for you!')),
                              );
                            }
                          }
                        } catch (e) {
                          setState(() {
                            isClaiming = false;
                            errorMsg = e.toString();
                          });
                        }
                      },
                child: isClaiming
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(searchResult != null
                        ? 'Reserve — ${searchResult!.describePrice()}'
                        : 'Reserve'),
              ),
            ],
          );
        },
      ),
    );
  }
}

// ── Free Address Card ────────────────────────────────────────────────

class _FreeAddressCard extends ConsumerWidget {
  const _FreeAddressCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final freeName = ref.watch(freeAddressProvider);
    final lightning = ref.watch(lightningAddressProvider);
    final auth = ref.watch(authStateProvider);

    if (freeName == null) {
      return Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.card_giftcard, color: scheme.onSurfaceVariant),
          ),
          title: const Text('No free address',
              style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text('Log in to get your free address'),
        ),
      );
    }

    final fullAddress = '$freeName@${Env.lightningAddressDomain}';
    final isClaimed = lightning.addresses.contains(fullAddress);
    final isOnProfile = auth.profile?.lud16 == fullAddress;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          ListTile(
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.green.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.card_giftcard, color: Colors.green),
            ),
            title: Text(
              fullAddress,
              style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontFamily: 'monospace',
                  fontSize: 13),
            ),
            subtitle: Text(
              isOnProfile
                  ? 'On your profile — anyone can zap you here'
                  : isClaimed
                      ? 'Claimed but not on your profile'
                      : 'Free forever — derived from your pubkey',
            ),
            trailing: IconButton(
              icon: const Icon(Icons.copy, size: 18),
              tooltip: 'Copy address',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: fullAddress));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Address copied')),
                );
              },
            ),
          ),
          if (!isOnProfile && auth.isLoggedIn && !auth.isReadOnly)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.tonalIcon(
                  onPressed: () async {
                    try {
                      if (!isClaimed) {
                        await ref
                            .read(lightningAddressProvider.notifier)
                            .claim(username: freeName);
                      }
                      await ref
                          .read(lightningAddressProvider.notifier)
                          .publishToProfile(address: fullAddress);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Free address published!')),
                        );
                      }
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Failed: $e')),
                        );
                      }
                    }
                  },
                  icon: const Icon(Icons.publish, size: 18),
                  label: Text(isClaimed
                      ? 'Publish to Profile'
                      : 'Claim & Publish'),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ── Section Header ───────────────────────────────────────────────────

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
