import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/auth/services/key_backup_service.dart';

/// Auth flow inspired by Damus, Amethyst, X, and Threads:
/// - Hero brand section on top (gradient, logo, tagline)
/// - Bottom sheet with progressive disclosure:
///   Screen 1: Two main CTAs — "Create new account" / "I already have a key"
///   Screen 2a (new): Key generation + backup confirmation
///   Screen 2b (existing): nsec input with paste/visibility toggle
/// - Tertiary "Browse as guest" link at bottom
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  // Auth flow state
  _AuthStep _step = _AuthStep.entry;
  bool _isLoading = false;

  // Login form
  final _nsecController = TextEditingController();
  final _npubController = TextEditingController();
  bool _showKey = false;

  // Signup form
  String? _generatedNsec;
  bool _keyBackedUp = false;
  bool _keySavedToFile = false;
  bool _showBackupKey = false;

  @override
  void dispose() {
    _nsecController.dispose();
    _npubController.dispose();
    super.dispose();
  }

  Future<void> _runAuth(
      Future<void> Function() action, String errorPrefix) async {
    setState(() => _isLoading = true);
    try {
      await action();
      if (mounted) {
        AppToast.success(context, 'Welcome to NostrFeed');
        context.go('/feed');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, '$errorPrefix: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // ── Login ────────────────────────────────────────────────────────────

  Future<void> _loginWithKey() async {
    final input = _nsecController.text.trim();
    if (input.isEmpty) {
      AppToast.warning(context, 'Please enter a private key');
      return;
    }
    final notifier = ref.read(authStateProvider.notifier);
    if (input.startsWith('nsec1')) {
      await _runAuth(() => notifier.loginWithNsec(input), 'Invalid nsec key');
    } else if (RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(input)) {
      await _runAuth(() => notifier.loginWithHexKey(input), 'Invalid hex key');
    } else {
      AppToast.warning(
        context,
        'Key must start with nsec1 or be a 64-char hex string',
      );
    }
  }

  Future<void> _browseReadOnly() async {
    final input = _npubController.text.trim();
    if (input.isEmpty) {
      AppToast.warning(context, 'Please enter an npub');
      return;
    }
    if (!input.startsWith('npub1')) {
      AppToast.warning(context, 'Public key must start with npub1');
      return;
    }
    final notifier = ref.read(authStateProvider.notifier);
    await _runAuth(() => notifier.loginReadOnly(input), 'Invalid npub');
  }

  // ── Signup ───────────────────────────────────────────────────────────

  Future<void> _generateKeys() async {
    setState(() => _isLoading = true);
    try {
      final notifier = ref.read(authStateProvider.notifier);
      await notifier.generateKeys();
      // After generating, show the backup screen with the key
      final auth = ref.read(authStateProvider);
      if (auth.privateKey != null) {
        // Convert hex to nsec for display
        final nsec = ref
            .read(nostrServiceProvider)
            .authService
            .encodeNsec(auth.privateKey!);
        setState(() {
          _generatedNsec = nsec;
          _step = _AuthStep.backup;
        });
      } else {
        if (mounted) context.go('/feed');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Failed to generate keys: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _copyKey() async {
    if (_generatedNsec == null) return;
    await Clipboard.setData(ClipboardData(text: _generatedNsec!));
    if (mounted) {
      AppToast.success(
        context,
        'Key copied — store it somewhere safe, like a password manager',
      );
    }
  }

  /// Download the key as a backup file (Files app / Drive / Save-As).
  Future<void> _downloadKeyFile() async {
    final auth = ref.read(authStateProvider);
    final privHex = auth.privateKey;
    final pubHex = auth.pubkey;
    if (privHex == null || pubHex == null || _generatedNsec == null) {
      AppToast.warning(context, 'Generate your key first');
      return;
    }
    setState(() => _isLoading = true);
    try {
      final authService = ref.read(nostrServiceProvider).authService;
      final npub = authService.encodeNpub(pubHex);
      final saved = await KeyBackupService.saveKeyFile(
        nsec: _generatedNsec!,
        hexPrivateKey: privHex,
        npub: npub,
        pubkey: pubHex,
      );
      if (!mounted) return;
      if (saved) {
        _keySavedToFile = true;
        AppToast.success(context, 'Key file saved — keep it private');
        setState(() {});
      }
      // saved == false → user dismissed the sheet; no toast needed.
    } catch (e) {
      if (mounted) AppToast.error(context, 'Could not save file: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _finishSignup() async {
    if (!_keyBackedUp && !_keySavedToFile) {
      AppToast.warning(
        context,
        'Please back up your key first — it\'s the only way back in',
      );
      return;
    }
    if (mounted) {
      AppToast.success(context, 'Your account is ready. Welcome to NostrFeed');
      context.go('/feed');
    }
  }

  Future<void> _pasteFromClipboard(TextEditingController controller) async {
    final data = await Clipboard.getData('text/plain');
    if (data?.text != null && data!.text!.isNotEmpty) {
      controller.text = data.text!;
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Hero section — gradient with logo and tagline
            _HeroSection(
              onBack: _step != _AuthStep.entry
                  ? () => setState(() {
                        _step = _AuthStep.entry;
                        _generatedNsec = null;
                        _keyBackedUp = false;
                      })
                  : null,
            ),

            // Bottom sheet — form content
            Expanded(
              child: Container(
                width: double.infinity,
                decoration: BoxDecoration(
                  color: scheme.surface,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(24),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: scheme.shadow.withValues(alpha: 0.1),
                      blurRadius: 20,
                      offset: const Offset(0, -4),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(24),
                  ),
                  child: _buildSheetContent(theme, scheme),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSheetContent(ThemeData theme, ColorScheme scheme) {
    return switch (_step) {
      _AuthStep.entry => _buildEntryStep(theme, scheme),
      _AuthStep.login => _buildLoginStep(theme, scheme),
      _AuthStep.signup => _buildSignupStep(theme, scheme),
      _AuthStep.backup => _buildBackupStep(theme, scheme),
    };
  }

  // ── Entry: two main CTAs ────────────────────────────────────────────

  Widget _buildEntryStep(ThemeData theme, ColorScheme scheme) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          Text(
            'Get started',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            'Your social network, your keys.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),

          // Primary CTA — create new account
          FilledButton.icon(
            onPressed: () => setState(() => _step = _AuthStep.signup),
            icon: const Icon(Icons.person_add_outlined),
            label: const Text('Create new account'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Secondary CTA — login with existing key
          OutlinedButton.icon(
            onPressed: () => setState(() => _step = _AuthStep.login),
            icon: const Icon(Icons.key_outlined),
            label: const Text('I already have a key'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Tertiary — browse as guest
          TextButton(
            onPressed: () {
              // Show npub input inline
              _showBrowseDialog();
            },
            child: Text(
              'Just looking? Browse as guest',
              style: TextStyle(
                color: scheme.primary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showBrowseDialog() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Browse as guest',
              style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'Enter any npub to browse Nostr in read-only mode.',
              style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _npubController,
              autofocus: true,
              decoration: InputDecoration(
                labelText: 'Public Key',
                hintText: 'npub1…',
                prefixIcon: const Icon(Icons.person_outline),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () {
                Navigator.pop(ctx);
                _browseReadOnly();
              },
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: const Text('Browse'),
            ),
          ],
        ),
      ),
    );
  }

  // ── Login: nsec input ───────────────────────────────────────────────

  Widget _buildLoginStep(ThemeData theme, ColorScheme scheme) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          Text(
            'Welcome back',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Enter your secret key to log in.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // Security warning
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: scheme.tertiaryContainer.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: scheme.tertiary.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              children: [
                Icon(Icons.shield_outlined,
                    size: 20, color: scheme.tertiary),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Never share your nsec. Anyone who has it controls your account.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurface,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // nsec input with paste + visibility toggle
          TextField(
            controller: _nsecController,
            obscureText: !_showKey,
            enabled: !_isLoading,
            autocorrect: false,
            enableSuggestions: false,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
            decoration: InputDecoration(
              labelText: 'Secret key',
              hintText: 'nsec1…',
              prefixIcon: const Icon(Icons.key_outlined),
              suffixIcon: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.paste_outlined, size: 20),
                    tooltip: 'Paste',
                    onPressed: () => _pasteFromClipboard(_nsecController),
                  ),
                  IconButton(
                    icon: Icon(
                      _showKey ? Icons.visibility_off : Icons.visibility,
                      size: 20,
                    ),
                    tooltip: _showKey ? 'Hide' : 'Show',
                    onPressed: () => setState(() => _showKey = !_showKey),
                  ),
                ],
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 24),

          FilledButton.icon(
            onPressed: _isLoading ? null : _loginWithKey,
            icon: _isLoading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.login),
            label: const Text('Log in'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Signup: generate keys ───────────────────────────────────────────

  Widget _buildSignupStep(ThemeData theme, ColorScheme scheme) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          Text(
            'Create your account',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Generate a fresh key pair. No email, no phone — your key is your identity.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          _InfoRow(
            icon: Icons.key_outlined,
            text: 'A private key is generated on your device. It never leaves this app.',
            scheme: scheme,
          ),
          const SizedBox(height: 12),
          _InfoRow(
            icon: Icons.no_accounts_outlined,
            text: 'No signup forms, no verification codes. Your key is your account.',
            scheme: scheme,
          ),
          const SizedBox(height: 12),
          _InfoRow(
            icon: Icons.backup_outlined,
            text: 'You\'ll back up your key in the next step — it\'s your only way back in.',
            scheme: scheme,
          ),
          const SizedBox(height: 32),

          FilledButton.icon(
            onPressed: _isLoading ? null : _generateKeys,
            icon: _isLoading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.bolt_outlined),
            label: const Text('Generate my secret key'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Backup: show key + confirm ──────────────────────────────────────

  Widget _buildBackupStep(ThemeData theme, ColorScheme scheme) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          Text(
            'Back up your key',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'This is the only way to access your account. There\'s no password reset.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // Key display
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'Secret key',
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: Icon(
                        _showBackupKey ? Icons.visibility_off : Icons.visibility,
                        size: 20,
                      ),
                      onPressed: () =>
                          setState(() => _showBackupKey = !_showBackupKey),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                SelectableText(
                  _showBackupKey
                      ? (_generatedNsec ?? '')
                      : 'nsec1${'•' * 48}',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Backup actions: download file (primary) + copy (secondary)
          FilledButton.tonalIcon(
            onPressed: _isLoading ? null : _downloadKeyFile,
            icon: Icon(
              _keySavedToFile ? Icons.check_circle_outline : Icons.download_outlined,
            ),
            label: Text(
              _keySavedToFile ? 'Key file saved' : 'Download key file',
            ),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _copyKey,
            icon: const Icon(Icons.copy_outlined),
            label: const Text('Copy to clipboard'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Confirmation checkbox
          GestureDetector(
            onTap: () => setState(() => _keyBackedUp = !_keyBackedUp),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: _keyBackedUp
                    ? scheme.primaryContainer.withValues(alpha: 0.3)
                    : scheme.surfaceContainerHighest.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _keyBackedUp
                      ? scheme.primary
                      : scheme.outlineVariant,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    _keyBackedUp
                        ? Icons.check_circle
                        : Icons.circle_outlined,
                    color: _keyBackedUp
                        ? scheme.primary
                        : scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'I have saved my secret key somewhere safe',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          FilledButton(
            onPressed:
                (_keyBackedUp || _keySavedToFile) && !_isLoading ? _finishSignup : null,
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
            child: const Text('I\'ve saved my key — Continue'),
          ),
        ],
      ),
    );
  }
}

enum _AuthStep { entry, login, signup, backup }

// ── Hero section ─────────────────────────────────────────────────────

class _HeroSection extends StatelessWidget {
  final VoidCallback? onBack;

  const _HeroSection({this.onBack});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [scheme.primary, scheme.tertiary],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (onBack != null)
            IconButton(
              icon: const Icon(Icons.arrow_back, color: Colors.white),
              onPressed: onBack,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            ),

          const SizedBox(height: 24),

          // Logo
          Center(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.bolt,
                size: 40,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(
              'NostrFeed',
              style: theme.textTheme.headlineMedium?.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          const SizedBox(height: 4),
          Center(
            child: Text(
              'Your social network, your keys.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Colors.white.withValues(alpha: 0.85),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Info row for signup ──────────────────────────────────────────────

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String text;
  final ColorScheme scheme;

  const _InfoRow({
    required this.icon,
    required this.text,
    required this.scheme,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: scheme.primaryContainer.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 18, color: scheme.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 13,
              color: scheme.onSurfaceVariant,
              height: 1.4,
            ),
          ),
        ),
      ],
    );
  }
}
