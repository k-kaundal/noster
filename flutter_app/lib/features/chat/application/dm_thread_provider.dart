import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/content_providers.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';

/// Per-thread reactive provider: watches the store version + the DM event
/// source and returns THIS thread's messages only. Replaces the
/// FutureBuilder-per-build in the thread screen — the old pattern created a
/// NEW future on every rebuild and showed a spinner while it resolved,
/// which made the thread flicker on every incoming message.
///
/// Decryption is idempotent (prime() guards processed ids), so the async
/// work is a no-op after the first pass — subsequent bumps rebuild from the
/// cache instantly with no spinner.
final dmThreadProvider = FutureProvider.autoDispose
    .family<List<ChatMessage>, String>((ref, peerPubkey) async {
  // Rebuild when the outbox/decryption cache changes (incoming DM, sent msg).
  ref.watch(dmStoreVersionProvider);
  final events = await ref.watch(dmsProvider.future);
  final store = ref.read(dmStoreProvider.notifier);
  await store.ready;
  await store.prime(events);
  return store.threadFor(events, peerPubkey);
});
