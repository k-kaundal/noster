import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../widgets/post/post_card.dart';

class ThreadScreen extends ConsumerStatefulWidget {
  final NostrEvent rootEvent;

  const ThreadScreen({super.key, required this.rootEvent});

  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> {
  final _replyController = TextEditingController();
  bool _isPosting = false;

  @override
  void dispose() {
    _replyController.dispose();
    super.dispose();
  }

  Future<void> _postReply() async {
    final content = _replyController.text.trim();
    if (content.isEmpty) return;

    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Log in to reply')),
      );
      return;
    }

    setState(() => _isPosting = true);

    try {
      final nostr = ref.read(nostrServiceProvider);
      final replyEvent = nostr.createReply(
        content,
        widget.rootEvent.id,
        widget.rootEvent.pubkey,
      );
      nostr.publish(replyEvent);
      _replyController.clear();

      // Refresh replies
      ref.invalidate(repliesProvider(widget.rootEvent.id));

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reply posted!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to post reply: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isPosting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final repliesAsync = ref.watch(repliesProvider(widget.rootEvent.id));
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Thread'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Column(
        children: [
          // ─── Thread content ─────────────────────────────────────
          Expanded(
            child: ListView(
              children: [
                // Parent post
                PostCard(
                  event: widget.rootEvent,
                  isThreadView: true,
                ),

                // Divider
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      Text(
                        'Replies',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: colorScheme.onSurface.withValues(alpha: 0.7),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(child: Divider(color: colorScheme.outlineVariant)),
                    ],
                  ),
                ),

                // Replies list
                repliesAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(32),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (error, _) => Padding(
                    padding: const EdgeInsets.all(16),
                    child: Center(
                      child: Text(
                        'Failed to load replies',
                        style: TextStyle(color: colorScheme.error),
                      ),
                    ),
                  ),
                  data: (replies) {
                    if (replies.isEmpty) {
                      return Padding(
                        padding: const EdgeInsets.all(32),
                        child: Center(
                          child: Text(
                            'No replies yet. Be the first!',
                            style: TextStyle(
                              color: colorScheme.onSurface.withValues(alpha: 0.5),
                            ),
                          ),
                        ),
                      );
                    }

                    // Sort replies by created_at ascending (oldest first)
                    final sorted = List<NostrEvent>.from(replies)
                      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));

                    return Column(
                      children: sorted
                          .map((reply) => PostCard(event: reply))
                          .toList(),
                    );
                  },
                ),
              ],
            ),
          ),

          // ─── Reply input ────────────────────────────────────────
          if (auth.isLoggedIn && !auth.isReadOnly)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: colorScheme.surface,
                border: Border(
                  top: BorderSide(color: colorScheme.outlineVariant),
                ),
              ),
              child: SafeArea(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _replyController,
                        maxLines: 4,
                        minLines: 1,
                        textInputAction: TextInputAction.newline,
                        decoration: InputDecoration(
                          hintText: 'Write a reply...',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide.none,
                          ),
                          filled: true,
                          fillColor: colorScheme.surfaceContainerHighest,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 10,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _isPosting
                        ? const Padding(
                            padding: EdgeInsets.all(8),
                            child: SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          )
                        : IconButton(
                            onPressed: _postReply,
                            icon: Icon(
                              Icons.send,
                              color: colorScheme.primary,
                            ),
                          ),
                  ],
                ),
              ),
            )
          else
            Container(
              padding: const EdgeInsets.all(16),
              child: Text(
                'Log in to reply',
                style: TextStyle(
                  color: colorScheme.onSurface.withValues(alpha: 0.5),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
