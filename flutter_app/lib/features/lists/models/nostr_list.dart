import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// A NIP-51 follow set (kind 30000): a named, curated group of users.
///
/// Addressable (d tag identity), so creating a set with the same `d`
/// replaces the old version. Members are `p` tags; metadata is title/
/// description/image tags.
class NostrList {
  final String id; // event id
  final String dTag; // set identifier
  final String title;
  final String description;
  final String? image;
  final List<String> members; // pubkeys
  final int createdAt;
  final String authorPubkey;

  const NostrList({
    required this.id,
    required this.dTag,
    required this.title,
    this.description = '',
    this.image,
    this.members = const [],
    required this.createdAt,
    required this.authorPubkey,
  });

  factory NostrList.fromEvent(NostrEvent event) {
    return NostrList(
      id: event.id,
      dTag: event.getTag('d') ?? '',
      title: sanitizeText(
        event.getTag('title') ?? event.getTag('d') ?? 'Untitled list',
      ),
      description: sanitizeText(event.getTag('description')),
      image: event.getTag('image'),
      members: event.getTags('p'),
      createdAt: event.createdAt,
      authorPubkey: event.pubkey,
    );
  }

  /// The addressable coordinate: kind:pubkey:d
  String get coordinate => '30000:$authorPubkey:$dTag';

  /// Event tags for publishing (kind 30000).
  List<List<String>> toTags() => [
        ['d', dTag],
        ['title', title],
        if (description.isNotEmpty) ['description', description],
        if (image != null && image!.isNotEmpty) ['image', image!],
        for (final pk in members) ['p', pk],
      ];
}
