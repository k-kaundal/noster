import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

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
  bool _isUploading = false;
  final List<String> _imageUrls = [];

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
        (_controller.text.trim().isNotEmpty || _imageUrls.isNotEmpty) &&
        _controller.text.length <= _maxChars &&
        !_isPosting &&
        !_isUploading;
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
    HapticFeedback.mediumImpact();
    setState(() => _isPosting = true);

    try {
      final nostr = ref.read(nostrServiceProvider);
      var content = _controller.text.trim();

      // Append image URLs to content
      for (final url in _imageUrls) {
        if (content.isNotEmpty) content += '\n';
        content += url;
      }

      final tags = _extractHashtags(content);
      final event = nostr.createPost(content, tags: tags);
      nostr.publish(event);

      // Refresh all feeds so the new post shows up immediately everywhere
      // (home feed, profile, following tab).
      ref.invalidate(feedProvider);
      ref.invalidate(followingFeedProvider);
      ref.invalidate(trendingProvider);
      final auth = ref.read(authStateProvider);
      if (auth.pubkey != null) {
        ref.invalidate(userPostsProvider(auth.pubkey!));
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Row(
              children: [
                Icon(Icons.check_circle_rounded, color: Colors.white, size: 20),
                SizedBox(width: 12),
                Text('Posted successfully!'),
              ],
            ),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            backgroundColor: Colors.green,
          ),
        );
        context.pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to post: $e'),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        );
        setState(() => _isPosting = false);
      }
    }
  }

  Future<void> _pickImage() async {
    HapticFeedback.lightImpact();
    try {
      final picker = ImagePicker();
      final image = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );
      if (image == null) return;

      setState(() => _isUploading = true);

      // Upload via Blossom
      final uploadService = ref.read(uploadServiceProvider);
      final url = await uploadService.uploadImage(image);

      if (mounted) {
        setState(() {
          _imageUrls.add(url);
          _isUploading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isUploading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Upload failed: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  void _removeImage(int index) {
    HapticFeedback.lightImpact();
    setState(() => _imageUrls.removeAt(index));
  }

  void _appendHashtag(String tag) {
    HapticFeedback.lightImpact();
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
    final colorScheme = theme.colorScheme;
    final auth = ref.watch(authStateProvider);
    final remaining = _maxChars - _controller.text.length;
    final isOverLimit = remaining < 0;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: colorScheme.surface,
        title: const Text(
          'New Post',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 20),
        ),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () {
            HapticFeedback.lightImpact();
            context.pop();
          },
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12, top: 8, bottom: 8),
            child: FilledButton(
              onPressed: _canPost ? _post : null,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
              child: _isPosting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Post',
                      style: TextStyle(fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (!auth.isLoggedIn || auth.isReadOnly)
            MaterialBanner(
              backgroundColor: colorScheme.errorContainer,
              content: Text(
                auth.isReadOnly
                    ? 'You are in read-only mode. Log in with a key to post.'
                    : 'You must be logged in to post.',
                style: TextStyle(color: colorScheme.onErrorContainer),
              ),
              actions: [
                TextButton(
                  onPressed: () => context.go('/login'),
                  child: const Text('Log in'),
                ),
              ],
            ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Author row
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 22,
                        backgroundColor: colorScheme.primaryContainer,
                        backgroundImage: auth.profile?.picture != null
                            ? NetworkImage(auth.profile!.picture!)
                            : null,
                        child: auth.profile?.picture == null
                            ? Icon(Icons.person_rounded,
                                color: colorScheme.onPrimaryContainer)
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Text(
                        auth.profile?.displayNameOrName ?? 'Anonymous',
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  // Text field
                  TextField(
                    controller: _controller,
                    focusNode: _focusNode,
                    autofocus: true,
                    maxLines: null,
                    minLines: 5,
                    textAlignVertical: TextAlignVertical.top,
                    style: const TextStyle(fontSize: 17, height: 1.5),
                    decoration: InputDecoration(
                      hintText: "What's on your mind?",
                      hintStyle: TextStyle(
                        color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
                        fontSize: 17,
                      ),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                  // Image previews
                  if (_imageUrls.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    SizedBox(
                      height: 100,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _imageUrls.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (context, i) => Stack(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: Image.network(
                                _imageUrls[i],
                                width: 100,
                                height: 100,
                                fit: BoxFit.cover,
                              ),
                            ),
                            Positioned(
                              top: 4,
                              right: 4,
                              child: GestureDetector(
                                onTap: () => _removeImage(i),
                                child: Container(
                                  padding: const EdgeInsets.all(4),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.6),
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(
                                    Icons.close_rounded,
                                    color: Colors.white,
                                    size: 14,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          // Hashtag suggestions
          Container(
            height: 52,
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(
                  color: colorScheme.outlineVariant.withValues(alpha: 0.3),
                ),
              ),
            ),
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              itemCount: _suggestedHashtags.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final tag = _suggestedHashtags[i];
                return Center(
                  child: ActionChip(
                    label: Text('#$tag'),
                    visualDensity: VisualDensity.compact,
                    onPressed: () => _appendHashtag(tag),
                    backgroundColor: colorScheme.primaryContainer.withValues(alpha: 0.5),
                    labelStyle: TextStyle(
                      color: colorScheme.primary,
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                );
              },
            ),
          ),
          // Bottom toolbar
          Container(
            decoration: BoxDecoration(
              color: colorScheme.surface,
              border: Border(
                top: BorderSide(
                  color: colorScheme.outlineVariant.withValues(alpha: 0.3),
                ),
              ),
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    IconButton(
                      icon: Icon(
                        Icons.image_outlined,
                        color: _isUploading
                            ? colorScheme.onSurfaceVariant.withValues(alpha: 0.3)
                            : colorScheme.primary,
                      ),
                      tooltip: 'Add image',
                      onPressed: _isUploading ? null : _pickImage,
                    ),
                    if (_isUploading) ...[
                      const SizedBox(width: 8),
                      const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Uploading…',
                        style: TextStyle(
                          fontSize: 12,
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                    const Spacer(),
                    // Character counter
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: isOverLimit
                            ? colorScheme.errorContainer
                            : colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '$remaining',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: isOverLimit
                              ? colorScheme.onErrorContainer
                              : colorScheme.onSurfaceVariant,
                          fontWeight:
                              isOverLimit ? FontWeight.bold : FontWeight.w500,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
