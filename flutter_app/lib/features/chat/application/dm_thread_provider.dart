import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';

export 'package:nostrfeed_mobile/features/chat/application/dm_store.dart'
    show ChatMessage;

/// Per-thread reactive provider: watches the store version + the DM event
/// source and returns THIS thread's messages only. Replaces the
/// FutureBuilder-per-build in the thread screen — the old pattern created a
/// NEW future on every rebuild and showed a spinner while it resolved,
/// which made the thread flicker on every incoming message.
///
/// ADR-0008 P1/UI (offline-first instant paint): a STREAM yielding TWICE —
/// (1) the DURABLE store's decrypted thread instantly (no relay wait), then
/// (2) the merged relay result. Decryption is idempotent (prime() guards
/// processed ids), so the merge is cheap after the first pass.
///
/// Scroll-stability fix: the provider is now a FutureProvider (not a
/// StreamProvider). A FutureProvider re-evaluates on bumps but keeps the
/// PREVIOUS result on screen while the new future resolves — no flash of a
/// stale store list, no scroll jump when the user is reading history. The
/// store paint for cold start is handled by the [dmThreadStoreProvider]
/// below, which the thread screen watches for the initial frame.
final dmThreadProvider = FutureProvider.autoDispose
    .family<List<ChatMessage>, String>((ref, peerPubkey) async {
      final store = ref.read(dmStoreProvider.notifier);

      // Rebuild when the outbox/decryption cache changes (incoming DM, sent msg).
      ref.watch(dmStoreVersionProvider);
      final events = await ref.watch(dmsProvider.future);
      await store.ready;
      await store.prime(events);
      return store.threadFor(events, peerPubkey);
    });

/// The DURABLE store's decrypted thread (cold-start instant paint). The
/// thread screen watches this for the initial frame — it paints instantly
/// from SQLite, then [dmThreadProvider]'s merged result replaces it.
/// AutoDispose: only lives while the thread screen is open.
final dmThreadStoreProvider = FutureProvider.autoDispose
    .family<List<ChatMessage>, String>((ref, peerPubkey) async {
      final store = ref.read(dmStoreProvider.notifier);
      try {
        return await store.threadFromStore(peerPubkey);
      } catch (_) {
        return const <ChatMessage>[];
      }
    });

// ─── History pagination (scroll-to-old-data) ─────────────────────────────

/// Immutable state for the paged history of ONE thread: the older messages
/// loaded on demand as the user scrolls up (the newest live window still
/// comes from [dmThreadProvider] — this is the BACKFILL underneath it).
class DmHistoryState {
  /// Older messages, oldest-last (newest of the older chunk first) — the
  /// same newest-first order the thread list renders in.
  final List<ChatMessage> older;

  /// False once the store returned a short page (nothing older to load).
  final bool hasMore;

  /// True while a page fetch is in flight (drives the top spinner).
  final bool isLoading;

  const DmHistoryState({
    this.older = const [],
    this.hasMore = true,
    this.isLoading = false,
  });

  DmHistoryState copyWith({
    List<ChatMessage>? older,
    bool? hasMore,
    bool? isLoading,
  }) => DmHistoryState(
    older: older ?? this.older,
    hasMore: hasMore ?? this.hasMore,
    isLoading: isLoading ?? this.isLoading,
  );
}

/// Keyset-paged history loader for ONE thread. The newest window is live
/// ([dmThreadProvider]); this loads the OLDER pages from the durable store
/// (`dmMessagesFor(peer, until:)`) when the user scrolls up. Appending
/// older messages at the END of the reversed ListView never shifts the
/// visible offset — so pagination needs ZERO scroll-position math (the old
/// 80px-per-message estimate hack caused the scroll jumps).
class DmHistoryNotifier extends AutoDisposeFamilyNotifier<DmHistoryState, String>
{
  /// Page size per "load older" call. ~2 screens of bubbles per fetch.
  static const pageSize = 50;

  @override
  DmHistoryState build(String arg) => const DmHistoryState();

  /// Load the next older page. [oldestVisibleTs] is the created_at of the
  /// oldest message currently on screen (the cursor); the fetch returns
  /// messages strictly older than it. Safe to call freely — serialized by
  /// [isLoading] and short-circuits when [hasMore] is false.
  ///
  /// Two legs: (1) the durable store (instant — messages already decrypted
  /// on this device); (2) when the store page comes back short, a bounded
  /// RELAY backfill (`until` cursor) whose wraps are decrypted + persisted
  /// by `ingestBatch`, after which the store page is re-read. Leg 2 is how
  /// months-old history that was never fetched on this device still loads.
  Future<void> loadOlder(int oldestVisibleTs) async {
    if (state.isLoading || !state.hasMore) return;
    state = state.copyWith(isLoading: true);
    try {
      final store = ref.read(dmStoreProvider.notifier);
      var page = await store.threadFromStoreBefore(
        arg,
        oldestVisibleTs,
        limit: pageSize,
      );
      // Store came up short → backfill from relays (NIP-17 wraps are
      // backdated up to 2 days, so widen the `until` window accordingly).
      if (page.length < pageSize) {
        final auth = ref.read(authStateProvider);
        final nostr = ref.read(nostrServiceProvider);
        if (auth.pubkey != null && nostr.isInitialized) {
          try {
            final events = await nostr.relayPool.query(
              [
                NostrFilter(
                  kinds: const [4, 1059],
                  tagFilters: {
                    'p': [auth.pubkey!],
                  },
                  until: oldestVisibleTs + 2 * 24 * 3600,
                  limit: 100,
                ),
              ],
              timeout: const Duration(seconds: 6),
            );
            if (events.isNotEmpty) {
              await store.ingestBatch(events);
              // Re-read the store page now that the backfill is persisted.
              page = await store.threadFromStoreBefore(
                arg,
                oldestVisibleTs,
                limit: pageSize,
              );
            } else {
              // The relay has nothing older either — genuinely the end.
              state = state.copyWith(hasMore: false);
            }
          } catch (_) {
            // Backfill failed — the store page (if any) still stands.
          }
        }
      }
      // Dedupe against what we already have (live window overlap).
      final known = state.older.map((m) => m.id).toSet();
      final fresh = page.where((m) => !known.contains(m.id)).toList();
      state = state.copyWith(
        older: [...state.older, ...fresh],
        hasMore: state.hasMore && page.length >= pageSize,
        isLoading: false,
      );
    } catch (_) {
      state = state.copyWith(isLoading: false);
    }
  }
}

/// Per-thread paged history provider (autoDispose — lives only while the
/// thread screen is open).
final dmHistoryProvider =
    NotifierProvider.autoDispose
        .family<DmHistoryNotifier, DmHistoryState, String>(
      DmHistoryNotifier.new,
    );
