import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/features/identity/application/address_providers.dart';
import 'package:nostrfeed_mobile/features/identity/data/address_service.dart';

/// One owned NIP-05 name in a list — its own domain (from the address's
/// `domainId`), copy action, and the action that fits its state:
///  - ACTIVE   → "Use this one for my ✓" (only ONE name can be the profile's
///    nip05, so each active name gets the publish choice), or "on your
///    profile" when it already is. Expiring/expired names get a badge, and an
///    overflow menu (transfer to another user / release).
///  - UNPAID (reserved, never live) → an "Unpaid" badge, a "Pay for it"
///    button that recovers the outstanding invoice (NOT the publish choice),
///    and a RELEASE action — the server HAS a delete route, so an unpaid
///    reservation can be freed back to the pool immediately (anti-squatting).
/// Shared by the identity screen and the wallet's Buy Name section — mirrors
/// the web's `OwnedName` + `UnpaidName`, plus the delete/transfer routes the
/// web app never used.
class OwnedNip5Tile extends ConsumerWidget {
  final Nip5Address address;
  const OwnedNip5Tile({super.key, required this.address});

  Future<void> _releaseUnpaid(BuildContext context, WidgetRef ref) async {
    final identifier = address.identifier;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Release this name?'),
        content: Text(
          '$identifier is reserved but unpaid. Releasing it frees the name for other people right away. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Release'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(nip5Provider.notifier).releaseUnpaidAddress(address);
      if (context.mounted) {
        AppToast.success(context, '$identifier released back to the pool');
      }
    } catch (e) {
      if (context.mounted) AppToast.error(context, '$e');
    }
  }

  Future<void> _transferActive(BuildContext context, WidgetRef ref) async {
    final identifier = address.identifier;
    try {
      final code = await ref.read(nip5Provider.notifier).getTransferCode(address);
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Transfer this name'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Give this code to the new owner — it lets them claim $identifier onto their account. Anyone holding it can take the name, so share it privately.',
                style: Theme.of(ctx).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              SelectableText(
                code,
                style: const TextStyle(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w600,
                    fontSize: 13),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: code));
                Navigator.pop(ctx);
                AppToast.success(context, 'Transfer code copied');
              },
              child: const Text('Copy code'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (context.mounted) AppToast.error(context, '$e');
    }
  }

  Future<void> _releaseActive(BuildContext context, WidgetRef ref) async {
    final identifier = address.identifier;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this paid name?'),
        content: Text(
          '$identifier is ACTIVE and paid for. Deleting it throws that away and frees the name for others. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete permanently'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(nip5Provider.notifier).releaseActiveAddress(address);
      if (context.mounted) AppToast.success(context, '$identifier deleted');
    } catch (e) {
      if (context.mounted) AppToast.error(context, '$e');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);
    final identifier = address.identifier;
    final status = nip5Status(address);
    // Compared case-insensitively: a profile written by another client can
    // carry the same name in a different case, and it verifies just the same.
    final onProfile =
        auth.profile?.nip05?.trim().toLowerCase() == identifier.toLowerCase();
    // Publish is a choice between ACTIVE names only — an unpaid reservation
    // offering "use me for your ✓" is the exact bug this guards against.
    final canPublish = auth.isLoggedIn &&
        !auth.isReadOnly &&
        status != Nip5Status.inactive &&
        !onProfile;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
      child: Column(
        children: [
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 12),
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: onProfile
                    ? scheme.primaryContainer
                    : status == Nip5Status.inactive
                        ? Colors.orange.withValues(alpha: 0.12)
                        : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                onProfile
                    ? Icons.verified
                    : status == Nip5Status.inactive
                        ? Icons.schedule_rounded
                        : Icons.verified_outlined,
                color: onProfile
                    ? scheme.onPrimaryContainer
                    : status == Nip5Status.inactive
                        ? Colors.orange.shade700
                        : scheme.onSurfaceVariant,
              ),
            ),
            title: Text(
              identifier,
              style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontFamily: 'monospace',
                  fontSize: 14),
            ),
            subtitle: Text(
              onProfile
                  ? 'This is the name on your profile.'
                  : switch (status) {
                      Nip5Status.inactive =>
                        'Reserved — pay to activate (nobody else can take it)',
                      Nip5Status.expired =>
                        'Expired — reserve it again to keep it',
                      Nip5Status.expiring =>
                        'Runs out in ${address.daysUntilExpiry} day${address.daysUntilExpiry == 1 ? '' : 's'}',
                      Nip5Status.active => 'Not on your profile yet',
                    },
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (status == Nip5Status.inactive)
                  Nip5StateBadge(label: 'Unpaid', color: Colors.orange.shade700)
                else if (status == Nip5Status.expired)
                  Nip5StateBadge(label: 'Expired', color: scheme.error)
                else if (status == Nip5Status.expiring)
                  Nip5StateBadge(
                    label: '${address.daysUntilExpiry}d left',
                    color: Colors.orange.shade700,
                  ),
                IconButton(
                  icon: const Icon(Icons.copy, size: 18),
                  tooltip: 'Copy identifier',
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: identifier));
                    AppToast.success(context, 'Identifier copied');
                  },
                ),
                if (auth.isLoggedIn && !auth.isReadOnly)
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert, size: 18),
                    tooltip: 'More',
                    onSelected: (choice) {
                      if (choice == 'release-unpaid') {
                        _releaseUnpaid(context, ref);
                      } else if (choice == 'transfer') {
                        _transferActive(context, ref);
                      } else if (choice == 'release-active') {
                        _releaseActive(context, ref);
                      }
                    },
                    itemBuilder: (ctx) => [
                      if (status == Nip5Status.inactive)
                        const PopupMenuItem(
                          value: 'release-unpaid',
                          child: ListTile(
                            leading: Icon(Icons.lock_open_rounded),
                            title: Text('Release reservation'),
                            subtitle: Text('Free it for others'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        )
                      else ...[
                        const PopupMenuItem(
                          value: 'transfer',
                          child: ListTile(
                            leading: Icon(Icons.swap_horiz_rounded),
                            title: Text('Transfer to another user'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                        const PopupMenuItem(
                          value: 'release-active',
                          child: ListTile(
                            leading: Icon(Icons.delete_outline_rounded),
                            title: Text('Delete'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      ],
                    ],
                  ),
              ],
            ),
          ),
          if (canPublish)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.tonalIcon(
                  onPressed: () async {
                    try {
                      await ref
                          .read(nip5Provider.notifier)
                          .publishToProfile(address: address);
                      if (context.mounted) {
                        AppToast.success(
                            context, '$identifier is now your ✓ name');
                      }
                    } catch (e) {
                      if (context.mounted) {
                        AppToast.error(context, 'Failed: $e');
                      }
                    }
                  },
                  icon: const Icon(Icons.publish, size: 18),
                  label: const Text('Use this one for my ✓'),
                ),
              ),
            ),
          if (status == Nip5Status.inactive &&
              auth.isLoggedIn &&
              !auth.isReadOnly)
            PayForNameButton(address: address),
        ],
      ),
    );
  }
}

/// A small status chip (unpaid / expiring / expired).
class Nip5StateBadge extends StatelessWidget {
  final String label;
  final Color color;
  const Nip5StateBadge({super.key, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(right: 4),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(
        label,
        style:
            TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}

/// "Pay for it" — recovers an unpaid reservation's invoice and opens the pay
/// sheet. Re-claiming a name already reserved to THIS key returns the same
/// record + outstanding invoice (nothing bought twice); the reservation keeps
/// its own years + promo code so it is not re-priced at full rate.
class PayForNameButton extends ConsumerStatefulWidget {
  final Nip5Address address;
  const PayForNameButton({super.key, required this.address});

  @override
  ConsumerState<PayForNameButton> createState() => PayForNameButtonState();
}

class PayForNameButtonState extends ConsumerState<PayForNameButton> {
  bool _busy = false;

  Future<void> _pay() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final result =
          await ref.read(nip5Provider.notifier).payForAddress(widget.address);
      if (!mounted) return;
      if (result.bolt11.isEmpty) {
        // Came back already live (paid elsewhere since the list loaded).
        AppToast.success(context, '${widget.address.identifier} is live!');
        return;
      }
      final outcome = await showPayInvoiceSheet(
        context,
        title: 'Pay to activate your name',
        bolt11: result.bolt11,
        amountSats: widget.address.priceSats,
        memo: widget.address.identifier,
        checkPaid: () async {
          final hash = result.paymentHash ??
              await ref
                  .read(nip5Provider.notifier)
                  .outstandingHashFor(widget.address);
          if (hash == null) return false;
          try {
            return await ref
                .read(nip5Provider.notifier)
                .checkPayment(paymentHash: hash, domainId: result.domainId);
          } catch (_) {
            return false;
          }
        },
      );
      if (!mounted) return;
      if (outcome == InvoicePayResult.paid) {
        await ref.read(nip5Provider.notifier).forgetInvoice(widget.address.id);
        if (mounted) {
          AppToast.success(context,
              '${widget.address.identifier} activated — use it for your ✓');
        }
      }
    } catch (e) {
      if (mounted) AppToast.error(context, '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sats = widget.address.priceSats;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: _busy ? null : _pay,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.bolt_rounded, size: 18),
          label: Text(sats != null ? 'Pay ${_fmt(sats)} sats' : 'Pay for it'),
        ),
      ),
    );
  }

  String _fmt(int sats) {
    final s = sats.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      final idx = s.length - i;
      buf.write(s[i]);
      if (idx > 1 && idx % 3 == 1) buf.write(',');
    }
    return buf.toString();
  }
}
