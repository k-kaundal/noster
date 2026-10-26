import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/store_host.dart';
import 'package:nostrfeed_mobile/core/providers/store_invalidation.dart'
    show StoreTable;
import 'package:sqflite/sqflite.dart';

/// ADR-0008 (God-object split) — the messaging store: `dm_messages`,
/// `dm_threads`, `dm_outbox` + DM full-text search.
///
/// Decrypted plaintext is stored DEVICE-ONLY (like Signal's local DB — the
/// NIP-17 wrap can't be re-decrypted by its sender). This domain has ZERO
/// interaction with the NIP-01 ingest lifecycle, which is why it's a
/// separate store sharing the core's database + writer lane via [StoreHost].
class MessageStore {
  MessageStore(this._host);
  final StoreHost _host;

  // ── Messages + conversation rows ──────────────────────────────────────

  /// Insert (or replace) a decrypted message + maintain its conversation row
  /// (`dm_threads.last_msg_at`, `unread_count`). One transaction on the
  /// writer lane. Incoming messages bump unread; `markDmThreadRead` resets it.
  Future<void> upsertDmMessage(DbMessage msg) => _host.enqueueWrite(
        () => _upsertDmMessageImpl(msg),
        touches: {StoreTable.dmMessages, StoreTable.dmThreads},
      );

  Future<void> _upsertDmMessageImpl(DbMessage msg) async {
    final database = await _host.db;
    await database.transaction((txn) async {
      txn.insert('dm_messages', msg.toRow(),
          conflictAlgorithm: ConflictAlgorithm.replace);
      final isIncoming = msg.direction == DbDmDirection.incoming;
      txn.rawInsert(
        '''
        INSERT INTO dm_threads (peer, last_msg_at, last_read_at, unread_count)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(peer) DO UPDATE SET
          last_msg_at = MAX(dm_threads.last_msg_at, excluded.last_msg_at),
          unread_count = dm_threads.unread_count + excluded.unread_count
        ''',
        [msg.peer, msg.createdAt, isIncoming ? 1 : 0],
      );
    });
  }

  /// Messages exchanged with [peer], newest first, keyset-paged with [until].
  Future<List<DbMessage>> dmMessagesFor(
    String peer, {
    int limit = 100,
    int? until,
  }) async {
    final database = await _host.db;
    final rows = await database.query(
      'dm_messages',
      where: until != null ? 'peer = ? AND created_at < ?' : 'peer = ?',
      whereArgs: until != null ? [peer, until] : [peer],
      orderBy: 'created_at DESC',
      limit: limit,
    );
    return rows.map(DbMessage.fromRow).toList();
  }

  /// A single message by id (dedup / status updates).
  Future<DbMessage?> dmMessageById(String id) async {
    final database = await _host.db;
    final rows = await database.query('dm_messages',
        where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : DbMessage.fromRow(rows.first);
  }

  /// All conversations, newest activity first (the chat-list projection).
  Future<List<DbThread>> dmThreads() async {
    final database = await _host.db;
    final rows =
        await database.query('dm_threads', orderBy: 'last_msg_at DESC');
    return rows.map(DbThread.fromRow).toList();
  }

  /// The last-read watermark for [peer] (0 = nothing read).
  Future<int> dmThreadLastRead(String peer) async {
    final database = await _host.db;
    final rows = await database.query('dm_threads',
        columns: ['last_read_at'],
        where: 'peer = ?',
        whereArgs: [peer],
        limit: 1);
    return rows.isEmpty ? 0 : (rows.first['last_read_at'] as int);
  }

  /// Total unread across all conversations (the chat tab badge COUNT).
  Future<int> dmTotalUnread() async {
    final database = await _host.db;
    final r = await database.rawQuery(
      'SELECT COALESCE(SUM(unread_count),0) AS n FROM dm_threads',
    );
    return (r.first['n'] as num).toInt();
  }

  /// Mark [peer]'s thread read: reset unread to 0 and advance the watermark
  /// to [watermark] (the newest message ts — NIP-17 backdates created_at).
  Future<void> markDmThreadRead(String peer, int watermark) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.rawInsert(
          '''
          INSERT INTO dm_threads (peer, last_msg_at, last_read_at, unread_count)
          VALUES (?, 0, ?, 0)
          ON CONFLICT(peer) DO UPDATE SET
            last_read_at = MAX(dm_threads.last_read_at, excluded.last_read_at),
            unread_count = 0
          ''',
          [peer, watermark],
        );
      }, touches: {StoreTable.dmThreads});

  /// Flip a message's delivery status (outgoing: pending → sent / failed).
  Future<void> updateDmMessageStatus(String id, DbMessageStatus status) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.update('dm_messages', {'status': status.v},
            where: 'id = ?', whereArgs: [id]);
      }, touches: {StoreTable.dmMessages});

  /// Delete the optimistic `local-{eventId}` pending row once the REAL event
  /// (self-copy wrap echo) lands — A4: each sent message used to leave an
  /// orphaned `local-` pending row forever.
  Future<void> deleteLocalPendingDm(String localId) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.delete('dm_messages',
            where: 'id = ? AND status = ?',
            whereArgs: [localId, DbMessageStatus.pending.v]);
      }, touches: {StoreTable.dmMessages});

  /// Recompute + persist a thread's unread count from the messages table.
  Future<void> recomputeDmUnread(String peer) => _host.enqueueWrite(() async {
        final database = await _host.db;
        final n = Sqflite.firstIntValue(await database.rawQuery(
              'SELECT COUNT(*) FROM dm_messages WHERE peer = ? '
              'AND direction = 0 AND created_at > '
              '(SELECT COALESCE((SELECT last_read_at FROM dm_threads WHERE peer = ?),0))',
              [peer, peer],
            )) ??
            0;
        await database.rawInsert(
          '''
          INSERT INTO dm_threads (peer, last_msg_at, last_read_at, unread_count)
          VALUES (?, 0, 0, ?)
          ON CONFLICT(peer) DO UPDATE SET unread_count = ?
          ''',
          [peer, n, n],
        );
      }, touches: {StoreTable.dmThreads});

  // ── Durable outbox ────────────────────────────────────────────────────

  /// Queue an outgoing message's signed wraps for delivery (pending).
  Future<void> enqueueDmOutbox(DbOutboxMessage entry) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.insert('dm_outbox', entry.toRow(),
            conflictAlgorithm: ConflictAlgorithm.replace);
      });

  /// All pending/failed outbox entries, oldest first (retry order).
  Future<List<DbOutboxMessage>> dmOutboxPending() async {
    final database = await _host.db;
    final rows = await database.query(
      'dm_outbox',
      where: 'state != ?',
      whereArgs: [DbMessageStatus.sent.v],
      orderBy: 'created_at ASC',
    );
    return rows.map(DbOutboxMessage.fromRow).toList();
  }

  /// Update an outbox entry's delivery state (+ bump attempts on retry).
  Future<void> updateDmOutboxState(
    String id,
    DbMessageStatus state, {
    bool bumpAttempts = false,
  }) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.rawUpdate(
          'UPDATE dm_outbox SET state = ?'
          '${bumpAttempts ? ', attempts = attempts + 1' : ''} '
          'WHERE id = ?',
          [state.v, id],
        );
      });

  /// Drop an outbox entry (acked and echoed, or user discarded).
  Future<void> removeDmOutbox(String id) => _host.enqueueWrite(() async {
        final database = await _host.db;
        await database
            .delete('dm_outbox', where: 'id = ?', whereArgs: [id]);
      });

  /// Wipe ALL messaging state (logout / account switch).
  Future<void> clearDmData() => _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.delete('dm_messages');
        await database.delete('dm_threads');
        await database.delete('dm_outbox');
      }, touches: {StoreTable.dmMessages, StoreTable.dmThreads});

  // ── DM full-text search ───────────────────────────────────────────────

  /// Full-text search over DECRYPTED DM content (the plaintext stored in
  /// `dm_messages`). Content LIKE probe (dm_messages is a real table, not an
  /// FTS table — the LIKE is narrowed by idx_dm_peer_time when a peer is
  /// given, a bounded scan of the capped table globally). Privacy: searches
  /// ONLY the local device copy (never a relay — Signal's trust boundary).
  Future<List<DbMessage>> searchDmMessages(
    String query, {
    String? peer,
    int limit = 50,
  }) async {
    final database = await _host.db;
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];

    final like = '%${trimmed.replaceAll('%', r'\%').replaceAll('_', r'\_')}%';
    final rows = await database.query(
      'dm_messages',
      where: peer != null
          ? "peer = ? AND content LIKE ? ESCAPE '\\'"
          : "content LIKE ? ESCAPE '\\'",
      whereArgs: peer != null ? [peer, like] : [like],
      orderBy: 'created_at DESC',
      limit: limit,
    );
    return rows.map(DbMessage.fromRow).toList();
  }
}
