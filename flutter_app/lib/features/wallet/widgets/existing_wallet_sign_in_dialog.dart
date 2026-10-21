import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';

// ── Existing wallet sign-in dialog ───────────────────────────────────────

class ExistingWalletSignInDialog extends ConsumerStatefulWidget {
  const ExistingWalletSignInDialog({super.key});

  @override
  ConsumerState<ExistingWalletSignInDialog> createState() =>
      _ExistingWalletSignInDialogState();
}

class _ExistingWalletSignInDialogState
    extends ConsumerState<ExistingWalletSignInDialog>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _linkController = TextEditingController();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _linkController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lnbits = ref.watch(lnbitsAuthProvider);

    return AlertDialog(
      title: const Text('Sign in to your wallet'),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'This opens whichever account the details belong to. If it '
              'isn\'t linked to the Nostr key you\'re signed in with, '
              'the wallet page will say so and offer to link them.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color:
                        Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 16),
            TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Wallet link'),
                Tab(text: 'Password'),
              ],
            ),
            SizedBox(
              height: 200,
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Wallet link tab
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Column(
                      children: [
                        TextField(
                          controller: _linkController,
                          decoration: const InputDecoration(
                            labelText: 'Your wallet address',
                            hintText: 'https://…/wallet?usr=…',
                            prefixIcon: Icon(Icons.link),
                          ),
                          maxLines: 2,
                          minLines: 1,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Paste the whole address. Only the account id '
                          'inside it is used, and it never leaves this device.',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurfaceVariant,
                                  ),
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: lnbits.isLoading
                                ? null
                                : () async {
                                    final ok = await ref
                                        .read(lnbitsAuthProvider
                                            .notifier)
                                        .connectWithLink(
                                            _linkController.text.trim());
                                    if (ok && context.mounted) {
                                      Navigator.pop(context);
                                    }
                                  },
                            icon: lnbits.isLoading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.link),
                            label: const Text('Sign in'),
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Password tab
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Column(
                      children: [
                        TextField(
                          controller: _usernameController,
                          decoration: const InputDecoration(
                            labelText: 'Username',
                            hintText: 'satoshi',
                            prefixIcon: Icon(Icons.person),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _passwordController,
                          decoration: const InputDecoration(
                            labelText: 'Password',
                            prefixIcon: Icon(Icons.lock),
                          ),
                          obscureText: true,
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: lnbits.isLoading
                                ? null
                                : () async {
                                    final ok = await ref
                                        .read(lnbitsAuthProvider
                                            .notifier)
                                        .connectWithPassword(
                                          username:
                                              _usernameController.text
                                                  .trim(),
                                          password:
                                              _passwordController.text,
                                        );
                                    if (ok && context.mounted) {
                                      Navigator.pop(context);
                                    }
                                  },
                            icon: lnbits.isLoading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.key),
                            label: const Text('Sign in'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}
