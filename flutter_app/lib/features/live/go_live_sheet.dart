import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/compose/application/upload_providers.dart';
import 'package:nostrfeed_mobile/features/live/application/live_providers.dart';

/// "Go Live" sheet: publish a NIP-53 live activity (kind 30311) with a
/// streaming URL (RTMP/HLS/m3u8/web) — exactly what zap.stream / Amethyst
/// publish. Title, summary, cover image, streaming URL, hashtags.
class GoLiveSheet extends ConsumerStatefulWidget {
  const GoLiveSheet({super.key});

  @override
  ConsumerState<GoLiveSheet> createState() => _GoLiveSheetState();
}

class _GoLiveSheetState extends ConsumerState<GoLiveSheet> {
  final _titleCtrl = TextEditingController();
  final _summaryCtrl = TextEditingController();
  final _streamCtrl = TextEditingController();
  final _imageCtrl = TextEditingController();
  final _tagsCtrl = TextEditingController();
  bool _uploading = false;
  bool _publishing = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _summaryCtrl.dispose();
    _streamCtrl.dispose();
    _imageCtrl.dispose();
    _tagsCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2048);
    if (file == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final url = await ref.read(uploadProvider.notifier).uploadImage(file);
      if (!mounted) return;
      _imageCtrl.text = url;
      AppToast.success(context, 'Cover uploaded');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _goLive() async {
    final title = _titleCtrl.text.trim();
    final streamUrl = _streamCtrl.text.trim();
    if (title.isEmpty) {
      AppToast.warning(context, 'Enter a title');
      return;
    }
    if (streamUrl.isEmpty) {
      AppToast.warning(context, 'Enter your streaming URL');
      return;
    }
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to go live');
      return;
    }
    setState(() => _publishing = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final tags = _tagsCtrl.text
          .split(RegExp(r'[,\s]+'))
          .map((t) => t.trim().replaceAll(RegExp(r'^#'), '').toLowerCase())
          .where((t) => t.isNotEmpty)
          .toList();
      final event = nostr.authService.signEvent(
        privateKey: auth.privateKey!,
        kind: 30311,
        content: _summaryCtrl.text.trim(),
        tags: [
          [
            'd',
            'live-${DateTime.now().millisecondsSinceEpoch}-${auth.pubkey!.substring(0, 8)}',
          ],
          ['title', title],
          ['summary', _summaryCtrl.text.trim()],
          if (_imageCtrl.text.trim().isNotEmpty) ['image', _imageCtrl.text.trim()],
          ['streaming', streamUrl],
          ['starts', '${DateTime.now().millisecondsSinceEpoch ~/ 1000}'],
          ['status', 'live'],
          for (final t in tags) ['t', t],
          ['p', auth.pubkey!, '', 'Host'],
          ['client', 'nostrfeed'],
        ],
      );
      await nostr.publishEvent(event);
      ref.invalidate(liveEventsProvider);
      if (!mounted) return;
      Navigator.pop(context);
      AppToast.success(context, 'You are live! 🔴');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Go live failed: $e');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.red,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text(
                    'GO LIVE',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Start a live stream',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _titleCtrl,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Stream title',
                hintText: 'What are you streaming?',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _streamCtrl,
              decoration: const InputDecoration(
                labelText: 'Streaming URL',
                hintText: 'https://… .m3u8 or your stream link',
                helperText: 'HLS/m3u8, RTMP relay, or a web player URL',
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _summaryCtrl,
              decoration: const InputDecoration(
                labelText: 'Description (optional)',
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 12),
            // Cover image: upload OR URL
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _imageCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Cover image URL (optional)',
                    ),
                    keyboardType: TextInputType.url,
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                _uploading
                    ? const Padding(
                        padding: EdgeInsets.all(10),
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : IconButton(
                        icon: const Icon(Icons.add_photo_alternate_outlined),
                        tooltip: 'Upload cover',
                        onPressed: _pickImage,
                      ),
              ],
            ),
            if (_imageCtrl.text.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.network(
                    _imageCtrl.text.trim(),
                    height: 90,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                ),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _tagsCtrl,
              decoration: const InputDecoration(
                labelText: 'Hashtags, comma separated (optional)',
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _publishing ? null : _goLive,
                icon: _publishing
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: colorScheme.onPrimary,
                        ),
                      )
                    : const Icon(Icons.sensors_rounded),
                label: const Text('Go Live'),
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.red,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Published as a NIP-53 live activity (kind 30311) — visible on zap.stream, Amethyst, and other Nostr live clients.',
              style: TextStyle(fontSize: 11, color: colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
