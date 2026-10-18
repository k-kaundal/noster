import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';

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
    _tabController = TabController(length: 3, vsync: this);
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
      ),
    );
  }

  Future<void> _runAuth(Future<void> Function() action, String errorPrefix) async {
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

  Future<void> _generateKeys() async {
    final notifier = ref.read(authStateProvider.notifier);
    await _runAuth(notifier.generateKeys, 'Failed to generate keys');
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Gradient header with logo/title
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    scheme.primary,
                    scheme.tertiary,
                  ],
                ),
                borderRadius: const BorderRadius.only(
                  bottomLeft: Radius.circular(32),
                  bottomRight: Radius.circular(32),
                ),
              ),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: scheme.onPrimary.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.bolt,
                      size: 48,
                      color: scheme.onPrimary,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'NostrFeed',
                    style: theme.textTheme.headlineMedium?.copyWith(
                      color: scheme.onPrimary,
                      fontWeight: FontWeight.bold,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Your Nostr Operating System',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: scheme.onPrimary.withValues(alpha: 0.85),
                    ),
                  ),
                ],
              ),
            ),

            // Tab bar
            TabBar(
              controller: _tabController,
              labelColor: scheme.primary,
              unselectedLabelColor: scheme.onSurface.withValues(alpha: 0.6),
              indicatorColor: scheme.primary,
              tabs: const [
                Tab(text: 'Extension'),
                Tab(text: 'Key'),
                Tab(text: 'Browse'),
              ],
            ),

            // Tab content
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  _buildExtensionTab(theme),
                  _buildKeyTab(theme),
                  _buildBrowseTab(theme),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildExtensionTab(ThemeData theme) {
    final scheme = theme.colorScheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(Icons.extension, size: 56, color: scheme.primary),
          const SizedBox(height: 16),
          Text(
            'Login with Browser Extension',
            style: theme.textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Text(
            'Use a NIP-07 compatible extension like Alby, nos2x, or Flamingo. '
            'Your keys stay in the extension and are never shared with this app.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurface.withValues(alpha: 0.7),
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: _isLoading
                ? null
                : () => _showError('NIP-07 extension login is not yet supported on this platform'),
            icon: const Icon(Icons.login),
            label: const Text('Connect Extension'),
          ),
        ],
      ),
    );
  }

  Widget _buildKeyTab(ThemeData theme) {
    final scheme = theme.colorScheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Login with Private Key',
            style: theme.textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _nsecController,
            obscureText: true,
            enabled: !_isLoading,
            decoration: InputDecoration(
              labelText: 'Private Key',
              hintText: 'nsec1... or 64-char hex',
              prefixIcon: const Icon(Icons.key),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _isLoading ? null : _loginWithKey,
            icon: _isLoading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.login),
            label: const Text('Login with Key'),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(child: Divider(color: scheme.outlineVariant)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  'or',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurface.withValues(alpha: 0.6),
                  ),
                ),
              ),
              Expanded(child: Divider(color: scheme.outlineVariant)),
            ],
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: _isLoading ? null : _generateKeys,
            icon: const Icon(Icons.person_add),
            label: const Text('Generate New Keys'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'New to Nostr? Generate a fresh key pair to sign up.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurface.withValues(alpha: 0.6),
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildBrowseTab(ThemeData theme) {
    final scheme = theme.colorScheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(Icons.visibility_outlined, size: 56, color: scheme.primary),
          const SizedBox(height: 16),
          Text(
            'Browse Read-Only',
            style: theme.textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Text(
            'Enter any npub to browse Nostr as that user in read-only mode. '
            'You won\'t be able to post, like, or zap.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurface.withValues(alpha: 0.7),
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _npubController,
            enabled: !_isLoading,
            decoration: InputDecoration(
              labelText: 'Public Key',
              hintText: 'npub1...',
              prefixIcon: const Icon(Icons.person_outline),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _isLoading ? null : _browseReadOnly,
            icon: _isLoading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.explore),
            label: const Text('Browse'),
          ),
        ],
      ),
    );
  }
}
