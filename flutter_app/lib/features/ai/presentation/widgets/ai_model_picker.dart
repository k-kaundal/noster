import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';

/// Opens the model picker sheet. Selects the model on tap.
Future<void> showAiModelPicker(BuildContext context) {
  return AppSheet.show(context, child: const _AiModelPickerSheet());
}

/// Display metadata for the modality filter chips (labels are user-facing;
/// provider economics never are).
const _modalityMeta = <AiModality?, (String, IconData)>{
  null: ('All', Icons.auto_awesome_rounded),
  AiModality.text: ('Chat', Icons.chat_bubble_outline_rounded),
  AiModality.vision: ('Vision', Icons.visibility_outlined),
  AiModality.imageGen: ('Image gen', Icons.image_outlined),
  AiModality.audio: ('Audio', Icons.graphic_eq_rounded),
  AiModality.video: ('Video', Icons.videocam_outlined),
};

class _AiModelPickerSheet extends ConsumerStatefulWidget {
  const _AiModelPickerSheet();

  @override
  ConsumerState<_AiModelPickerSheet> createState() =>
      _AiModelPickerSheetState();
}

class _AiModelPickerSheetState extends ConsumerState<_AiModelPickerSheet> {
  AiModality? _filter;
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final config = ref.watch(aiGatewayConfigProvider).value;
    final selected = ref.watch(aiSelectedModelProvider);

    if (config == null) {
      return const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(40),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    final query = _query.trim().toLowerCase();
    final models = config.visibleModels.where((m) {
      if (_filter != null && !m.modalities.contains(_filter)) return false;
      if (query.isNotEmpty &&
          !m.label.toLowerCase().contains(query) &&
          !m.id.toLowerCase().contains(query)) {
        return false;
      }
      return true;
    }).toList();

    // Which filters actually have models (hide empty categories).
    final usedFilters = <AiModality>{
      for (final m in config.visibleModels) ...m.modalities,
    };

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.75,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // ── Header ──────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Choose a model',
                      style: theme.textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),

            // ── Search ──────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
              child: TextField(
                autofocus: false,
                onChanged: (v) => setState(() => _query = v),
                decoration: InputDecoration(
                  hintText: 'Search models…',
                  prefixIcon: const Icon(Icons.search_rounded, size: 20),
                  filled: true,
                  fillColor: scheme.surfaceContainerHighest,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(vertical: 10),
                  isDense: true,
                ),
              ),
            ),

            // ── Type filters ────────────────────────────────────────
            SizedBox(
              height: 46,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                children: [
                  for (final entry in _modalityMeta.entries)
                    if (entry.key == null ||
                        usedFilters.contains(entry.key)) ...[
                      _FilterChip(
                        label: entry.value.$1,
                        icon: entry.value.$2,
                        selected: _filter == entry.key,
                        onTap: () => setState(() => _filter = entry.key),
                      ),
                      const SizedBox(width: 8),
                    ],
                ],
              ),
            ),

            // ── Model list ──────────────────────────────────────────
            Flexible(
              child: models.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(
                        'No models match',
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
                      itemCount: models.length,
                      itemBuilder: (context, index) {
                        final model = models[index];
                        return _ModelTile(
                          model: model,
                          selected: model.id == selected?.id,
                          onTap: () {
                            ref
                                .read(aiSelectedModelIdProvider.notifier)
                                .select(model.id);
                            Navigator.of(context).pop();
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _FilterChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? scheme.primary : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 14,
              color: selected ? scheme.onPrimary : scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: selected ? scheme.onPrimary : scheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModelTile extends ConsumerWidget {
  final AiModelEntry model;
  final bool selected;
  final VoidCallback onTap;

  const _ModelTile({
    required this.model,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final price = ref.watch(aiModelPriceProvider(model));

    return ListTile(
      onTap: onTap,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      selected: selected,
      selectedTileColor: scheme.primaryContainer.withValues(alpha: 0.4),
      leading: CircleAvatar(
        radius: 18,
        backgroundColor:
            selected ? scheme.primary : scheme.surfaceContainerHighest,
        child: Icon(
          _leadingIcon(model),
          size: 18,
          color: selected ? scheme.onPrimary : scheme.primary,
        ),
      ),
      title: Text(
        model.label,
        style: theme.textTheme.titleSmall?.copyWith(
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: Text(
        model.modalities.map((m) => _modalityMeta[m]?.$1 ?? m.name).join(' · '),
        style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.bolt_rounded, size: 12, color: scheme.primary),
                Text(
                  '~$price/msg',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
          if (selected) ...[
            const SizedBox(width: 6),
            Icon(Icons.check_circle_rounded, size: 18, color: scheme.primary),
          ],
        ],
      ),
    );
  }

  IconData _leadingIcon(AiModelEntry model) {
    if (model.modalities.contains(AiModality.imageGen)) {
      return Icons.image_outlined;
    }
    if (model.modalities.contains(AiModality.audio) &&
        !model.modalities.contains(AiModality.text)) {
      return Icons.graphic_eq_rounded;
    }
    if (model.modalities.contains(AiModality.vision)) {
      return Icons.visibility_outlined;
    }
    return Icons.chat_bubble_outline_rounded;
  }
}
