/// ADR-0008 — the canonical LOCAL data model.
///
/// These records are the **storage contract** between the SQLite layer and
/// the app. Every feature reads/writes through ONE of these typed records —
/// never a raw `Map<String, Object?>` row, never a relay wire object leaked
/// into the UI. This is the "proper data model" the store is built around:
///
///  - **Wire type** (`NostrEvent`, in `core/models/nostr_models.dart`) — the
///    UNTRUSTED relay object, signature-verified at the boundary (L2). It is
///    an input to ingestion, never a storage/screen type.
///  - **Storage records** (this file) — immutable, typed, one per table.
///    `_fromRow` / `toRow` are the ONLY places row maps are interpreted, so a
///    schema change touches exactly one method, not every feature.
///  - **Enums** — stored as small ints with named Dart enums (no magic
///    numbers in SQL or features).
///
/// Tables WITHOUT a record here (events, event_refs, tags, thread_edges,
/// seen_on, deletions) are internal projections of the wire type — their
/// "model" IS `NostrEvent` + the query methods, by design (ADR-0005).
library;

// ─── Messaging (kinds 4 / 1059 → decrypted local rows) ─────────────────────

/// Who sent a DM. Stored as an int in SQL.
enum DbDmDirection {
  incoming(0),
  outgoing(1);

  const DbDmDirection(this.v);
  final int v;
  static DbDmDirection from(int v) => v == 1 ? outgoing : incoming;
}

/// Delivery state of an OUTGOING DM. Stored as an int in SQL.
enum DbMessageStatus {
  pending(0),
  sent(1),
  failed(2);

  const DbMessageStatus(this.v);
  final int v;
  static DbMessageStatus from(int v) => switch (v) {
        1 => sent,
        2 => failed,
        _ => pending,
      };
}

/// One chat message, stored DECRYPTED (device-only, like Signal's local DB).
///
/// We can NOT store the NIP-17 gift-wrap itself decryptably (the sender
/// can't re-decrypt their own wrap), so the plaintext IS the stored form.
/// The raw wrap/kind-4 event id is kept in [rawId] only as a fetch
/// reference (thread backfill, dedup) — the ciphertext is never persisted.
final class DbMessage {
  final String id; // rumor id (NIP-17) / event id (NIP-04)
  final String peer; // the other party's pubkey
  final DbDmDirection direction;
  final String content; // DECRYPTED plaintext (or file URL for kind-15)
  final int createdAt; // rumor timestamp (display order)
  final String? rawId; // the gift-wrap / kind-4 event id
  final int wrapKind; // 4 or 1059
  final int rumorKind; // 14 chat / 15 file / 7 reaction
  final DbMessageStatus status; // outgoing only
  final String? replyTo;
  final String? subject; // NIP-17 room name
  final String? mimeType; // kind-15 file messages
  final String? blurhash;

  const DbMessage({
    required this.id,
    required this.peer,
    required this.direction,
    required this.content,
    required this.createdAt,
    this.rawId,
    this.wrapKind = 1059,
    this.rumorKind = 14,
    this.status = DbMessageStatus.sent,
    this.replyTo,
    this.subject,
    this.mimeType,
    this.blurhash,
  });

  bool get isFile => rumorKind == 15;
  bool get isImage => isFile && (mimeType?.startsWith('image/') ?? true);

  static DbMessage fromRow(Map<String, Object?> r) => DbMessage(
        id: r['id'] as String,
        peer: r['peer'] as String,
        direction: DbDmDirection.from(r['direction'] as int),
        content: r['content'] as String,
        createdAt: r['created_at'] as int,
        rawId: r['raw_id'] as String?,
        wrapKind: r['wrap_kind'] as int,
        rumorKind: r['rumor_kind'] as int,
        status: DbMessageStatus.from(r['status'] as int),
        replyTo: r['reply_to'] as String?,
        subject: r['subject'] as String?,
        mimeType: r['mime_type'] as String?,
        blurhash: r['blurhash'] as String?,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'peer': peer,
        'direction': direction.v,
        'content': content,
        'created_at': createdAt,
        'raw_id': rawId,
        'wrap_kind': wrapKind,
        'rumor_kind': rumorKind,
        'status': status.v,
        'reply_to': replyTo,
        'subject': subject,
        'mime_type': mimeType,
        'blurhash': blurhash,
      };
}

/// One conversation (per peer) — the chat-list row. Replaces the
/// SharedPreferences `dm_last_read_v1` watermark map.
final class DbThread {
  final String peer;
  final int lastMsgAt;
  final int lastReadAt; // watermark; unread = messages after this
  final int unreadCount;

  const DbThread({
    required this.peer,
    required this.lastMsgAt,
    this.lastReadAt = 0,
    this.unreadCount = 0,
  });

  static DbThread fromRow(Map<String, Object?> r) => DbThread(
        peer: r['peer'] as String,
        lastMsgAt: r['last_msg_at'] as int,
        lastReadAt: r['last_read_at'] as int,
        unreadCount: r['unread_count'] as int,
      );

  Map<String, Object?> toRow() => {
        'peer': peer,
        'last_msg_at': lastMsgAt,
        'last_read_at': lastReadAt,
        'unread_count': unreadCount,
      };
}

/// Durable outbox entry for an outgoing DM that hasn't been acked yet.
/// Replaces the SharedPreferences `dm_outbox_v1` JSON blob — a failed send
/// now survives restart and retries via background sync.
final class DbOutboxMessage {
  final String id;
  final String peer;
  final String payloadJson; // the signed wraps (recipient + self) as JSON
  final int createdAt;
  final DbMessageStatus state;
  final int attempts;

  const DbOutboxMessage({
    required this.id,
    required this.peer,
    required this.payloadJson,
    required this.createdAt,
    this.state = DbMessageStatus.pending,
    this.attempts = 0,
  });

  static DbOutboxMessage fromRow(Map<String, Object?> r) => DbOutboxMessage(
        id: r['id'] as String,
        peer: r['peer'] as String,
        payloadJson: r['payload'] as String,
        createdAt: r['created_at'] as int,
        state: DbMessageStatus.from(r['state'] as int),
        attempts: r['attempts'] as int,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'peer': peer,
        'payload': payloadJson,
        'created_at': createdAt,
        'state': state.v,
        'attempts': attempts,
      };
}

// ─── Notifications ─────────────────────────────────────────────────────────

/// What kind of social event triggered a notification. Stored as an int.
enum DbNotificationType {
  like(0),
  repost(1),
  reply(2),
  mention(3),
  follow(4),
  zap(5),
  dm(6);

  const DbNotificationType(this.v);
  final int v;
  static DbNotificationType from(int v) =>
      (v >= 0 && v < values.length) ? values[v] : mention;
}

/// One notification — the bell-screen row. Persisted (was a 200-entry
/// memory list, empty on cold start). Unread = `readAt == null`, indexed by
/// a partial index so the badge count is an instant COUNT.
final class DbNotification {
  final String id; // the triggering event id
  final String recipient; // me (multi-account ready)
  final DbNotificationType type;
  final String actor; // who did it
  final String? targetId; // the post/event acted on
  final String eventJson; // full event for rendering
  final int createdAt;
  final int? readAt;

  const DbNotification({
    required this.id,
    required this.recipient,
    required this.type,
    required this.actor,
    this.targetId,
    required this.eventJson,
    required this.createdAt,
    this.readAt,
  });

  bool get isUnread => readAt == null;

  static DbNotification fromRow(Map<String, Object?> r) => DbNotification(
        id: r['id'] as String,
        recipient: r['recipient'] as String,
        type: DbNotificationType.from(r['type'] as int),
        actor: r['actor'] as String,
        targetId: r['target_id'] as String?,
        eventJson: r['event_json'] as String,
        createdAt: r['created_at'] as int,
        readAt: r['read_at'] as int?,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'recipient': recipient,
        'type': type.v,
        'actor': actor,
        'target_id': targetId,
        'event_json': eventJson,
        'created_at': createdAt,
        'read_at': readAt,
      };
}

// ─── Publish outbox (all event kinds) ──────────────────────────────────────

/// Delivery state of a published event. Stored as an int.
enum DbPublishState {
  pending(0),
  sent(1),
  failed(2);

  const DbPublishState(this.v);
  final int v;
  static DbPublishState from(int v) => switch (v) {
        1 => sent,
        2 => failed,
        _ => pending,
      };
}

/// A durable publish-retry entry — any event kind (post/reply/DM/zap…).
/// A publish that fails (offline, dead socket) is retried by background
/// sync instead of being silently lost. Replaces ad-hoc per-feature retry.
final class DbPublishJob {
  final String id; // event id
  final String eventJson;
  final List<String> targets; // relay urls incl. NIP-65 outbox hints
  final int createdAt;
  final DbPublishState state;
  final int attempts;
  final String? lastError;

  const DbPublishJob({
    required this.id,
    required this.eventJson,
    required this.targets,
    required this.createdAt,
    this.state = DbPublishState.pending,
    this.attempts = 0,
    this.lastError,
  });

  static DbPublishJob fromRow(Map<String, Object?> r) => DbPublishJob(
        id: r['id'] as String,
        eventJson: r['event_json'] as String,
        targets: [
          for (final t in (r['targets'] as String).split(','))
            if (t.isNotEmpty) t,
        ],
        createdAt: r['created_at'] as int,
        state: DbPublishState.from(r['state'] as int),
        attempts: r['attempts'] as int,
        lastError: r['last_error'] as String?,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'event_json': eventJson,
        'targets': targets.join(','),
        'created_at': createdAt,
        'state': state.v,
        'attempts': attempts,
        'last_error': lastError,
      };
}

// ─── Media metadata ────────────────────────────────────────────────────────

enum DbMediaKind {
  image(0),
  video(1),
  audio(2),
  other(3);

  const DbMediaKind(this.v);
  final int v;
  static DbMediaKind from(int v) =>
      (v >= 0 && v < values.length) ? values[v] : other;
}

enum DbUploadState {
  local(0),
  uploading(1),
  uploaded(2),
  failed(3);

  const DbUploadState(this.v);
  final int v;
  static DbUploadState from(int v) =>
      (v >= 0 && v < values.length) ? values[v] : local;
}

/// One media attachment's metadata (was re-parsed per render + memoized in
/// RAM only). Dimensions + blurhash let the feed lay out a tile before the
/// bytes download (no layout jump), and `localPath` points at the on-disk
/// cache for offline display.
final class DbMedia {
  final String url;
  final String? eventId;
  final DbMediaKind kind;
  final int? width;
  final int? height;
  final String? blurhash;
  final String? mime;
  final String? localPath;
  final DbUploadState uploadState;

  const DbMedia({
    required this.url,
    this.eventId,
    this.kind = DbMediaKind.other,
    this.width,
    this.height,
    this.blurhash,
    this.mime,
    this.localPath,
    this.uploadState = DbUploadState.local,
  });

  static DbMedia fromRow(Map<String, Object?> r) => DbMedia(
        url: r['url'] as String,
        eventId: r['event_id'] as String?,
        kind: DbMediaKind.from(r['kind'] as int),
        width: r['width'] as int?,
        height: r['height'] as int?,
        blurhash: r['blurhash'] as String?,
        mime: r['mime'] as String?,
        localPath: r['local_path'] as String?,
        uploadState: DbUploadState.from(r['upload_state'] as int),
      );

  Map<String, Object?> toRow() => {
        'url': url,
        'event_id': eventId,
        'kind': kind.v,
        'width': width,
        'height': height,
        'blurhash': blurhash,
        'mime': mime,
        'local_path': localPath,
        'upload_state': uploadState.v,
      };
}

// ─── Relay fleet ───────────────────────────────────────────────────────────

/// The trust/routing tier of a relay (ADR-0008 §3). Stored as an int.
enum DbRelayTier {
  platform(0), // relay.nostrfeed.com (own) + paid.nostrfeed.com
  user(1), // user's NIP-65 kind-10002 + managed list
  curated(2), // curated public set (damus, nos.lol, …)
  adhoc(3); // per-user outbox discovery (bounded pool)

  const DbRelayTier(this.v);
  final int v;
  static DbRelayTier from(int v) =>
      (v >= 0 && v < values.length) ? values[v] : curated;
}

/// Health record for one relay — drives connection priority + top-K query
/// fan-out. Score is an EWMA of connect success, EOSE latency, and
/// events/min delivered.
final class DbRelayHealth {
  final String url;
  final DbRelayTier tier;
  final double score;
  final int? lastEoseMs;
  final int eoseSamples;
  final int successCount;
  final int failureCount;
  final int updatedAt;

  const DbRelayHealth({
    required this.url,
    required this.tier,
    this.score = 0,
    this.lastEoseMs,
    this.eoseSamples = 0,
    this.successCount = 0,
    this.failureCount = 0,
    required this.updatedAt,
  });

  static DbRelayHealth fromRow(Map<String, Object?> r) => DbRelayHealth(
        url: r['url'] as String,
        tier: DbRelayTier.from(r['tier'] as int),
        score: (r['score'] as num).toDouble(),
        lastEoseMs: r['last_eose_ms'] as int?,
        eoseSamples: r['eose_samples'] as int,
        successCount: r['success_count'] as int,
        failureCount: r['failure_count'] as int,
        updatedAt: r['updated_at'] as int,
      );

  Map<String, Object?> toRow() => {
        'url': url,
        'tier': tier.v,
        'score': score,
        'last_eose_ms': lastEoseMs,
        'eose_samples': eoseSamples,
        'success_count': successCount,
        'failure_count': failureCount,
        'updated_at': updatedAt,
      };
}

// (DbDraft was removed: it had no `drafts` table and no consumer — orphaned
// record + schema drift by omission. Composer drafts are a future phase with
// their own table + record designed together.)
