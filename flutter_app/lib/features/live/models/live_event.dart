import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// NIP-53 live activity status.
enum LiveStatus { planned, live, ended }

/// A NIP-53 live streaming event (kind 30311, addressable).
class LiveEvent {
  final String id;
  final String dTag;
  final String title;
  final String summary;
  final String? image;
  final String? streamingUrl;
  final String? recordingUrl;
  final LiveStatus status;
  final int? starts;
  final int? ends;
  final int? currentParticipants;
  final int? totalParticipants;
  final String hostPubkey; // event author
  final List<LiveParticipant> participants;
  final List<String> hashtags;
  final int updatedAt; // event.createdAt (for stale-live detection)

  const LiveEvent({
    required this.id,
    required this.dTag,
    required this.title,
    this.summary = '',
    this.image,
    this.streamingUrl,
    this.recordingUrl,
    this.status = LiveStatus.planned,
    this.starts,
    this.ends,
    this.currentParticipants,
    this.totalParticipants,
    required this.hostPubkey,
    this.participants = const [],
    this.hashtags = const [],
    required this.updatedAt,
  });

  factory LiveEvent.fromEvent(NostrEvent event) {
    // p tags: [pubkey, relay?, role?, proof?] — role is the 3rd element.
    final participants = <LiveParticipant>[];
    for (final tag in event.tags) {
      if (tag.isNotEmpty && tag[0] == 'p' && tag.length > 1) {
        participants.add(LiveParticipant(
          pubkey: tag[1],
          relay: tag.length > 2 ? tag[2] : null,
          role: tag.length > 3 ? sanitizeText(tag[3]) : null,
        ));
      }
    }
    LiveStatus status;
    switch (event.getTag('status')) {
      case 'live':
        status = LiveStatus.live;
      case 'ended':
        status = LiveStatus.ended;
      default:
        status = LiveStatus.planned;
    }
    // NIP-53: status=live events with no update for 1hr are considered ended.
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (status == LiveStatus.live && now - event.createdAt > 3600) {
      status = LiveStatus.ended;
    }
    return LiveEvent(
      id: event.id,
      dTag: event.getTag('d') ?? '',
      title: sanitizeText(event.getTag('title')).isEmpty
          ? 'Live Stream'
          : sanitizeText(event.getTag('title')),
      summary: sanitizeText(event.getTag('summary')),
      image: event.getTag('image'),
      streamingUrl: event.getTag('streaming') ?? event.getTag('url'),
      recordingUrl: event.getTag('recording'),
      status: status,
      starts: int.tryParse(event.getTag('starts') ?? ''),
      ends: int.tryParse(event.getTag('ends') ?? ''),
      currentParticipants: int.tryParse(event.getTag('current_participants') ?? ''),
      totalParticipants: int.tryParse(event.getTag('total_participants') ?? ''),
      hostPubkey: event.pubkey,
      participants: participants,
      hashtags: event.hashtags,
      updatedAt: event.createdAt,
    );
  }

  /// The addressable coordinate: kind:pubkey:d
  String get coordinate => '30311:$hostPubkey:$dTag';

  bool get isLive => status == LiveStatus.live;
  bool get isEnded => status == LiveStatus.ended;
  bool get isPlanned => status == LiveStatus.planned;
}

class LiveParticipant {
  final String pubkey;
  final String? relay;
  final String? role; // 'Host', 'Speaker', 'Participant'
  const LiveParticipant({required this.pubkey, this.relay, this.role});
}
