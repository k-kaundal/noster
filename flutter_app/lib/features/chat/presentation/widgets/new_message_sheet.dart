import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/chat_screen.dart'
    show normalizePubkey;
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/search_results.dart';
import 'package:nostrfeed_mobile/features/chat/presentation/widgets/suggested_peers.dart';

/// Bottom-sheet "new message" picker with live people search.
/// Accepts: npub, nprofile, hex pubkey, NIP-05 (alice@domain.com),
/// lightning address, or plain name search — with no auto-domain appending.
class NewMessageSheet extends ConsumerStatefulWidget {
  const NewMessageSheet({super.key});

  @override
  ConsumerState<NewMessageSheet> createState() => _NewMessageSheetState();
}

class _NewMessageSheetState extends ConsumerState<NewMessageSheet> {
  final _searchController = TextEditingController();
  String _query = '';
  String? _resolveError;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _openDirectChat(BuildContext context, String input) async {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return;

    // 1. Try direct pubkey decode (npub / nprofile / hex)
    final directHex = normalizePubkey(trimmed);
    if (directHex != null) {
      if (mounted) {
        Navigator.pop(context);
        context.push('/chat/$directHex');
      }
      return;
    }

    // 2. Try resolving via user search (handles NIP-05 / lightning address)
    try {
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();
      final results = await nostr.searchUsers(trimmed, limit: 1);
      if (results.isNotEmpty) {
        if (mounted) {
          final ctx = this.context;
          if (ctx.mounted) {
            Navigator.pop(ctx);
            ctx.push('/chat/${results.first.pubkey}');
          }
        }
        return;
      }
      setState(() {
        _resolveError = 'No user found for "$trimmed"';
      });
    } catch (e) {
      setState(() {
        _resolveError = 'Lookup failed: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Handle bar
              Container(
                margin: const EdgeInsets.symmetric(vertical: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                child: Row(
                  children: [
                    Text(
                      'New Message',
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),

              // Search field
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: TextField(
                  controller: _searchController,
                  autofocus: true,
                  autocorrect: false,
                  decoration: InputDecoration(
                    hintText: 'Name, npub, NIP-05, or lightning address…',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () {
                              _searchController.clear();
                              setState(() {
                                _query = '';
                                _resolveError = null;
                              });
                            },
                          )
                        : null,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    filled: true,
                    fillColor: colorScheme.surfaceContainerHighest.withValues(
                      alpha: 0.5,
                    ),
                  ),
                  onChanged: (v) => setState(() {
                    _query = v.trim();
                    _resolveError = null;
                  }),
                  onSubmitted: (v) => _openDirectChat(context, v),
                ),
              ),

              if (_resolveError != null) ...[
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Text(
                    _resolveError!,
                    style: TextStyle(color: colorScheme.error, fontSize: 13),
                  ),
                ),
              ],

              const SizedBox(height: 12),

              // Quick action: open via direct identifier
              if (_query.isNotEmpty &&
                  (normalizePubkey(_query) != null ||
                      _query.contains('@') ||
                      _query.contains('.')))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => _openDirectChat(context, _query),
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: colorScheme.primaryContainer.withValues(
                            alpha: 0.4,
                          ),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: colorScheme.primary.withValues(alpha: 0.3),
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.key_rounded,
                              size: 20,
                              color: colorScheme.primary,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Open chat directly',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w600,
                                      color: colorScheme.primary,
                                    ),
                                  ),
                                  Text(
                                    _query,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Icon(
                              Icons.arrow_forward_ios_rounded,
                              size: 14,
                              color: colorScheme.primary,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),

              // Search results
              if (_query.isNotEmpty && normalizePubkey(_query) == null)
                Flexible(
                  child: SearchResults(
                    query: _query,
                    onSelect: (pubkey) {
                      Navigator.pop(context);
                      context.push('/chat/$pubkey');
                    },
                  ),
                )
              else if (_query.isEmpty)
                Flexible(
                  child: SuggestedPeers(
                    onSelect: (pubkey) {
                      Navigator.pop(context);
                      context.push('/chat/$pubkey');
                    },
                  ),
                ),

              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}
