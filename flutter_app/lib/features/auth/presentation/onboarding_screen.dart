import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_button.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/auth/data/key_backup_service.dart';


/// First-run onboarding — shown ONCE after a fresh install's first login.
///
/// Nostr has the hardest onboarding in social (no password reset, no
/// algorithm filling your feed), and the first 90 seconds decide retention.
/// Three short, skippable screens, each answering ONE question:
///
///  1. **Your key** — "your key IS your account; back it up now" (the one
///     thing a new user can genuinely lose forever).
///  2. **Your feed** — pick interest chips; we follow a starter set of the
///     community's most-active authors so the feed is alive on day one
///     (the hub relay syncs their content backend-side, so it's actually
///     THERE — a promise a relay-list client can't make).
///  3. **Notifications** — zaps + replies + DMs, not everything.
///
/// Completion is stamped (`onboarding_completed_v1`) — shown once, never
/// again, and "Skip" is always one tap away (forced onboarding reads as an
/// ad, and the AGENTS.md rule against promo cards applies here too).
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  /// SharedPreferences flag — the "shown once" stamp.
  static const completedKey = 'onboarding_completed_v1';

  /// Whether onboarding still needs to run (checked once at app start).
  static Future<bool> needsOnboarding() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(completedKey) != true;
    } catch (_) {
      return false; // a storage failure never traps a user in onboarding
    }
  }

  static Future<void> markCompleted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(completedKey, true);
    } catch (_) {}
  }

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _pageController = PageController();
  int _page = 0;
  bool _busy = false;

  /// Interest chips → the seed follows. Chips are curiosity hooks; the
  /// actual follows come from the community's trending authors (the same
  /// source as Explore's People-to-follow) — no hardcoded celebrity list
  /// to maintain, and it's who the new user will actually see in the feed.
  final Set<String> _interests = {};

  static const _chips = [
    (id: 'bitcoin', label: 'Bitcoin', icon: 'zap'),
    (id: 'tech', label: 'Tech', icon: 'sparkle'),
    (id: 'art', label: 'Art & Photo', icon: 'bookmark'),
    (id: 'news', label: 'News', icon: 'bell'),
    (id: 'music', label: 'Music', icon: 'heart'),
    (id: 'dev', label: 'Building', icon: 'repost'),
  ];

  Future<void> _finish() async {
    setState(() => _busy = true);
    // Seed the starter follows BEFORE landing on the feed so the Following
    // tab is alive on day one (the whole point of the interest step). The
    // set = trending community authors, same source as the preview.
    try {
      final auth = ref.read(authStateProvider);
      if (auth.isLoggedIn && auth.privateKey != null) {
        final nostr = ref.read(nostrServiceProvider);
        final trending = ref.read(trendingProvider(24)).valueOrNull ?? [];
        final follows = ref.read(followsProvider).valueOrNull ?? [];
        final counts = <String, int>{};
        for (final e in trending) {
          counts[e.pubkey] = (counts[e.pubkey] ?? 0) + 1;
        }
        final candidates = counts.entries.toList()
          ..sort((a, b) => b.value.compareTo(a.value));
        final seeds = candidates
            .map((e) => e.key)
            .where((pk) => pk != auth.pubkey && !follows.contains(pk))
            .take(10)
            .toList();
        if (seeds.isNotEmpty) {
          final newFollows = {...follows, ...seeds}.toList();
          nostr.publish(nostr.updateFollows(newFollows));
          ref.invalidate(followsProvider);
        }
      }
    } catch (_) {
      // Seeding is best-effort — the feed fills from the hub regardless.
    }

    await OnboardingScreen.markCompleted();
    if (!mounted) return;
    context.go('/feed');
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: scheme.surface,
      body: SafeArea(
        child: Column(
          children: [
            // Top bar: progress dots … Skip (always one tap out).
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              child: Row(
                children: [
                  _ProgressDots(count: 3, index: _page),
                  const Spacer(),
                  TextButton(
                    onPressed: _busy ? null : _finish,
                    child: const Text('Skip'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: PageView(
                controller: _pageController,
                // Swipe is allowed forward/back — no forced lockstep.
                onPageChanged: (i) => setState(() => _page = i),
                children: [
                  _KeyStep(busy: _busy, onBusyChanged: (b) => setState(() => _busy = b)),
                  _InterestsStep(
                    interests: _interests,
                    onToggle: (id) => setState(() {
                      if (!_interests.remove(id)) _interests.add(id);
                    }),
                  ),
                  const _NotificationsStep(),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: AppButton.primary(
                expand: true,
                loading: _busy,
                onPressed: _busy
                    ? null
                    : () async {
                        if (_page < 2) {
                          await _pageController.nextPage(
                            duration: AppMotion.normal,
                            curve: AppMotion.curve,
                          );
                        } else {
                          await _finish();
                        }
                      },
                label: _page == 2 ? 'Start using NostrFeed' : 'Continue',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Step 1: Your key ────────────────────────────────────────────────

class _KeyStep extends ConsumerStatefulWidget {
  final bool busy;
  final ValueChanged<bool> onBusyChanged;
  const _KeyStep({required this.busy, required this.onBusyChanged});

  @override
  ConsumerState<_KeyStep> createState() => _KeyStepState();
}

class _KeyStepState extends ConsumerState<_KeyStep> {
  bool _saved = false;

  Future<void> _backup() async {
    final auth = ref.read(authStateProvider);
    final privHex = auth.privateKey;
    final pubHex = auth.pubkey;
    if (privHex == null || pubHex == null) return;
    widget.onBusyChanged(true);
    try {
      final authService = ref.read(nostrServiceProvider).authService;
      final nsec = authService.encodeNsec(privHex);
      final npub = authService.encodeNpub(pubHex);
      final saved = await KeyBackupService.saveKeyFile(
        nsec: nsec,
        hexPrivateKey: privHex,
        npub: npub,
        pubkey: pubHex,
      );
      if (saved && mounted) setState(() => _saved = true);
    } finally {
      widget.onBusyChanged(false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return _StepScaffold(
      icon: 'bookmark',
      title: 'Your key IS your account',
      body:
          'No password. No email. No "forgot my login".\n\n'
          'Your secret key is the only proof you own this account — '
          'if you lose it, the account is gone. Back it up now; '
          'it takes 10 seconds.',
      children: [
        AppButton.secondary(
          expand: true,
          loading: widget.busy,
          icon: Icons.download_outlined,
          onPressed: widget.busy ? null : _backup,
          label: _saved ? 'Key file saved ✓' : 'Download key backup',
        ),
        if (_saved)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Text(
              'Store it somewhere private — a password manager or a safe drive. Never post it anywhere.',
              style: textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
          ),
      ],
    );
  }
}

// ─── Step 2: Your feed (interest chips → seed follows) ───────────────

class _InterestsStep extends ConsumerWidget {
  final Set<String> interests;
  final ValueChanged<String> onToggle;
  const _InterestsStep({required this.interests, required this.onToggle});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _StepScaffold(
      icon: 'sparkle',
      title: 'Make your feed yours',
      body:
          'Pick what you\'re into. We\'ll follow a starter set of the '
          'community\'s most active authors so your feed is alive from '
          'the first scroll — you can unfollow anyone, any time.',
      children: [
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          alignment: WrapAlignment.center,
          children: [
            for (final chip in _OnboardingScreenState._chips)
              _InterestChip(
                label: chip.label,
                selected: interests.contains(chip.id),
                onTap: () => onToggle(chip.id),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        const _SuggestedFollowsPreview(),
      ],
    );
  }
}

class _InterestChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _InterestChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? scheme.primaryContainer : scheme.surfaceContainerLowest,
      borderRadius: AppShapes.radiusFull,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppShapes.radiusFull,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: AppShapes.radiusFull,
            border: Border.all(
              color: selected ? scheme.primary : scheme.outlineVariant,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: selected ? scheme.onPrimaryContainer : scheme.onSurface,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
          ),
        ),
      ),
    );
  }
}

/// A quiet preview of the starter follows (trending community authors,
/// same source as Explore's People-to-follow) so the user sees WHO they'll
/// get — faces, not a promise.
class _SuggestedFollowsPreview extends ConsumerWidget {
  const _SuggestedFollowsPreview();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trending = ref.watch(trendingProvider(24)).valueOrNull ?? [];
    final auth = ref.watch(authStateProvider);
    final follows = ref.watch(followsProvider).valueOrNull ?? [];

    // Most-posting trending authors, excluding self/follows — the exact
    // set the "Continue" action follows.
    final counts = <String, int>{};
    for (final e in trending) {
      counts[e.pubkey] = (counts[e.pubkey] ?? 0) + 1;
    }
    final candidates = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final pubkeys = candidates
        .map((e) => e.key)
        .where((pk) => pk != auth.pubkey && !follows.contains(pk))
        .take(5)
        .toList();

    if (pubkeys.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        SizedBox(
          height: 52,
          child: Stack(
            alignment: Alignment.center,
            children: [
              for (var i = 0; i < pubkeys.length; i++)
                Positioned(
                  left: (MediaQuery.sizeOf(context).width / 2) - 26 + (i * 34.0) - ((pubkeys.length - 1) * 17.0),
                  child: _FollowAvatar(pubkey: pubkeys[i]),
                ),
            ],
          ),
        ),
        Text(
          '${pubkeys.length} active community members',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
      ],
    );
  }
}

class _FollowAvatar extends ConsumerWidget {
  final String pubkey;
  const _FollowAvatar({required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider(pubkey)).valueOrNull;
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: scheme.surface, width: 2),
      ),
      child: SafeAvatar(
        imageUrl: profile?.picture,
        radius: 22,
        fallback: Text(
          (profile?.displayNameOrName ?? '?').characters.first,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
    );
  }
}

// ─── Step 3: Notifications ───────────────────────────────────────────

class _NotificationsStep extends ConsumerStatefulWidget {
  const _NotificationsStep();

  @override
  ConsumerState<_NotificationsStep> createState() => _NotificationsStepState();
}

class _NotificationsStepState extends ConsumerState<_NotificationsStep> {
  bool _enabled = false;

  Future<void> _enable() async {
    await LocalNotificationService.instance.init();
    if (mounted) setState(() => _enabled = true);
  }

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      icon: 'bell',
      title: 'Know when it matters',
      body:
          'Zaps, replies and messages — not a firehose.\n\n'
          'We only notify for the things you\'d actually open the app for, '
          'and bursts collapse into one ("Alice and 5 others…").',
      children: [
        AppButton.secondary(
          expand: true,
          icon: Icons.notifications_outlined,
          onPressed: _enabled ? null : _enable,
          label: _enabled ? 'Notifications on ✓' : 'Turn on notifications',
        ),
      ],
    );
  }
}

// ─── Shared scaffolding ──────────────────────────────────────────────

class _StepScaffold extends StatelessWidget {
  final String icon;
  final String title;
  final String body;
  final List<Widget> children;
  const _StepScaffold({
    required this.icon,
    required this.title,
    required this.body,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Column(
        children: [
          const SizedBox(height: AppSpacing.xl),
          // Flat accent circle icon (Refined: no gradient).
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: AppIcon(icon, size: 32, color: scheme.onPrimaryContainer),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            title,
            style: textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            body,
            style: textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.5,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.xl),
          ...children,
        ],
      ),
    );
  }
}

class _ProgressDots extends StatelessWidget {
  final int count;
  final int index;
  const _ProgressDots({required this.count, required this.index});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        for (var i = 0; i < count; i++)
          AnimatedContainer(
            duration: AppMotion.fast,
            curve: AppMotion.curve,
            margin: const EdgeInsets.only(right: 6),
            width: i == index ? 20 : 6,
            height: 6,
            decoration: BoxDecoration(
              color: i == index ? scheme.primary : scheme.outlineVariant,
              borderRadius: AppShapes.radiusFull,
            ),
          ),
      ],
    );
  }
}
