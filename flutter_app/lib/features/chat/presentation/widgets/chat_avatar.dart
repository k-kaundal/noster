import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

class ChatAvatar extends StatelessWidget {
  final String? imageUrl;
  final String name;
  final double radius;

  const ChatAvatar({super.key, this.imageUrl, required this.name, this.radius = 28});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final url = imageUrl;

    if (url != null && url.isNotEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundImage: CachedNetworkImageProvider(url),
        onBackgroundImageError: (_, _) {},
        backgroundColor: colorScheme.surfaceContainerHighest,
      );
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: colorScheme.primaryContainer,
      child: Text(
        firstGrapheme(name),
        style: TextStyle(
          color: colorScheme.onPrimaryContainer,
          fontWeight: FontWeight.w600,
          fontSize: radius * 0.7,
        ),
      ),
    );
  }
}
