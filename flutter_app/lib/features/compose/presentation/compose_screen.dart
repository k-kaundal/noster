import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/compose/data/upload_service.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_notifier.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/quote_card.dart';

class ComposeScreen extends ConsumerStatefulWidget {
  /// The event being quoted (NIP-18 quote post), or null for a plain note.
  final NostrEvent? quoted;
  const ComposeScreen({super.key, this.quoted});

  @override
  ConsumerState<ComposeScreen> createState() => _ComposeScreenState();
}

enum _ComposeMode { note, poll }

class _ComposeScreenState extends ConsumerState<ComposeScreen> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  static const _maxChars = 2000;
  _ComposeMode _mode = _ComposeMode.note;

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
  // Uploaded images — kept as UploadResult (not just the URL) so the post
  // carries NIP-92 imeta metadata (m/x/size) alongside each URL. Feed
  // clients use it to reserve layout space and verify the media.
  final List<UploadResult> _imageUrls = [];

  // ── Poll state (NIP-88) ─────────────────────────────────────────────
  final List<TextEditingController> _pollOptions = [
    TextEditingController(),
    TextEditingController(),
  ];
  bool _pollMultiple = false;
  Duration? _pollDuration = const Duration(days: 1);

  bool get _isQuote => widget.quoted != null;

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
    for (final c in _pollOptions) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _canPost {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly || _isPosting || _isUploading) {
      return false;
    }
    if (_mode == _ComposeMode.poll) {
      // A poll needs a question + ≥2 non-empty options.
      if (_controller.text.trim().isEmpty) return false;
      final filled =
          _pollOptions.where((c) => c.text.trim().isNotEmpty).length;
      return filled >= 2;
    }
    return (_controller.text.trim().isNotEmpty ||
            _imageUrls.isNotEmpty ||
            _isQuote) &&
        _controller.text.length <= _maxChars;
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
      final question = _controller.text.trim();

      late final NostrEvent event;
      if (_mode == _ComposeMode.poll) {
        // NIP-88 poll.
        final options = <(String, String)>[
          for (var i = 0; i < _pollOptions.length; i++)
            if (_pollOptions[i].text.trim().isNotEmpty)
              ('opt${i + 1}', _pollOptions[i].text.trim()),
        ];
        event = nostr.createPoll(
          question: question,
          options: options,
          multipleChoice: _pollMultiple,
          endsAt:
              _pollDuration == null ? null : DateTime.now().add(_pollDuration!),
        );
      } else {
        var content = question;
        // Append image URLs to content (clients render them inline).
        for (final img in _imageUrls) {
          if (content.isNotEmpty) content += '\n';
          content += img.url;
        }
        if (_isQuote) {
          // NIP-18 quote post: the quoted event's NIP-21 ref goes inline so
          // clients that render inline quotes link it; the q tag is added by
          // the factory.
          final quotedRef = nostr.authService.encodeNote(widget.quoted!.id);
          if (content.isNotEmpty) content += '\n';
          content += 'nostr:$quotedRef';
          final tags = _extractHashtags(content);
          event = _quoteWithHashtags(nostr, content, tags);
        } else {
          final tags = _extractHashtags(content);
          // NIP-92 imeta tags: one per uploaded image, carrying the mime,
          // sha256 (x), and byte size so feed tiles can reserve space and
          // BUD-03 re-hosting can verify the content. The URL is also in
          // the content (above) for clients that don't read imeta.
          for (final img in _imageUrls) {
            tags.add(['imeta', ...img.toImetaEntries()]);
          }
          event = nostr.createPost(content, tags: tags);
        }
      }
      nostr.publish(event);

      // Refresh all feeds so the new post shows up immediately everywhere.
      ref.read(globalFeedProvider.notifier).refresh();
      ref.read(followingFeedNotifierProvider.notifier).refresh();
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
                Icon(Icons.check_circle_rounded,
                    color: Colors.white, size: 20),
                SizedBox(width: 12),
                Text('Posted successfully!'),
              ],
            ),
            behavior: SnackBarBehavior.floating,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        );
        setState(() => _isPosting = false);
      }
    }
  }

  /// A quote post carries the factory's q/p tags PLUS the hashtags the user
  /// typed (the factory doesn't extract those).
  NostrEvent _quoteWithHashtags(
    dynamic nostr,
    String content,
    List<List<String>> hashtagTags,
  ) {
    final base = nostr.createQuotePost(content, quoted: widget.quoted!);
    // Re-sign with the combined tag set (quote tags + hashtags + client).
    return nostr.authService.signEvent(
      privateKey: ref.read(authStateProvider).privateKey!,
      kind: base.kind,
      content: base.content,
      tags: [...base.tags, ...hashtagTags],
    );
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

      final uploadService = ref.read(uploadServiceProvider);
      final result = await uploadService.uploadImageDetailed(image);

      if (mounted) {
        setState(() {
          _imageUrls.add(result);
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
    final needsSpace =
        text.isNotEmpty && !text.endsWith(' ') && !text.endsWith('\n');
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
        title: Text(
          _isQuote
              ? 'Quote post'
              : _mode == _ComposeMode.poll
                  ? 'New poll'
                  : 'New Post',
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20),
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
          // Note / Poll mode switch (hidden on quote posts — a quote is a
          // note, not a poll).
          if (!_isQuote)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: SegmentedButton<_ComposeMode>(
                segments: const [
                  ButtonSegment(
                    value: _ComposeMode.note,
                    icon: Icon(Icons.edit_note_rounded),
                    label: Text('Post'),
                  ),
                  ButtonSegment(
                    value: _ComposeMode.poll,
                    icon: Icon(Icons.poll_rounded),
                    label: Text('Poll'),
                  ),
                ],
                selected: {_mode},
                onSelectionChanged: (s) =>
                    setState(() => _mode = s.first),
              ),
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
                  // Text field (question in poll mode)
                  TextField(
                    controller: _controller,
                    focusNode: _focusNode,
                    autofocus: true,
                    maxLines: null,
                    minLines: _mode == _ComposeMode.poll ? 2 : 5,
                    textAlignVertical: TextAlignVertical.top,
                    style: const TextStyle(fontSize: 17, height: 1.5),
                    decoration: InputDecoration(
                      hintText: _mode == _ComposeMode.poll
                          ? 'Ask a question…'
                          : _isQuote
                              ? 'Add your thoughts…'
                              : "What's on your mind?",
                      hintStyle: TextStyle(
                        color:
                            colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
                        fontSize: 17,
                      ),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),

                  // Poll options editor
                  if (_mode == _ComposeMode.poll) _buildPollEditor(colorScheme),

                  // Quoted event preview
                  if (_isQuote) ...[
                    const SizedBox(height: 12),
                    QuoteCard(reference: widget.quoted!.id),
                  ],

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
                                _imageUrls[i].url,
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
                                    color:
                                        Colors.black.withValues(alpha: 0.6),
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
          // Hashtag suggestions (notes + quotes, not polls)
          if (_mode == _ComposeMode.note)
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                itemCount: _suggestedHashtags.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final tag = _suggestedHashtags[i];
                  return Center(
                    child: ActionChip(
                      label: Text('#$tag'),
                      visualDensity: VisualDensity.compact,
                      onPressed: () => _appendHashtag(tag),
                      backgroundColor:
                          colorScheme.primaryContainer.withValues(alpha: 0.5),
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    if (_mode == _ComposeMode.note)
                      IconButton(
                        icon: Icon(
                          Icons.image_outlined,
                          color: _isUploading
                              ? colorScheme.onSurfaceVariant
                                  .withValues(alpha: 0.3)
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

  Widget _buildPollEditor(ColorScheme colorScheme) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < _pollOptions.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextField(
                controller: _pollOptions[i],
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Option ${i + 1}',
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  suffixIcon: _pollOptions.length > 2
                      ? IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          onPressed: () =>
                              setState(() => _pollOptions.removeAt(i)),
                        )
                      : null,
                ),
              ),
            ),
          if (_pollOptions.length < 4)
            TextButton.icon(
              onPressed: () =>
                  setState(() => _pollOptions.add(TextEditingController())),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Add option'),
            ),
          Row(
            children: [
              Expanded(
                child: SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Allow multiple choices',
                      style: TextStyle(fontSize: 14)),
                  value: _pollMultiple,
                  onChanged: (v) => setState(() => _pollMultiple = v),
                ),
              ),
            ],
          ),
          DropdownButtonFormField<Duration?>(
            initialValue: _pollDuration,
            decoration: const InputDecoration(
              labelText: 'Poll duration',
              isDense: true,
            ),
            items: const [
              DropdownMenuItem(value: Duration(hours: 1), child: Text('1 hour')),
              DropdownMenuItem(value: Duration(days: 1), child: Text('1 day')),
              DropdownMenuItem(value: Duration(days: 3), child: Text('3 days')),
              DropdownMenuItem(value: Duration(days: 7), child: Text('1 week')),
              DropdownMenuItem(value: null, child: Text('No end')),
            ],
            onChanged: (v) => setState(() => _pollDuration = v),
          ),
        ],
      ),
    );
  }
}
