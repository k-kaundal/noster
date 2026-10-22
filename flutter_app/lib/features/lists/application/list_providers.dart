import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/lists/domain/nostr_list.dart';

/// The current user's follow sets (NIP-51 kind 30000), parsed to models.
final followSetsProvider =
    FutureProvider.autoDispose<List<NostrList>>((ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  final events = await nostr.fetchFollowSets(auth.pubkey!);
  return events.map(NostrList.fromEvent).toList();
});

/// Posts by the members of one list — the "view list as feed" feature.
/// Fetches kind-1 notes from the list's member pubkeys.
final listFeedProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, NostrList>(
        (ref, list) async {
  if (list.members.isEmpty) return [];
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchFeed(limit: 50, authors: list.members);
});

/// Controller for list mutations (create / edit / delete / member add/remove).
class ListController {
  final Ref _ref;
  ListController(this._ref);

  String _slugify(String title) {
    final slug = title
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    return slug.isEmpty
        ? 'list-${DateTime.now().millisecondsSinceEpoch}'
        : slug;
  }

  /// Create a new follow set. Returns the published event.
  Future<NostrEvent> createList({
    required String title,
    String description = '',
    List<String> members = const [],
  }) async {
    final nostr = _ref.read(nostrServiceProvider);
    final event = nostr.createFollowSet(
      dTag: _slugify(title),
      title: title,
      description: description,
      members: members,
    );
    await nostr.publishEvent(event);
    _invalidate();
    return event;
  }

  /// Update an existing list (same d tag → replaces it).
  Future<void> updateList(NostrList list) async {
    final nostr = _ref.read(nostrServiceProvider);
    final event = nostr.createFollowSet(
      dTag: list.dTag,
      title: list.title,
      description: list.description,
      image: list.image,
      members: list.members,
    );
    await nostr.publishEvent(event);
    _invalidate();
  }

  /// Add a member to a list.
  Future<void> addMember(NostrList list, String pubkey) async {
    if (list.members.contains(pubkey)) return;
    await updateList(
      NostrList(
        id: list.id,
        dTag: list.dTag,
        title: list.title,
        description: list.description,
        image: list.image,
        members: [...list.members, pubkey],
        createdAt: list.createdAt,
        authorPubkey: list.authorPubkey,
      ),
    );
  }

  /// Remove a member from a list.
  Future<void> removeMember(NostrList list, String pubkey) async {
    await updateList(
      NostrList(
        id: list.id,
        dTag: list.dTag,
        title: list.title,
        description: list.description,
        image: list.image,
        members: list.members.where((pk) => pk != pubkey).toList(),
        createdAt: list.createdAt,
        authorPubkey: list.authorPubkey,
      ),
    );
  }

  /// Delete a list (NIP-09 deletion).
  Future<void> deleteList(NostrList list) async {
    final nostr = _ref.read(nostrServiceProvider);
    await nostr.publishEvent(nostr.deleteFollowSet(list.id));
    _invalidate();
  }

  void _invalidate() {
    _ref.invalidate(followSetsProvider);
  }
}

final listControllerProvider = Provider<ListController>(
  (ref) => ListController(ref),
);
