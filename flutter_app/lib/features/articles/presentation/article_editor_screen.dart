import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/compose/application/upload_providers.dart';

/// NIP-23 long-form article editor (kind 30023).
///
/// Per the spec: content is Markdown (no hard line-breaks, no HTML),
/// metadata lives in tags (title, summary, image, published_at, t), and
/// the `d` tag gives the article a stable, editable identity.
///
/// Features: markdown toolbar, cover image upload via Blossom, live preview,
/// hashtag + summary support, login-gated publish.
class ArticleEditorScreen extends ConsumerStatefulWidget {
  const ArticleEditorScreen({super.key});

  @override
  ConsumerState<ArticleEditorScreen> createState() =>
      _ArticleEditorScreenState();
}

class _ArticleEditorScreenState extends ConsumerState<ArticleEditorScreen> {
  final _titleController = TextEditingController();
  final _summaryController = TextEditingController();
  final _imageController = TextEditingController();
  final _tagsController = TextEditingController();
  final _contentController = TextEditingController();
  final _contentFocus = FocusNode();
  bool _preview = false;
  bool _publishing = false;
  bool _uploadingCover = false;

  @override
  void dispose() {
    _titleController.dispose();
    _summaryController.dispose();
    _imageController.dispose();
    _tagsController.dispose();
    _contentController.dispose();
    _contentFocus.dispose();
    super.dispose();
  }

  bool get _canPublish =>
      _titleController.text.trim().isNotEmpty &&
      _contentController.text.trim().isNotEmpty &&
      !_publishing;

  List<String> _parseTags() => _tagsController.text
      .split(RegExp(r'[,\s]+'))
      .map((t) => t.trim().replaceAll(RegExp(r'^#'), '').toLowerCase())
      .where((t) => t.isNotEmpty)
      .toSet()
      .toList();

  // ── Markdown toolbar helpers ─────────────────────────────────────

  /// Wrap the current selection with [left]/[right], or insert markers at
  /// the cursor when nothing is selected.
  void _wrapSelection(String left, [String? right]) {
    right ??= left;
    final text = _contentController.text;
    final sel = _contentController.selection;
    final start = sel.start < 0 ? 0 : sel.start;
    final end = sel.end < 0 ? text.length : sel.end;
    final selected = sel.isValid && !sel.isCollapsed
        ? text.substring(sel.start, sel.end)
        : '';
    final newText = text.replaceRange(start, end, '$left$selected$right');
    final cursor = start + left.length + selected.length + right.length;
    _contentController.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: cursor),
    );
    _contentFocus.requestFocus();
    setState(() {});
  }

  /// Insert a line-level prefix (#, -, >, 1.) at the start of the current line.
  void _prefixLine(String prefix) {
    final text = _contentController.text;
    final sel = _contentController.selection;
    final cursor = sel.start < 0 ? text.length : sel.start;
    final lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    final newText = text.replaceRange(lineStart, lineStart, prefix);
    _contentController.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: cursor + prefix.length),
    );
    _contentFocus.requestFocus();
    setState(() {});
  }

  void _insertMarkdown(String snippet, [int cursorOffset = 0]) {
    final text = _contentController.text;
    final sel = _contentController.selection;
    final cursor = sel.start < 0 ? text.length : sel.start;
    final newText = text.replaceRange(cursor, cursor, snippet);
    _contentController.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(
        offset: cursor + snippet.length + cursorOffset,
      ),
    );
    _contentFocus.requestFocus();
    setState(() {});
  }

  Future<void> _insertImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
    );
    if (file == null || !mounted) return;
    try {
      final url =
          await ref.read(uploadProvider.notifier).uploadImage(file);
      if (!mounted) return;
      _insertMarkdown('\n![image]($url)\n');
      AppToast.success(context, 'Image added');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Upload failed: $e');
    }
  }

  Future<void> _pickCoverImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
    );
    if (file == null || !mounted) return;
    setState(() => _uploadingCover = true);
    try {
      final url =
          await ref.read(uploadProvider.notifier).uploadImage(file);
      if (!mounted) return;
      _imageController.text = url;
      AppToast.success(context, 'Cover image set');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploadingCover = false);
    }
  }

  Future<void> _publish() async {
    if (!_canPublish) return;
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to publish articles');
      return;
    }
    HapticFeedback.mediumImpact();
    setState(() => _publishing = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final event = nostr.createArticle(
        title: _titleController.text.trim(),
        content: _contentController.text.trim(),
        summary: _summaryController.text.trim().isEmpty
            ? null
            : _summaryController.text.trim(),
        image: _imageController.text.trim().isEmpty
            ? null
            : _imageController.text.trim(),
        hashtags: _parseTags(),
      );
      await nostr.publishEvent(event);
      ref.invalidate(articlesProvider);
      final pk = auth.pubkey;
      if (pk != null) ref.invalidate(userPostsProvider(pk));

      if (mounted) {
        AppToast.success(context, 'Article published');
        Navigator.pop(context, event);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Publish failed: $e');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Write Article'),
        actions: [
          TextButton.icon(
            onPressed: () => setState(() => _preview = !_preview),
            icon: Icon(
              _preview ? Icons.edit_outlined : Icons.visibility_outlined,
              size: 18,
            ),
            label: Text(_preview ? 'Edit' : 'Preview'),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: !auth.isLoggedIn || auth.isReadOnly
          ? _LoginPrompt(colorScheme: colorScheme)
          : Column(
              children: [
                Expanded(
                  child: _preview
                      ? _buildPreview(colorScheme)
                      : _buildEditor(colorScheme),
                ),
                if (!_preview) _MarkdownToolbar(editor: this),
                _PublishBar(
                  publishing: _publishing,
                  canPublish: _canPublish,
                  onPublish: _publish,
                ),
              ],
            ),
    );
  }

  Widget _buildEditor(ColorScheme colorScheme) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Title
        TextField(
          controller: _titleController,
          textCapitalization: TextCapitalization.sentences,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          decoration: InputDecoration(
            hintText: 'Article title',
            border: InputBorder.none,
            hintStyle: TextStyle(
              color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        Divider(color: colorScheme.outlineVariant.withValues(alpha: 0.4)),

        // Summary
        TextField(
          controller: _summaryController,
          maxLines: 2,
          decoration: InputDecoration(
            hintText: 'Summary — shown in feeds (optional)',
            border: InputBorder.none,
            hintStyle: TextStyle(
              fontSize: 14,
              color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
          ),
        ),

        // Cover image: upload button + URL field
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextField(
                controller: _imageController,
                decoration: InputDecoration(
                  hintText: 'Cover image URL (optional)',
                  prefixIcon: const Icon(Icons.image_outlined, size: 18),
                  border: InputBorder.none,
                  hintStyle: TextStyle(
                    fontSize: 13,
                    color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
                  ),
                ),
                keyboardType: TextInputType.url,
                onChanged: (_) => setState(() {}),
              ),
            ),
            _uploadingCover
                ? const Padding(
                    padding: EdgeInsets.all(8),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : IconButton(
                    icon: const Icon(Icons.add_photo_alternate_outlined),
                    tooltip: 'Upload cover image',
                    onPressed: _pickCoverImage,
                  ),
          ],
        ),
        // Cover preview thumbnail
        if (_imageController.text.trim().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.network(
                _imageController.text.trim(),
                height: 110,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
          ),

        // Hashtags
        TextField(
          controller: _tagsController,
          decoration: InputDecoration(
            hintText: 'Hashtags, comma separated (optional)',
            prefixIcon: const Icon(Icons.tag_rounded, size: 18),
            border: InputBorder.none,
            hintStyle: TextStyle(
              fontSize: 13,
              color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
          ),
        ),
        Divider(color: colorScheme.outlineVariant.withValues(alpha: 0.4)),

        // Markdown content
        TextField(
          controller: _contentController,
          focusNode: _contentFocus,
          maxLines: null,
          minLines: 18,
          decoration: InputDecoration(
            hintText: 'Write your article in Markdown…',
            border: InputBorder.none,
            hintStyle: TextStyle(
              height: 1.5,
              color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
            ),
          ),
          style: const TextStyle(fontSize: 15, height: 1.6),
          onChanged: (_) => setState(() {}),
        ),
      ],
    );
  }

  Widget _buildPreview(ColorScheme colorScheme) {
    final title = _titleController.text.trim();
    final summary = _summaryController.text.trim();
    final image = _imageController.text.trim();
    final content = _contentController.text.trim();
    final tags = _parseTags();

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (image.isNotEmpty)
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.network(
              image,
              height: 180,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const SizedBox.shrink(),
            ),
          ),
        const SizedBox(height: 12),
        if (title.isNotEmpty)
          Text(
            title,
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
          ),
        if (summary.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            summary,
            style: TextStyle(
              fontSize: 15,
              fontStyle: FontStyle.italic,
              color: colorScheme.onSurfaceVariant,
            ),
          ),
        ],
        if (tags.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: [
              for (final t in tags)
                Text(
                  '#$t',
                  style: TextStyle(
                    fontSize: 12,
                    color: colorScheme.primary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
            ],
          ),
        ],
        const SizedBox(height: 16),
        content.isEmpty
            ? Text(
                'Nothing to preview yet…',
                style: TextStyle(color: colorScheme.onSurfaceVariant),
              )
            : MarkdownBody(
                data: content,
                styleSheet: MarkdownStyleSheet(
                  p: const TextStyle(fontSize: 15, height: 1.6),
                  h1: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                  h2: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                  h3: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                  blockquote: TextStyle(
                    color: colorScheme.onSurfaceVariant,
                    fontStyle: FontStyle.italic,
                  ),
                  code: TextStyle(
                    backgroundColor: colorScheme.surfaceContainerHighest,
                    fontFamily: 'monospace',
                    fontSize: 13,
                  ),
                  codeblockDecoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
      ],
    );
  }
}

// ── Login prompt ─────────────────────────────────────────────────────

class _LoginPrompt extends StatelessWidget {
  final ColorScheme colorScheme;
  const _LoginPrompt({required this.colorScheme});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.lock_outline,
              size: 48,
              color: colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 16),
            Text(
              'Log in to write articles',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Articles are signed with your key.',
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Markdown toolbar ─────────────────────────────────────────────────

class _MarkdownToolbar extends StatelessWidget {
  final _ArticleEditorScreenState editor;
  const _MarkdownToolbar({required this.editor});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLow,
        border: Border(
          top: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.4),
          ),
        ),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
          child: Row(
            children: [
              _Btn(icon: Icons.format_bold_rounded, tooltip: 'Bold',
                  onTap: () => editor._wrapSelection('**')),
              _Btn(icon: Icons.format_italic_rounded, tooltip: 'Italic',
                  onTap: () => editor._wrapSelection('*')),
              _Btn(icon: Icons.strikethrough_s_rounded, tooltip: 'Strikethrough',
                  onTap: () => editor._wrapSelection('~~')),
              const _Divider(),
              _Btn(icon: Icons.title_rounded, tooltip: 'Heading 1',
                  onTap: () => editor._prefixLine('# ')),
              _Btn(icon: Icons.format_size_rounded, tooltip: 'Heading 2',
                  onTap: () => editor._prefixLine('## ')),
              const _Divider(),
              _Btn(icon: Icons.format_list_bulleted_rounded, tooltip: 'Bullet list',
                  onTap: () => editor._prefixLine('- ')),
              _Btn(icon: Icons.format_list_numbered_rounded, tooltip: 'Numbered list',
                  onTap: () => editor._prefixLine('1. ')),
              _Btn(icon: Icons.format_quote_rounded, tooltip: 'Quote',
                  onTap: () => editor._prefixLine('> ')),
              const _Divider(),
              _Btn(icon: Icons.code_rounded, tooltip: 'Inline code',
                  onTap: () => editor._wrapSelection('`')),
              _Btn(icon: Icons.integration_instructions_rounded, tooltip: 'Code block',
                  onTap: () => editor._insertMarkdown('\n```\n\n```\n', -5)),
              _Btn(icon: Icons.link_rounded, tooltip: 'Link',
                  onTap: () => editor._insertMarkdown('[text](url)')),
              _Btn(icon: Icons.image_outlined, tooltip: 'Insert image',
                  onTap: editor._insertImage),
            ],
          ),
        ),
      ),
    );
  }
}

class _Btn extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  const _Btn({required this.icon, required this.tooltip, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(icon, size: 20),
      tooltip: tooltip,
      visualDensity: VisualDensity.compact,
      onPressed: onTap,
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 22,
      margin: const EdgeInsets.symmetric(horizontal: 4),
      color: Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.5),
    );
  }
}

// ── Publish bar ──────────────────────────────────────────────────────

class _PublishBar extends StatelessWidget {
  final bool publishing;
  final bool canPublish;
  final VoidCallback onPublish;

  const _PublishBar({
    required this.publishing,
    required this.canPublish,
    required this.onPublish,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        10,
        16,
        MediaQuery.of(context).viewPadding.bottom + 10,
      ),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.article_outlined, size: 18, color: colorScheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Markdown · NIP-23',
              style: TextStyle(
                fontSize: 12,
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          FilledButton.icon(
            onPressed: canPublish ? onPublish : null,
            icon: publishing
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.publish_rounded, size: 18),
            label: Text(publishing ? 'Publishing…' : 'Publish'),
          ),
        ],
      ),
    );
  }
}
