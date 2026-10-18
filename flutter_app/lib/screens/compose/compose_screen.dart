import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';

class ComposeScreen extends ConsumerStatefulWidget {
  const ComposeScreen({super.key});

  @override
  ConsumerState<ComposeScreen> createState() => _ComposeScreenState();
}

class _ComposeScreenState extends ConsumerState<ComposeScreen> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  static const _maxChars = 2000;

  static const _suggestedHashtags = [
    'nostr',
    'nostrfeed',
    'bitcoin',
    'lightning',
    'zaps',
    'gm',
    'plebchain',
    'photography',
    'art',
    'music',
  ];

  bool _isPosting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  bool get _canPost {
    final auth = ref.read(authStateProvider);
    return auth.isLoggedIn &&
        !auth.isReadOnly &&
        _controller.text.trim().isNotEmpty &&
        _controller.text.length <= _maxChars &&
        !_isPosting;
  }

  List<List<String>> _extractHashtags(String content) {
    final regex = RegExp(r'#(\w+)');
    final matches = regex.allMatches(content);
    final seen = <String>{};
    final tags = <List<String>>[];
    for (final m in matches) {
      final tag = m.group(1)!.toLowerCase();
      if (seen.add(tag)) {
        tags.add(['t', tag]);
      }
    }
    return tags;
  }

  Future<void> _post() async {
    if (!_canPost) return;
    setState(() => _isPosting = true);

    try {
      final nostr = ref.read(nostrServiceProvider);
      final content = _controller.text.trim();
      final tags = _extractHashtags(content);

      final event = nostr.createPost(content, tags: tags);
      nostr.publish(event);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Posted!')),
        );
        context.pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to post: $e')),
        );
        setState(() => _isPosting = false);
      }
    }
  }

  void _appendHashtag(String tag) {
    final text = _controller.text;
    final needsSpace = text.isNotEmpty && !text.endsWith(' ') && !text.endsWith('\n');
    _controller.text = '$text${needsSpace ? ' ' : ''}#$tag ';
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: _controller.text.length),
    );
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final auth = ref.watch(authStateProvider);
    final remaining = _maxChars - _controller.text.length;
    final isOverLimit = remaining < 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('New Post'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.pop(),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: FilledButton(
              onPressed: _canPost ? _post : null,
              child: _isPosting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Post'),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (!auth.isLoggedIn || auth.isReadOnly)
            MaterialBanner(
              content: Text(
                auth.isReadOnly
                    ? 'You are in read-only mode. Log in with a key to post.'
                    : 'You must be logged in to post.',
              ),
              actions: [
                TextButton(
                  onPressed: () => context.go('/login'),
                  child: const Text('Log in'),
                ),
              ],
            ),
          Expanded(
            child: TextField(
              controller: _controller,
              focusNode: _focusNode,
              autofocus: true,
              maxLines: null,
              expands: true,
              textAlignVertical: TextAlignVertical.top,
              style: const TextStyle(fontSize: 16, height: 1.4),
              decoration: const InputDecoration(
                hintText: "What's happening?",
                border: InputBorder.none,
                contentPadding: EdgeInsets.all(16),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
          // Hashtag suggestion bar
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _suggestedHashtags.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final tag = _suggestedHashtags[i];
                return Center(
                  child: ActionChip(
                    label: Text('#$tag'),
                    visualDensity: VisualDensity.compact,
                    onPressed: () => _appendHashtag(tag),
                  ),
                );
              },
            ),
          ),
          const Divider(height: 1),
          // Bottom toolbar
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.image_outlined),
                    tooltip: 'Add image (coming soon)',
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Image attachments coming soon')),
                      );
                    },
                  ),
                  const Spacer(),
                  Text(
                    '$remaining',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isOverLimit
                          ? theme.colorScheme.error
                          : theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      fontWeight: isOverLimit ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
