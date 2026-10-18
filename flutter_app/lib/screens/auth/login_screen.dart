import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';

/// Login and signup screen with a modern two-tab flow:
/// - **Sign Up**: generate fresh keys with backup guidance
/// - **Log In**: nsec/hex key or read-only npub browse
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _nsecController = TextEditingController();
  final _npubController = TextEditingController();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _nsecController.dispose();
    _npubController.dispose();
    super.dispose();
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Theme.of(context).colorScheme.error,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _runAuth(
      Future<void> Function() action, String errorPrefix) async {
    setState(() => _isLoading = true);
    try {
      await action();
      if (mounted) context.go('/feed');
    } catch (e) {
      _showError('$errorPrefix: ${e.toString()}');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // ── Login ────────────────────────────────────────────────────────────

  Future<void> _loginWithKey() async {
    final input = _nsecController.text.trim();
    if (input.isEmpty) {
      _showError('Please enter a private key');
      return;
    }
    final notifier = ref.read(authStateProvider.notifier);
    if (input.startsWith('nsec1')) {
      await _runAuth(() => notifier.loginWithNsec(input), 'Invalid nsec key');
    } else if (RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(input)) {
      await _runAuth(() => notifier.loginWithHexKey(input), 'Invalid hex key');
    } else {
      _showError('Key must start with nsec1 or be a 64-char hex string');
    }
  }

  Future<void> _browseReadOnly() async {
    final input = _npubController.text.trim();
    if (input.isEmpty) {
      _showError('Please enter an npub');
      return;
    }
    if (!input.startsWith('npub1')) {
      _showError('Public key must start with npub1');
      return;
    }
    final notifier = ref.read(authStateProvider.notifier);
    await _runAuth(() => notifier.loginReadOnly(input), 'Invalid npub');
  }

  // ── Signup ───────────────────────────────────────────────────────────

  Future<void> _generateKeys() async {
    final notifier = ref.read(authStateProvider.notifier);
    await _runAuth(notifier.generateKeys, 'Failed to generate keys');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Hero section
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                  vertical: 48, horizontal: 24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [scheme.primary, scheme.tertiary],
                ),
                borderRadius: const BorderRadius.only(
                  bottomLeft: Radius.circular(40),
                  bottomRight: Radius.circular(40),
                ),
              ),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.1),
                          blurRadius: 20,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: const Icon(
                      Icons.bolt,
                      size: 48,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'NostrFeed',
                    style: theme.textTheme.headlineLarge?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Your Nostr Operating System',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: Colors.white.withValues(alpha: 0.85),
                    ),
                  ),
                ],
              ),
            ),

            // Tab bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
              child: Container(
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest
                      .withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: TabBar(
                  controller: _tabController,
                  labelColor: Colors.white,
                  unselectedLabelColor: scheme.onSurfaceVariant,
                  indicator: BoxDecoration(
                    color: scheme.primary,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  indicatorSize: TabBarIndicatorSize.tab,
                  dividerColor: Colors.transparent,
                  labelStyle: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                  tabs: const [
                    Tab(text: 'Log In'),
                    Tab(text: 'Sign Up'),
                  ],
                ),
              ),
            ),

            // Tab content
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  _buildLoginTab(theme),
                  _buildSignupTab(theme),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Login tab ────────────────────────────────────────────────────────

  Widget _buildLoginTab(ThemeData theme) {
    final scheme = theme.colorScheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Welcome back',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            'Log in with your Nostr private key',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),

          // nsec key input
          TextField(
            controller: _nsecController,
            obscureText: true,
            enabled: !_isLoading,
            decoration: InputDecoration(
              labelText: 'Private Key',
              hintText: 'nsec1… or 64-char hex',
              prefixIcon: const Icon(Icons.key),
              suffixIcon: IconButton(
                icon: const Icon(Icons.paste),
                tooltip: 'Paste',
                onPressed: () async {
                  final data = await Clipboard.getData('text/plain');
                  if (data?.text != null) {
                    _nsecController.text = data!.text!;
                  }
                },
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              filled: true,
              fillColor: scheme.surfaceContainerHighest
                  .withValues(alpha: 0.3),
            ),
          ),
          const SizedBox(height: 16),
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
            label: const Text('Log In'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),

          const SizedBox(height: 32),
          Row(
            children: [
              Expanded(child: Divider(color: scheme.outlineVariant)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'or',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              Expanded(child: Divider(color: scheme.outlineVariant)),
            ],
          ),
          const SizedBox(height: 32),

          // Read-only browse
          Text(
            'Browse without an account',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            'Enter any npub to browse Nostr in read-only mode',
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _npubController,
            enabled: !_isLoading,
            decoration: InputDecoration(
              labelText: 'Public Key',
              hintText: 'npub1…',
              prefixIcon: const Icon(Icons.person_outline),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              filled: true,
              fillColor: scheme.surfaceContainerHighest
                  .withValues(alpha: 0.3),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _isLoading ? null : _browseReadOnly,
            icon: const Icon(Icons.explore),
            label: const Text('Browse Read-Only'),
            style: OutlinedButton.styleFrom(
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

  // ── Signup tab ───────────────────────────────────────────────────────

  Widget _buildSignupTab(ThemeData theme) {
    final scheme = theme.colorScheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Create your account',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            'Generate a fresh Nostr key pair to get started',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),

          // Feature list
          _SignupFeature(
            icon: Icons.key,
            title: 'Your keys, your identity',
            body: 'A private key is generated on your device. '
                'It never leaves this app.',
            scheme: scheme,
          ),
          const SizedBox(height: 16),
          _SignupFeature(
            icon: Icons.no_accounts_outlined,
            title: 'No email or phone',
            body: 'No signup forms, no verification codes. '
                'Your key is your account.',
            scheme: scheme,
          ),
          const SizedBox(height: 16),
          _SignupFeature(
            icon: Icons.backup_outlined,
            title: 'Back it up',
            body: 'Write down your private key somewhere safe. '
                'Without it, your account is gone forever.',
            scheme: scheme,
          ),
          const SizedBox(height: 32),

          // Generate button
          FilledButton.icon(
            onPressed: _isLoading ? null : _generateKeys,
            icon: _isLoading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.person_add),
            label: const Text('Generate New Keys'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'After generating, save your private key immediately. '
            'You will need it to log in again.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
              fontStyle: FontStyle.italic,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ── Signup feature row ───────────────────────────────────────────────

class _SignupFeature extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;
  final ColorScheme scheme;

  const _SignupFeature({
    required this.icon,
    required this.title,
    required this.body,
    required this.scheme,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: scheme.primaryContainer.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 20, color: scheme.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                body,
                style: TextStyle(
                  fontSize: 12,
                  color: scheme.onSurfaceVariant,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
