import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:video_player/video_player.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/compose/providers/upload_providers.dart';

/// NIP-71 reel uploader: pick a video → upload via Blossom → publish a
/// kind-22 (short-form portrait video) event with imeta metadata (NIP-92).
///
/// The event carries the playable URL, a poster frame (b.nostr.build's free
/// `?poster` endpoint), and the caption as content — exactly what Primal,
/// Amethyst, and other video clients read.
class ReelUploader {
  ReelUploader._();

  static Future<void> show(BuildContext context) {
    // Dismiss any open keyboard BEFORE showing the sheet (e.g. if a search
    // field elsewhere had focus), so it doesn't cover the sheet.
    FocusScope.of(context).unfocus();
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      // Let the user dismiss by tapping the scrim or dragging down —
      // critical for getting back to the feed cleanly.
      isDismissible: true,
      enableDrag: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const _ReelUploadSheet(),
    ).whenComplete(() {
      // Always drop the keyboard when the sheet closes, whatever dismissed
      // it — otherwise it stays up over the reels feed and hides the nav.
      FocusManager.instance.primaryFocus?.unfocus();
    });
  }
}

class _ReelUploadSheet extends ConsumerStatefulWidget {
  const _ReelUploadSheet();

  @override
  ConsumerState<_ReelUploadSheet> createState() => _ReelUploadSheetState();
}

class _ReelUploadSheetState extends ConsumerState<_ReelUploadSheet> {
  final _captionController = TextEditingController();
  XFile? _video;
  VideoPlayerController? _probeController;
  bool _uploading = false;
  double? _durationSec;

  @override
  void dispose() {
    _captionController.dispose();
    _probeController?.dispose();
    super.dispose();
  }

  Future<void> _pickVideo() async {
    final picker = ImagePicker();
    final file = await picker.pickVideo(source: ImageSource.gallery);
    if (file == null) return;
    // Probe duration + validity with a throwaway controller.
    try {
      final controller = VideoPlayerController.networkUrl(
        Uri.parse('file://${file.path}'),
      );
      await controller.initialize();
      _durationSec = controller.value.duration.inMilliseconds / 1000.0;
      _probeController = controller;
    } catch (_) {
      _durationSec = null;
    }
    setState(() => _video = file);
  }

  bool get _canPublish => _video != null && !_uploading;

  Future<void> _publish() async {
    if (!_canPublish) return;
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to post reels');
      return;
    }
    HapticFeedback.mediumImpact();
    setState(() => _uploading = true);
    try {
      // 1. Upload the video bytes via Blossom.
      final bytes = await _video!.readAsBytes();
      final name = _video!.name;
      final ext = name.split('.').last.toLowerCase();
      final mime = switch (ext) {
        'mp4' => 'video/mp4',
        'mov' => 'video/quicktime',
        'webm' => 'video/webm',
        _ => 'video/mp4',
      };
      final url = await ref.read(uploadProvider.notifier).uploadBytes(
            bytes,
            filename: name,
            mimeType: mime,
          );

      // 2. Publish the kind-22 NIP-71 event with imeta metadata.
      final nostr = ref.read(nostrServiceProvider);
      final caption = _captionController.text.trim();
      // b.nostr.build serves a free poster frame at ?poster; for other hosts
      // the tag is simply omitted by clients that don't generate one.
      final posterUrl = url.contains('nostr.build') ? '$url?poster' : null;
      final event = nostr.createVideoEvent(
        url: url,
        mimeType: mime,
        caption: caption,
        posterUrl: posterUrl,
        durationSec: _durationSec,
        hashtags: _hashtags(caption).map((t) => t[1]).toList(),
      );
      await nostr.publishEvent(event);

      // Refresh the reels feed so it appears immediately.
      ref.invalidate(videosProvider);
      final pk = auth.pubkey;
      if (pk != null) ref.invalidate(userPostsProvider(pk));

      if (mounted) {
        Navigator.pop(context);
        AppToast.success(context, 'Reel published');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  List<List<String>> _hashtags(String text) {
    final seen = <String>{};
    final tags = <List<String>>[];
    for (final m in RegExp(r'#(\w+)').allMatches(text)) {
      final tag = m.group(1)!.toLowerCase();
      if (seen.add(tag)) tags.add(['t', tag]);
    }
    return tags;
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        top: false,
        // Scrollable when the keyboard shrinks the available height —
        // prevents the RenderFlex overflow (video preview + caption +
        // publish button exceeded the sheet height).
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            // Handle + header
            Center(
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 8, 12),
              child: Row(
                children: [
                  Icon(Icons.video_call_rounded, color: colorScheme.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'New Reel',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                  ),
                  // Close button — dismisses keyboard + sheet cleanly.
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    tooltip: 'Close',
                    onPressed: () {
                      FocusScope.of(context).unfocus();
                      Navigator.pop(context);
                    },
                  ),
                ],
              ),
            ),

            // Video picker / preview
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: _video == null
                  ? InkWell(
                      onTap: _pickVideo,
                      borderRadius: BorderRadius.circular(14),
                      child: Container(
                        height: 180,
                        decoration: BoxDecoration(
                          color: colorScheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: colorScheme.outlineVariant,
                            style: BorderStyle.solid,
                          ),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.video_library_outlined,
                              size: 44,
                              color: colorScheme.primary,
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Choose a video',
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                color: colorScheme.primary,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'mp4 · mov · webm — portrait works best',
                              style: TextStyle(
                                fontSize: 12,
                                color: colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  : Container(
                      height: 180,
                      decoration: BoxDecoration(
                        color: Colors.black87,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Stack(
                        children: [
                          const Center(
                            child: Icon(
                              Icons.play_circle_outline_rounded,
                              color: Colors.white70,
                              size: 48,
                            ),
                          ),
                          Positioned(
                            left: 10,
                            bottom: 10,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.black54,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                _durationSec != null
                                    ? '${_video!.name} · ${_durationSec!.toStringAsFixed(0)}s'
                                    : _video!.name,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                          Positioned(
                            top: 6,
                            right: 6,
                            child: IconButton(
                              icon: const Icon(
                                Icons.close_rounded,
                                color: Colors.white,
                                size: 20,
                              ),
                              onPressed: () {
                                _probeController?.dispose();
                                setState(() {
                                  _video = null;
                                  _durationSec = null;
                                });
                              },
                            ),
                          ),
                        ],
                      ),
                    ),
            ),
            const SizedBox(height: 14),

            // Caption
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: TextField(
                controller: _captionController,
                maxLines: 3,
                maxLength: 280,
                decoration: InputDecoration(
                  hintText: 'Write a caption… #hashtags work',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  contentPadding: const EdgeInsets.all(14),
                ),
              ),
            ),
            const SizedBox(height: 4),

            // Publish
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
              child: FilledButton.icon(
                onPressed: _canPublish ? _publish : null,
                icon: _uploading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.publish_rounded),
                label: Text(_uploading ? 'Publishing…' : 'Publish reel'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
            ],
          ),
        ),
      ),
    );
  }
}
