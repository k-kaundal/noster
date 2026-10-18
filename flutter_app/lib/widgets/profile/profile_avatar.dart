import 'package:flutter/material.dart';

import '../../models/nostr_models.dart';
import '../common/smart_network_image.dart';

/// Reusable avatar widget that displays a user's profile picture
/// with a fallback to the first letter of their name.
class ProfileAvatar extends StatelessWidget {
  final NostrProfile? profile;
  final String? pubkey;
  final double radius;
  final bool showRing;
  final Color? ringColor;
  final double ringWidth;

  const ProfileAvatar({
    super.key,
    this.profile,
    this.pubkey,
    this.radius = 24,
    this.showRing = false,
    this.ringColor,
    this.ringWidth = 2.0,
  });

  String get _fallbackLetter {
    final name = profile?.displayNameOrName;
    if (name != null && name.isNotEmpty) {
      return name[0].toUpperCase();
    }
    if (pubkey != null && pubkey!.isNotEmpty) {
      return pubkey![0].toUpperCase();
    }
    return '?';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final effectiveRingColor = ringColor ?? scheme.primary;
    final imageUrl = profile?.picture;

    Widget avatar = CircleAvatar(
      radius: radius,
      backgroundColor: scheme.primaryContainer,
      child: imageUrl != null && imageUrl.isNotEmpty
          ? ClipOval(
              child: SmartNetworkImage(
                url: imageUrl,
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                placeholder: (context, url) => _FallbackLetter(
                  letter: _fallbackLetter,
                  radius: radius,
                ),
                errorWidget: (context, url, error) => _FallbackLetter(
                  letter: _fallbackLetter,
                  radius: radius,
                ),
              ),
            )
          : _FallbackLetter(letter: _fallbackLetter, radius: radius),
    );

    if (showRing) {
      avatar = Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: effectiveRingColor, width: ringWidth),
        ),
        child: avatar,
      );
    }

    return avatar;
  }
}

class _FallbackLetter extends StatelessWidget {
  final String letter;
  final double radius;

  const _FallbackLetter({required this.letter, required this.radius});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Text(
        letter,
        style: TextStyle(
          color: scheme.onPrimaryContainer,
          fontSize: radius * 0.7,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}
