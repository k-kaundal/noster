import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';

/// The command palette (Refined ⌘K): ONE launcher for AI, creation and
/// navigation, opened by LONG-PRESSING the center Create button in the nav.
/// AI leads (the differentiator), then Create, then Navigate — everything
/// reachable in one gesture, from any screen.
Future<void> showCommandPalette(BuildContext context) {
  HapticFeedback.mediumImpact();
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppShapes.xl)),
    ),
    builder: (_) => const _CommandPalette(),
  );
}

class _CommandPalette extends ConsumerWidget {
  const _CommandPalette();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final aiAvailable = ref.watch(aiAvailableProvider);

    // Tab destinations switch tabs (context.go); detail routes push on top.
    void go(String route, {bool tab = false}) {
      Navigator.pop(context);
      if (tab) {
        context.go(route);
      } else {
        context.push(route);
      }
    }

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: colorScheme.outlineVariant,
                  borderRadius: AppShapes.radiusXs,
                ),
              ),

              // ── Search / ask field ──
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                child: TextField(
                  autofocus: true,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (q) {
                    if (q.trim().isEmpty) return;
                    go('/search');
                  },
                  decoration: InputDecoration(
                    hintText: 'Search, or jump to…',
                    hintStyle: TextStyle(color: colorScheme.onSurfaceVariant),
                    prefixIcon: Padding(
                      padding: const EdgeInsets.all(12),
                      child: AppIcon(
                        'search',
                        size: AppIconSize.md,
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                    filled: true,
                    fillColor: colorScheme.surfaceContainerHighest,
                    border: OutlineInputBorder(
                      borderRadius: AppShapes.radiusFull,
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 12,
                    ),
                  ),
                ),
              ),

              // ── Nova AI (the differentiator) ──
              if (aiAvailable) ...[
                const _PaletteLabel('Nova AI'),
                _PaletteRow(
                  icon: 'sparkle',
                  label: 'Ask AI',
                  subtitle: 'Chat with context from your relays',
                  highlight: true,
                  onTap: () => go('/ai'),
                ),
              ],

              // ── Create ──
              const _PaletteLabel('Create'),
              _PaletteRow(
                icon: 'edit',
                label: 'Post',
                onTap: () => go('/compose'),
              ),
              _PaletteRow(
                icon: 'article',
                label: 'Article',
                onTap: () => go('/articles'),
              ),
              _PaletteRow(
                icon: 'video',
                label: 'Reel',
                onTap: () => go('/reels'),
              ),
              _PaletteRow(
                icon: 'live',
                label: 'Go Live',
                onTap: () => go('/live'),
              ),
              _PaletteRow(
                icon: 'group',
                label: 'Group',
                onTap: () => go('/groups'),
              ),

              // ── Navigate ──
              const _PaletteLabel('Navigate'),
              _PaletteRow(
                icon: 'home',
                label: 'Home',
                onTap: () => go('/feed', tab: true),
              ),
              _PaletteRow(
                icon: 'compass',
                label: 'Explore',
                onTap: () => go('/explore'),
              ),
              _PaletteRow(
                icon: 'chat',
                label: 'Messages',
                onTap: () => go('/chat', tab: true),
              ),
              _PaletteRow(
                icon: 'wallet',
                label: 'Wallet',
                onTap: () => go('/wallet', tab: true),
              ),
              _PaletteRow(
                icon: 'users',
                label: 'You',
                onTap: () => go('/you'),
              ),
              _PaletteRow(
                icon: 'settings',
                label: 'Settings',
                onTap: () => go('/settings'),
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaletteLabel extends StatelessWidget {
  final String title;
  const _PaletteLabel(this.title);

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 2),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          title.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.w700,
                color: colorScheme.primary,
                letterSpacing: 1.2,
              ),
        ),
      ),
    );
  }
}

class _PaletteRow extends StatelessWidget {
  final String icon;
  final String label;
  final String? subtitle;
  final bool highlight;
  final VoidCallback onTap;

  const _PaletteRow({
    required this.icon,
    required this.label,
    this.subtitle,
    this.highlight = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ListTile(
      dense: true,
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      leading: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: highlight
              ? colorScheme.primary
              : colorScheme.primaryContainer.withValues(alpha: 0.5),
          borderRadius: AppShapes.radiusMd,
        ),
        child: Center(
          child: AppIcon(
            icon,
            size: AppIconSize.md,
            color: highlight ? colorScheme.onPrimary : colorScheme.primary,
          ),
        ),
      ),
      title: Text(label, style: Theme.of(context).textTheme.titleSmall),
      subtitle: subtitle != null
          ? Text(
              subtitle!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    fontSize: 11,
                    color: colorScheme.onSurfaceVariant,
                  ),
            )
          : null,
      trailing: AppIcon(
        'chevron_r',
        size: AppIconSize.xs,
        color: colorScheme.onSurfaceVariant,
      ),
    );
  }
}
