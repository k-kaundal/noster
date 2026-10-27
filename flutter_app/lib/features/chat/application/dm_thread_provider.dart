import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/content_providers.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';

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
