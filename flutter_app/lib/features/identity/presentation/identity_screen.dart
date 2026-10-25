import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/auth/data/key_backup_service.dart';
import 'package:nostrfeed_mobile/features/identity/application/address_providers.dart';
import 'package:nostrfeed_mobile/features/identity/data/address_service.dart';
import 'package:nostrfeed_mobile/features/identity/presentation/widgets/owned_nip5_tile.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

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
          const _SectionHeader(title: 'Signer'),
          const SizedBox(height: 8),
          _SignerStatusCard(auth: auth),
          const SizedBox(height: 20),

          // Lightning Address
          const _SectionHeader(title: 'Lightning Address'),
          const SizedBox(height: 8),
          const _LightningAddressCard(),
          const SizedBox(height: 20),

          // NIP-05 Verified Name
          const _SectionHeader(title: 'Verified Name (NIP-05)'),
          const SizedBox(height: 8),
          const _Nip5Card(),
          const SizedBox(height: 20),

          // Free Address
          const _SectionHeader(title: 'Free Address'),
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
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            SafeAvatar(
              imageUrl: auth.profile?.picture,
              radius: 30,
              backgroundColor: scheme.primaryContainer,
              fallback: AppIcon('users', size: 30, color: scheme.onPrimaryContainer),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    auth.profile?.displayNameOrName ?? 'Not logged in',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    auth.pubkey != null
                        ? '${auth.pubkey!.substring(0, 16)}…'
                        : 'Sign in to manage your identity',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
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
                        borderRadius: AppShapes.radiusXs,
                      ),
                      child: Text(
                        'Read-only',
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(color: scheme.onTertiaryContainer),
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
      child: Column(
        children: [
          ListTile(
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: hasKeys
                    ? scheme.tertiaryContainer
                    : scheme.surfaceContainerHighest,
                borderRadius: AppShapes.radiusMd,
              ),
              child: AppIcon(
                hasKeys ? 'key' : 'eye_off',
                size: AppIconSize.md,
                color: hasKeys
                    ? scheme.onTertiaryContainer
                    : scheme.onSurfaceVariant,
              ),
            ),
            title: Text(
              hasKeys ? 'Private key signer active' : 'No signer connected',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600),
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
                      AppIcon('verified',
                          size: AppIconSize.sm, color: scheme.error),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Back up your key — there is no password reset.',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
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
                          icon:
                              const AppIcon('download', size: AppIconSize.md),
                          label: const Text('Download key file'),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            shape: RoundedRectangleBorder(
                              borderRadius: AppShapes.radiusMd,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _copyKey(context, ref),
                          icon: const AppIcon('edit', size: AppIconSize.md),
                          label: const Text('Copy nsec'),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            shape: RoundedRectangleBorder(
                              borderRadius: AppShapes.radiusMd,
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
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: AppShapes.radiusMd,
            ),
            child: AppIcon('zap',
                size: AppIconSize.md, color: scheme.onSurfaceVariant),
          ),
          title: Text('No wallet connected',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          subtitle: const Text(
              'Connect your wallet to get a lightning address'),
          trailing: const AppIcon('chevron_r'),
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
      child: Column(
        children: [
          if (address != null) ...[
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppActionColors.zap.withValues(alpha: 0.15),
                  borderRadius: AppShapes.radiusMd,
                ),
                child: const AppIcon('zap',
                    size: AppIconSize.md, color: AppActionColors.zap),
              ),
              title: Text(
                address,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600, fontFamily: 'monospace'),
              ),
              subtitle: Text(
                hasAddress
                    ? 'Published on your profile — anyone can zap you'
                    : 'Not on your profile yet — publish it to receive zaps',
              ),
              trailing: IconButton(
                icon: const AppIcon('edit', size: AppIconSize.md),
                tooltip: 'Copy address',
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: address));
                  AppToast.success(context, 'Address copied');
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
                          AppToast.success(context, 'Profile updated — zaps enabled!');
                        }
                      } catch (e) {
                        if (context.mounted) {
                          AppToast.error(context, 'Failed: $e');
                        }
                      }
                    },
                    icon: const AppIcon('share', size: 18),
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
                  borderRadius: AppShapes.radiusMd,
                ),
                child: AppIcon('zap',
                    size: AppIconSize.md, color: scheme.onSurfaceVariant),
              ),
              title: Text('No lightning address',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
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
                    icon: const AppIcon('plus', size: 18),
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
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
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
                          AppIcon(
                            addr == address ? 'check' : 'eye',
                            size: AppIconSize.xs,
                            color: addr == address
                                ? AppStatusColors.success
                                : scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              addr,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(
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
                  const AppIcon('eye_off',
                      size: AppIconSize.sm, color: AppStatusColors.warning),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${lightning.silentAddresses.length} address(es) receive money but don\'t publish zap receipts on Nostr.',
                      style: Theme.of(context)
                          .textTheme
                          .labelSmall
                          ?.copyWith(color: AppStatusColors.warning),
                    ),
                  ),
                  TextButton(
                    onPressed: () =>
                        ref.read(lightningAddressProvider.notifier).enableZaps(),
                    child: Text('Fix',
                        style: Theme.of(context).textTheme.labelSmall),
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

    // Domain selection: every configured lightning domain is on offer, first
    // is the default. A custom name on ANY domain is paid — this dialog only
    // claims the free generated name; custom names route to the buy flow.
    final domains = lightningAddressDomains;
    String selectedDomain = domains.first;
    final auth = ref.read(authStateProvider);
    final freeName =
        auth.pubkey != null ? FreeAddress.generate(auth.pubkey!) : null;
    if (freeName != null && controller.text.isEmpty) {
      controller.text = freeName;
    }

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) {
          final typed = controller.text.trim().toLowerCase();
          final isFreeName = freeName != null && typed == freeName;
          return AlertDialog(
            title: const Text('Claim Lightning Address'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: controller,
                  decoration: InputDecoration(
                    labelText: 'Username',
                    hintText: freeName ?? 'u…',
                    prefixIcon: AppIcon('at', size: AppIconSize.md),
                    suffixText: '@$selectedDomain',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                // Domain picker — only shown when there's a choice to make.
                if (domains.length > 1) ...[
                  const SizedBox(height: 16),
                  Text('Domain', style: Theme.of(ctx).textTheme.labelLarge),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final d in domains)
                        ChoiceChip(
                          label: Text(d),
                          selected: selectedDomain == d,
                          onSelected: (_) => setState(() => selectedDomain = d),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 10),
                Text(
                  isFreeName
                      ? 'Your free address — derived from your pubkey, free forever.'
                      : 'Custom names are paid. Get them from the Verified Name section above — it comes with an invoice to pay first.',
                  style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                        color: isFreeName
                            ? AppStatusColors.success
                            : Theme.of(ctx).colorScheme.onSurfaceVariant,
                      ),
                ),
                if (errorMsg != null) ...[
                  const SizedBox(height: 12),
                  Text(errorMsg!,
                      style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                          color: Theme.of(ctx).colorScheme.error)),
                ],
              ],
            ),
            actions: [
              TextButton(
                onPressed: isClaiming ? null : () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: isClaiming || !isFreeName
                    ? null
                    : () async {
                        setState(() {
                          isClaiming = true;
                          errorMsg = null;
                        });
                        try {
                          await ref
                              .read(lightningAddressProvider.notifier)
                              .claim(username: typed, domain: selectedDomain);
                          if (ctx.mounted) Navigator.pop(ctx);
                          if (context.mounted) {
                            AppToast.success(context, '$typed@$selectedDomain is yours!');
                          }
                        } catch (e) {
                          setState(() {
                            isClaiming = false;
                            errorMsg = e.toString();
                          });
                        }
                      },
                child: const Text('Claim free address'),
              ),
            ],
          );
        },
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
    final unpaidByDomain = ref.watch(unpaidReservationsProvider);
    final unpaidCount = ref.watch(unpaidReservationCountProvider);
    final expiring = ref.watch(expiringNamesProvider);

    if (!lnbits.isConnected) {
      return Card(
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: AppShapes.radiusMd,
            ),
            child: AppIcon('verified',
                size: AppIconSize.md, color: scheme.onSurfaceVariant),
          ),
          title: Text('No wallet connected',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
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
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: AppShapes.radiusMd,
            ),
            child: AppIcon('verified',
                size: AppIconSize.md, color: scheme.onSurfaceVariant),
          ),
          title: Text('Not available',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          subtitle: const Text(
              'Verified names are not enabled on this LNbits instance'),
        ),
      );
    }

    final addresses = nip5.addresses;

    return Card(
      child: Column(
        children: [
          // Every name the account holds — names are not interchangeable:
          // each has its own domain + expiry, and only ONE can be the nip05
          // on the profile, so they're listed with their own publish action
          // rather than summarised behind the primary. Mirrors the web's
          // `OwnedNames`.
          if (addresses.isNotEmpty) ...[
            // Anti-squatting note: unpaid reservations are names held out of
            // the pool. Surface the count + cap so it reads as a limit, and
            // the expiring-soon warning so a paid name is renewed, not lost.
            if (unpaidCount > 0)
              _ReservationNotice(
                unpaidByDomain: unpaidByDomain,
                unpaidCount: unpaidCount,
              ),
            if (expiring.isNotEmpty) _ExpiringNotice(names: expiring),
            for (var i = 0; i < addresses.length; i++) ...[
              if (i > 0) const Divider(height: 1, indent: 16, endIndent: 16),
              OwnedNip5Tile(address: addresses[i]),
            ],
            if (auth.isLoggedIn && !auth.isReadOnly)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () => _showNip5ClaimDialog(context, ref),
                    icon: const AppIcon('plus', size: 18),
                    label: const Text('Buy another name'),
                  ),
                ),
              ),
          ] else ...[
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: AppShapes.radiusMd,
                ),
                child: AppIcon('verified',
                    size: AppIconSize.md, color: scheme.onSurfaceVariant),
              ),
              title: Text('No verified name',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
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
                    icon: const AppIcon('plus', size: 18),
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
                      prefixIcon: AppIcon('verified', size: AppIconSize.md),
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
                            ? AppStatusColors.success.withValues(alpha: 0.1)
                            : AppStatusColors.error.withValues(alpha: 0.1),
                        borderRadius: AppShapes.radiusSm,
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          AppIcon(
                            searchResult!.available ? 'check' : 'eye_off',
                            size: AppIconSize.md,
                            color: searchResult!.available
                                ? AppStatusColors.success
                                : AppStatusColors.error,
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
                                  style: Theme.of(ctx)
                                      .textTheme
                                      .bodySmall
                                      ?.copyWith(
                                        color: searchResult!.available
                                            ? AppStatusColors.success
                                            : AppStatusColors.error,
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
                                      style: Theme.of(ctx)
                                          .textTheme
                                          .labelSmall
                                          ?.copyWith(
                                            color: AppStatusColors.success,
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
                        style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                            color: Theme.of(ctx).colorScheme.error)),
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
                          final fullName = '$name@${selectedDomain!.domain}';

                          // Free (promo) claim — no invoice, done.
                          if (result.bolt11.isEmpty) {
                            if (ctx.mounted) Navigator.pop(ctx);
                            if (context.mounted) {
                              AppToast.success(
                                  context, '$fullName is yours!');
                            }
                            return;
                          }

                          // PAID claim: close the search dialog and open the
                          // pay sheet (in-app Pay button + QR fallback). The
                          // name only activates once the invoice settles.
                          if (ctx.mounted) Navigator.pop(ctx);
                          if (!context.mounted) return;
                          final outcome = await showPayInvoiceSheet(
                            context,
                            title: 'Pay to activate your name',
                            bolt11: result.bolt11,
                            amountSats: searchResult?.priceSats,
                            memo: result.address?.identifier ?? fullName,
                            checkPaid: () async {
                              final hash = result.paymentHash;
                              if (hash == null) return false;
                              try {
                                return await ref
                                    .read(nip5Provider.notifier)
                                    .checkPayment(
                                      paymentHash: hash,
                                      domainId: result.domainId,
                                    );
                              } catch (_) {
                                return false;
                              }
                            },
                          );
                          if (!context.mounted) return;
                          if (outcome == InvoicePayResult.paid) {
                            AppToast.success(
                                context, '$fullName activated — publish it to show your ✓');
                          } else {
                            AppToast.info(
                              context,
                              '$fullName is reserved — finish paying from the Wallet → Verified Name section to activate it.',
                            );
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
                        ? 'Buy — ${searchResult!.describePrice()}'
                        : 'Buy'),
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
        child: ListTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: AppShapes.radiusMd,
            ),
            child: AppIcon('gift',
                size: AppIconSize.md, color: scheme.onSurfaceVariant),
          ),
          title: Text('No free address',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          subtitle: const Text('Log in to get your free address'),
        ),
      );
    }

    final fullAddress = '$freeName@${Env.lightningAddressDomain}';
    final isClaimed = lightning.addresses.contains(fullAddress);
    final isOnProfile = auth.profile?.lud16 == fullAddress;

    return Card(
      child: Column(
        children: [
          ListTile(
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppStatusColors.success.withValues(alpha: 0.15),
                borderRadius: AppShapes.radiusMd,
              ),
              child: const AppIcon('gift',
                  size: AppIconSize.md, color: AppStatusColors.success),
            ),
            title: Text(
              fullAddress,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w600, fontFamily: 'monospace'),
            ),
            subtitle: Text(
              isOnProfile
                  ? 'On your profile — anyone can zap you here'
                  : isClaimed
                      ? 'Claimed but not on your profile'
                      : 'Free forever — derived from your pubkey',
            ),
            trailing: IconButton(
              icon: const AppIcon('edit', size: 18),
              tooltip: 'Copy address',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: fullAddress));
                AppToast.success(context, 'Address copied');
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
                        AppToast.success(context, 'Free address published!');
                      }
                    } catch (e) {
                      if (context.mounted) {
                        AppToast.error(context, 'Failed: $e');
                      }
                    }
                  },
                  icon: const AppIcon('share', size: 18),
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

/// Anti-squatting note: unpaid reservations are names held out of the pool
/// for everyone. Shows the running count against the per-domain cap so it
/// reads as a limit, and nudges paying for (or letting lapse) the oldest.
class _ReservationNotice extends StatelessWidget {
  final Map<String, List<Nip5Address>> unpaidByDomain;
  final int unpaidCount;
  const _ReservationNotice({
    required this.unpaidByDomain,
    required this.unpaidCount,
  });

  @override
  Widget build(BuildContext context) {
    final atCap = unpaidByDomain.values
        .any((list) => list.length >= kMaxUnpaidReservationsPerDomain);
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppStatusColors.warning.withValues(alpha: 0.08),
        borderRadius: AppShapes.radiusSm,
        border: Border.all(color: AppStatusColors.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AppIcon('clock',
              size: AppIconSize.md, color: AppStatusColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              atCap
                  ? 'You\'ve reserved the most unpaid names allowed on a domain. Pay for one or let it lapse before reserving another — a reserved name is held out of the pool for everyone.'
                  : '$unpaidCount name${unpaidCount == 1 ? ' is' : 's are'} reserved but unpaid. They\'re held for you, but only up to $kMaxUnpaidReservationsPerDomain per domain — pay for them to keep them.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    height: 1.4,
                    color: AppStatusColors.warning,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A paid name that is about to lapse — it returns to the pool unless renewed.
class _ExpiringNotice extends StatelessWidget {
  final List<Nip5Address> names;
  const _ExpiringNotice({required this.names});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final first = names.first;
    final days = first.daysUntilExpiry ?? 0;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.errorContainer.withValues(alpha: 0.3),
        borderRadius: AppShapes.radiusSm,
        border: Border.all(color: scheme.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppIcon('calendar', size: AppIconSize.md, color: scheme.error),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              names.length == 1
                  ? '${first.identifier} lapses in $days day${days == 1 ? '' : 's'} and returns to the pool. Renew it to keep your ✓.'
                  : '${names.length} names lapse soon and return to the pool. Renew them to keep your ✓.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    height: 1.4,
                    color: scheme.onErrorContainer,
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
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w700,
            color: Theme.of(context).colorScheme.primary,
            letterSpacing: 1.2,
          ),
    );
  }
}
