/// A single DM conversation with a peer (list-view model).
class ConversationItem {
  final String peerPubkey;

  /// The most recent raw event (used only as a stable reference).
  final dynamic lastMessage;

  /// Decrypted preview text of the last message, when available.
  final String? lastText;

  /// Timestamp (unix seconds) of the last message.
  final int lastTimestamp;

  final int unreadCount;

  const ConversationItem({
    required this.peerPubkey,
    this.lastMessage,
    this.lastText,
    required this.lastTimestamp,
    this.unreadCount = 0,
  });
}
