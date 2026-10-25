import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/memberships/application/membership_providers.dart';
import 'package:nostrfeed_mobile/features/studio/domain/subscription.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Create or edit a subscription tier (kind 37001). The slug is the tier's
/// identity: editing keeps it, so the new event replaces the old one at the
/// same address.
class TierEditorSheet extends ConsumerStatefulWidget {
  /// Set when editing — slug is then fixed and the fields start filled.
  final Tier? existing;

  const TierEditorSheet({super.key, this.existing});

  static Future<void> show(BuildContext context, {Tier? existing}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => TierEditorSheet(existing: existing),
    );
  }

  @override
  ConsumerState<TierEditorSheet> createState() => _TierEditorSheetState();
}

class _TierEditorSheetState extends ConsumerState<TierEditorSheet> {
  late final TextEditingController _title;
  late final TextEditingController _slug;
  late final TextEditingController _amount;
  late final TextEditingController _description;
  late final TextEditingController _image;
  late final TextEditingController _perks;
  late Cadence _cadence;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    _title = TextEditingController(text: existing?.title ?? '');
    _slug = TextEditingController(text: existing?.slug ?? '');
    _amount = TextEditingController(
      text: existing != null ? '${existing.amount}' : '',
    );
    _description = TextEditingController(text: existing?.description ?? '');
    _image = TextEditingController(text: existing?.image ?? '');
    _perks = TextEditingController(text: (existing?.perks ?? []).join(', '));
    _cadence = existing?.cadence ?? Cadence.monthly;
  }

  @override
  void dispose() {
    _title.dispose();
    _slug.dispose();
    _amount.dispose();
    _description.dispose();
    _image.dispose();
    _perks.dispose();
    super.dispose();
  }

  String _slugify(String input) {
    final slug = input
        .toLowerCase()
        .trim()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    return slug;
  }

  Future<void> _save() async {
    final title = _title.text.trim();
    final slug = widget.existing?.slug ?? _slugify(_slug.text.trim());
    final amount = int.tryParse(_amount.text.trim());

    if (title.isEmpty) {
      AppToast.warning(context, 'Give the tier a name');
      return;
    }
    if (slug.isEmpty) {
      AppToast.warning(context, 'The tier needs a slug (e.g. supporter)');
      return;
    }
    if (amount == null || amount <= 0) {
      AppToast.warning(context, 'Set a price in whole sats');
      return;
    }

    setState(() => _busy = true);
    try {
      final perks = _perks.text
          .split(RegExp(r'[,\n]'))
          .map((p) => p.trim())
          .where((p) => p.isNotEmpty)
          .toList();

      final ok = await ref.read(publishTierProvider)(
            slug: slug,
            title: title,
            amount: amount,
            cadence: _cadence,
            description: _description.text.trim(),
            image: _image.text.trim().isEmpty ? null : _image.text.trim(),
            perks: perks,
          );

      if (!mounted) return;
      if (ok) {
        Navigator.of(context).pop();
        AppToast.success(
          context,
          widget.existing == null ? 'Tier published' : 'Tier updated',
        );
      } else {
        AppToast.error(context, 'No relay accepted the tier — try again');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final editing = widget.existing != null;

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.md,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              editing ? 'Edit tier' : 'New tier',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            AppSpacing.gapMd,
            TextField(
              controller: _title,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Name',
                hintText: 'Supporter',
              ),
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _slug,
              enabled: !editing,
              decoration: InputDecoration(
                labelText: 'Slug',
                hintText: 'supporter',
                helperText: editing
                    ? 'The tier’s identity — kept so this replaces the old one.'
                    : 'Lowercase, becomes the tier’s address. Cannot change later.',
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[a-z0-9-]')),
              ],
              onChanged: (value) {
                final slug = _slugify(value);
                if (slug != value) {
                  _slug.value = TextEditingValue(
                    text: slug,
                    selection: TextSelection.collapsed(offset: slug.length),
                  );
                }
              },
            ),
            AppSpacing.gapSm,
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _amount,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText: 'Price (sats)',
                      prefixIcon: AppIcon('zap', size: AppIconSize.md, color: scheme.primary),
                    ),
                  ),
                ),
                AppSpacing.gapSm,
                Expanded(
                  flex: 2,
                  child: DropdownButtonFormField<Cadence>(
                    initialValue: _cadence,
                    decoration: const InputDecoration(labelText: 'Per'),
                    items: Cadence.values
                        .map(
                          (c) => DropdownMenuItem(
                            value: c,
                            child: Text(describeCadence(c)),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) setState(() => _cadence = value);
                    },
                  ),
                ),
              ],
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _description,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Description',
                hintText: 'What a subscriber gets',
              ),
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _perks,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Perks',
                hintText: 'Comma separated: badge, early access, …',
              ),
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _image,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Image URL (optional)',
              ),
            ),
            AppSpacing.gapMd,
            FilledButton.icon(
              onPressed: _busy ? null : _save,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const AppIcon('share'),
              label: Text(editing ? 'Save changes' : 'Publish tier'),
            ),
            AppSpacing.gapSm,
            Text(
              'A subscription is a zap to this tier — the receipt is the proof. '
              'Nothing renews on its own; supporters pay again each ${describeCadence(_cadence)}.',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
