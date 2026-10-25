import 'dart:convert';
import 'dart:typed_data';

import 'package:chewie/chewie.dart';
import 'package:flutter/material.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_media_service.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:photo_view/photo_view.dart';
import 'package:video_player/video_player.dart';

/// Renders AI-generated media (images + videos) with download options.
///
/// Image-gen models return either `data:` URLs (Gemini returns base64
/// inline — `Image.network` CANNOT render those, which was the "image
/// could not be loaded" bug) or hosted `https:` URLs; both decode here.
/// Every media gets Save-to-gallery + Share actions — the download option
/// generated content was missing.
class AiGeneratedImage extends StatelessWidget {
  final String urlOrDataUrl;

  const AiGeneratedImage({super.key, required this.urlOrDataUrl});

  bool get _isDataUrl => urlOrDataUrl.startsWith('data:');

  @override
  Widget build(BuildContext context) {
    final image = _isDataUrl
        ? Image.memory(
            _decodeDataUrl(urlOrDataUrl),
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) =>
                const _MediaError('Image could not be decoded'),
          )
        : Image.network(
            urlOrDataUrl,
            fit: BoxFit.contain,
            loadingBuilder: (context, child, progress) => progress == null
                ? child
                : const SizedBox(
                    height: 120,
                    child: Center(child: CircularProgressIndicator()),
                  ),
            errorBuilder: (_, _, _) =>
                const _MediaError('Image could not be loaded'),
          );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: () => _openFullscreen(context),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 320),
              child: image,
            ),
          ),
        ),
        _MediaActions(urlOrDataUrl: urlOrDataUrl, isVideo: false),
      ],
    );
  }

  static Uint8List _decodeDataUrl(String dataUrl) {
    final comma = dataUrl.indexOf(',');
    return base64Decode(dataUrl.substring(comma + 1));
  }

  void _openFullscreen(BuildContext context) {
    Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute(
        builder: (_) => _AiImageViewer(urlOrDataUrl: urlOrDataUrl),
      ),
    );
  }
}

/// Fullscreen pinch-to-zoom viewer with Save / Share in the app bar.
class _AiImageViewer extends StatelessWidget {
  final String urlOrDataUrl;

  const _AiImageViewer({required this.urlOrDataUrl});

  @override
  Widget build(BuildContext context) {
    final isData = urlOrDataUrl.startsWith('data:');
    final provider = isData
        ? MemoryImage(
            base64Decode(urlOrDataUrl.substring(urlOrDataUrl.indexOf(',') + 1)),
          )
        : NetworkImage(urlOrDataUrl) as ImageProvider;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Generated image'),
        actions: [
          IconButton(
            icon: const AppIcon('download'),
            tooltip: 'Save to gallery',
            onPressed: () => _save(context),
          ),
          IconButton(
            icon: const AppIcon('share'),
            tooltip: 'Share',
            onPressed: () => _share(context),
          ),
        ],
      ),
      body: PhotoView(
        imageProvider: provider,
        minScale: PhotoViewComputedScale.contained,
        maxScale: PhotoViewComputedScale.covered * 4,
        heroAttributes: const PhotoViewHeroAttributes(tag: 'ai-image'),
      ),
    );
  }

  Future<void> _save(BuildContext context) async {
    try {
      await AiMediaService.saveToGallery(urlOrDataUrl, isVideo: false);
      if (context.mounted) AppToast.success(context, 'Saved to gallery');
    } catch (e) {
      if (context.mounted) AppToast.error(context, 'Could not save: $e');
    }
  }

  Future<void> _share(BuildContext context) async {
    try {
      await AiMediaService.share(urlOrDataUrl, isVideo: false);
    } catch (e) {
      if (context.mounted) AppToast.error(context, 'Could not share: $e');
    }
  }
}

/// Action row under generated media: Save (download to gallery) + Share.
class _MediaActions extends StatefulWidget {
  final String urlOrDataUrl;
  final bool isVideo;

  const _MediaActions({required this.urlOrDataUrl, required this.isVideo});

  @override
  State<_MediaActions> createState() => _MediaActionsState();
}

class _MediaActionsState extends State<_MediaActions> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) AppToast.success(context, done);
    } catch (e) {
      if (mounted) AppToast.error(context, '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _action(
            scheme,
            icon: Icons.download_rounded,
            label: 'Save',
            onTap: () => _run(
              () => AiMediaService.saveToGallery(
                widget.urlOrDataUrl,
                isVideo: widget.isVideo,
              ),
              widget.isVideo ? 'Video saved to gallery' : 'Saved to gallery',
            ),
          ),
          const SizedBox(width: 14),
          _action(
            scheme,
            icon: Icons.share_rounded,
            label: 'Share',
            onTap: () => _run(
              () => AiMediaService.share(
                widget.urlOrDataUrl,
                isVideo: widget.isVideo,
              ),
              'Shared',
            ),
          ),
          if (_busy) ...[
            const SizedBox(width: 10),
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ],
        ],
      ),
    );
  }

  Widget _action(
    ColorScheme scheme, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: _busy ? null : onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: scheme.primary),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: scheme.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Renders a generated video with an in-app player + Save / Share actions.
class AiGeneratedVideo extends StatefulWidget {
  final String url;

  const AiGeneratedVideo({super.key, required this.url});

  @override
  State<AiGeneratedVideo> createState() => _AiGeneratedVideoState();
}

class _AiGeneratedVideoState extends State<AiGeneratedVideo> {
  late final VideoPlayerController _controller;
  ChewieController? _chewie;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller
        .initialize()
        .then((_) {
          if (!mounted) return;
          setState(() {
            _chewie = ChewieController(
              videoPlayerController: _controller,
              autoPlay: false,
              looping: false,
            );
          });
        })
        .catchError((_) {});
  }

  @override
  void dispose() {
    _chewie?.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chewie = _chewie;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: AspectRatio(
            aspectRatio: _controller.value.isInitialized
                ? _controller.value.aspectRatio
                : 16 / 9,
            child: chewie != null
                ? Chewie(controller: chewie)
                : Container(
                    color: Colors.black12,
                    child: const Center(child: CircularProgressIndicator()),
                  ),
          ),
        ),
        _MediaActions(urlOrDataUrl: widget.url, isVideo: true),
      ],
    );
  }
}

class _MediaError extends StatelessWidget {
  final String message;
  const _MediaError(this.message);

  @override
  Widget build(BuildContext context) {
    return SizedBox(height: 60, child: Center(child: Text(message)));
  }
}
