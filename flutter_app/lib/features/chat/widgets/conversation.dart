import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// A single DM conversation with a peer.
class Conversation {
  final String peerPubkey;
  final NostrProfile? profile;
  final NostrEvent? lastMessage;
  final int unreadCount;
  const Conversation({
    required this.peerPubkey,
    this.profile,
    this.lastMessage,
    this.unreadCount = 0,
  });
}
