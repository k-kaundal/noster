import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/utils/media.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:url_launcher/url_launcher.dart';

/// Video handling for note content:
///
///  - Direct video files (mp4/webm/mov…): thumbnail-style tile with a play
///    button that opens the in-app reel-style player.
///  - Known video hosts (YouTube, Vimeo, Rumble, TikTok…): rich link card
///    with platform branding that opens externally.
///  - Portrait/short videos (kind 21/22, NIP-71): deep-link into the Reels tab.
class VideoCard extends StatelessWidget {
  final String url;
  final ImetaInfo? imeta;

  const VideoCard({super.key, required this.url, this.imeta});

  static final _hostBranding = <RegExp, (String, IconData, Color)>{
    RegExp(r'youtube\.com|youtu\.be'): (
      'YouTube',
      Icons.play_circle_fill_rounded,
      const Color(0xFFFF0000),
    ),
    RegExp(r'vimeo\.com'): (
      'Vimeo',
      Icons.play_circle_fill_rounded,
      const Color(0xFF1AB7EA),
    ),
    RegExp(r'rumble\.com'): (
      'Rumble',
      Icons.play_circle_fill_rounded,
      const Color(0xFF85C742),
    ),
    RegExp(r'tiktok\.com'): (
      'TikTok',
      Icons.music_note_rounded,
      const Color(0xFF000000),
    ),
    RegExp(r'twitch\.tv'): (
      'Twitch',
      Icons.videogame_asset_rounded,
      const Color(0xFF9146FF),
    ),
    RegExp(r'odysee\.com'): (
      'Odysee',
      Icons.play_circle_fill_rounded,
      const Color(0xFFEF1970),
    ),
  };

  @override
  Widget build(BuildContext context) {
    for (final entry in _hostBranding.entries) {
      if (entry.key.hasMatch(url)) {
        final (name, icon, color) = entry.value;
        return _PlatformVideoLink(
          url: url,
          platform: name,
          icon: icon,
          color: color,
        );
      }
    }
    return _DirectVideoTile(url: url, imeta: imeta);
  }
}

/// YouTube/Vimeo/etc. — branded external link card.
class _PlatformVideoLink extends StatelessWidget {
  final String url;
  final String platform;
  final IconData icon;
  final Color color;

  const _PlatformVideoLink({
    required this.url,
    required this.platform,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => launchUrl(Uri.parse(url),
            mode: LaunchMode.externalApplication),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Watch on $platform',
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      url,
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
                Icons.open_in_new_rounded,
                size: 16,
                color: colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Direct video file — tap to play in-app.
class _DirectVideoTile extends StatelessWidget {
  final String url;
  final ImetaInfo? imeta;

  const _DirectVideoTile({required this.url, this.imeta});

  @override
  Widget build(BuildContext context) {
    final thumb = imeta?.fallbackUrls.isNotEmpty == true
        ? imeta!.fallbackUrls.first
        : null;

    return Container(
      margin: const EdgeInsets.only(top: 8),
      height: 200,
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(12),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/reels', extra: {'videoUrl': url}),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (thumb != null)
              CachedNetworkImage(
                httpHeaders: kImageHttpHeaders,
                imageUrl: thumb,
                fit: BoxFit.cover,
                errorWidget: (_, _, _) => const SizedBox.shrink(),
              ),
            Center(
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: const BoxDecoration(
                  color: Colors.black45,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.play_arrow_rounded,
                  color: Colors.white,
                  size: 36,
                ),
              ),
            ),
            Positioned(
              left: 10,
              bottom: 10,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    AppIcon('video',
                        color: Colors.white, size: 13),
                    SizedBox(width: 4),
                    Text(
                      'Video',
                      style: TextStyle(color: Colors.white, fontSize: 11),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
