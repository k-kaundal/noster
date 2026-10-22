import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// NIP-29 group metadata (kind 39000).
class GroupInfo {
  final String id; // event id
  final String groupId; // d tag
  final String name;
  final String about;
  final String? picture;
  final bool isOpen; // open = anyone can join; closed = invite only
  final bool isPublic; // public = readable by non-members
  final String relayPubkey; // author (relay master key)
  final int createdAt;

  const GroupInfo({
    required this.id,
    required this.groupId,
    required this.name,
    this.about = '',
    this.picture,
    this.isOpen = true,
    this.isPublic = true,
    required this.relayPubkey,
    required this.createdAt,
  });

  factory GroupInfo.fromEvent(NostrEvent event) {
    // NIP-29 flags: 'open'/'closed' (join policy), 'public'/'private' (read).
    final open = event.getTag('open') != null;
    final closed = event.getTag('closed') != null;
    final public = event.getTag('public') != null;
    final private = event.getTag('private') != null;
    return GroupInfo(
      id: event.id,
      groupId: event.getTag('d') ?? '',
      name: sanitizeText(event.getTag('name')).isEmpty
          ? 'Unnamed Group'
          : sanitizeText(event.getTag('name')),
      about: sanitizeText(event.getTag('about')),
      picture: event.getTag('picture'),
      isOpen: closed ? false : (open || !closed),
      isPublic: private ? false : (public || !private),
      relayPubkey: event.pubkey,
      createdAt: event.createdAt,
    );
  }
}

/// A group admin/moderator entry (from kind 39001 p tags).
class GroupAdmin {
  final String pubkey;
  final List<String> roles;
  const GroupAdmin({required this.pubkey, this.roles = const []});
}

/// Group membership state for the current user.
enum GroupMembership { member, notMember, pending, unknown }
