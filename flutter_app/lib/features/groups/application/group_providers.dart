import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/groups/domain/group_models.dart';

/// All NIP-29 groups (kind 39000), parsed to GroupInfo models.
///
/// keepAlive + store-first: the groups list paints from the SQLite store
/// instantly on re-entry (the autoDispose provider re-fetched on every
/// visit — the "groups is slow" complaint). The relay fetch refreshes
/// behind with a browse TTL.
final groupsProvider = AsyncNotifierProvider<GroupsNotifier, List<GroupInfo>>(
  GroupsNotifier.new,
);

class GroupsNotifier extends AsyncNotifier<List<GroupInfo>> {
  int _fetchedAt = 0;
  static const _ttl = Duration(minutes: 5);

  @override
  Future<List<GroupInfo>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _ttl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;

    // Store-first paint: kind-39000 group definitions render instantly.
    final stored = await EventStore.instance.queryByFilters([
      NostrFilter(kinds: const [39000], limit: 100),
    ]);
    final storedGroups = _dedupeToGroups(stored);
    if (storedGroups.isNotEmpty && !stale) {
      _refreshBehind();
      return storedGroups;
    }

    try {
      final nostr = await initNostr(ref);
      final fresh = await nostr.fetchGroups();
      if (fresh.isNotEmpty) {
        unawaited(EventStore.instance.ingest(fresh));
        _fetchedAt = DateTime.now().millisecondsSinceEpoch;
        final freshGroups = _dedupeToGroups(fresh);
        if (storedGroups.isNotEmpty) {
          final seen = storedGroups.map((g) => g.id).toSet();
          return [
            ...storedGroups,
            ...freshGroups.where((g) => !seen.contains(g.id)),
          ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        }
        return freshGroups;
      }
    } catch (_) {}
    return storedGroups.isNotEmpty ? storedGroups : (current ?? storedGroups);
  }

  void _refreshBehind() {
    Future.microtask(() async {
      try {
        final nostr = await initNostr(ref);
        final fresh = await nostr.fetchGroups();
        if (fresh.isNotEmpty) {
          unawaited(EventStore.instance.ingest(fresh));
          _fetchedAt = DateTime.now().millisecondsSinceEpoch;
          final freshGroups = _dedupeToGroups(fresh);
          final current = state.valueOrNull ?? [];
          final seen = current.map((g) => g.id).toSet();
          final merged = [
            ...current,
            ...freshGroups.where((g) => !seen.contains(g.id)),
          ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
          state = AsyncData(merged);
        }
      } catch (_) {}
    });
  }

  /// Dedupe kind-39000 events by d-tag (addressable, newest wins) → models.
  static List<GroupInfo> _dedupeToGroups(List<NostrEvent> events) {
    final byD = <String, NostrEvent>{};
    for (final e in events.where((e) => e.kind == 39000)) {
      final d = e.getTag('d') ?? '';
      final existing = byD[d];
      if (existing == null || e.createdAt > existing.createdAt) byD[d] = e;
    }
    return byD.values.map(GroupInfo.fromEvent).toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }
}

/// Group members (kind 39002 p tags).
final groupMembersProvider =
    FutureProvider.autoDispose.family<List<String>, String>((ref, groupId) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchGroupMembers(groupId);
});

/// Group admins with roles (kind 39001).
final groupAdminsProvider = FutureProvider.autoDispose
    .family<Map<String, List<String>>, String>((ref, groupId) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchGroupAdmins(groupId);
});

/// Whether the current user is a member of a group.
final isGroupMemberProvider =
    FutureProvider.autoDispose.family<bool, String>((ref, groupId) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return false;
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.isGroupMember(groupId, auth.pubkey!);
});

/// Whether the current user is an admin of a group.
final isGroupAdminProvider =
    FutureProvider.autoDispose.family<bool, String>((ref, groupId) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return false;
  final admins = await ref.watch(groupAdminsProvider(groupId).future);
  return admins.containsKey(auth.pubkey);
});

/// Groups the current user is a member of ("My Groups").
///
/// Batch query: the old loop called `isGroupMember` per group — N sequential
/// relay round-trips for N groups. Now ONE store query for the user's
/// kind-39002 membership events (which carry the group h-tags), then filter
/// the groups list locally. Falls back to the relay batch only if the store
/// has no membership data yet.
final myGroupsProvider = FutureProvider.autoDispose<List<GroupInfo>>((ref) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  final groups = await ref.watch(groupsProvider.future);
  if (groups.isEmpty) return [];

  // Single store query: the user's kind-39002 (group members list) events
  // carry p-tags for members — find the ones that include us, extract the
  // h-tags (group ids).
  final myMemberEvents = await EventStore.instance.queryByFilters([
    NostrFilter(kinds: const [39002], limit: 100),
  ]);
  final myGroupIds = <String>{};
  for (final e in myMemberEvents) {
    final members = e.tags.where((t) => t.isNotEmpty && t[0] == 'p');
    if (members.any((t) => t.length > 1 && t[1] == auth.pubkey)) {
      final hTag = e.tags.firstWhere(
        (t) => t.isNotEmpty && t[0] == 'h',
        orElse: () => const [],
      );
      if (hTag.length > 1) myGroupIds.add(hTag[1]);
    }
  }

  // Local hit: filter groups by the store-derived ids.
  if (myGroupIds.isNotEmpty) {
    return groups.where((g) => myGroupIds.contains(g.groupId)).toList();
  }

  // Store miss (first run): fall back to relay checks, batched in parallel.
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final results = await Future.wait(
    groups.map((g) async => (
      group: g,
      isMember: await nostr.isGroupMember(g.groupId, auth.pubkey!),
    )),
  );
  return results.where((r) => r.isMember).map((r) => r.group).toList();
});

/// Controller for group actions (join/leave/moderation).
class GroupController {
  final Ref _ref;
  GroupController(this._ref);

  Future<void> join(String groupId, {String? inviteCode}) async {
    final nostr = _ref.read(nostrServiceProvider);
    await nostr.publishEvent(
      nostr.createGroupJoinRequest(groupId, inviteCode: inviteCode),
    );
    _invalidate(groupId);
  }

  Future<void> leave(String groupId) async {
    final nostr = _ref.read(nostrServiceProvider);
    await nostr.publishEvent(nostr.createGroupLeaveRequest(groupId));
    _invalidate(groupId);
  }

  Future<void> removeMember(String groupId, String pubkey) async {
    final nostr = _ref.read(nostrServiceProvider);
    await nostr.publishEvent(nostr.createGroupRemoveUser(groupId, pubkey));
    _invalidate(groupId);
  }

  Future<void> addMember(String groupId, String pubkey,
      {List<String> roles = const []}) async {
    final nostr = _ref.read(nostrServiceProvider);
    await nostr.publishEvent(
      nostr.createGroupPutUser(groupId, pubkey, roles: roles),
    );
    _invalidate(groupId);
  }

  Future<void> deleteMessage(String groupId, String eventId) async {
    final nostr = _ref.read(nostrServiceProvider);
    await nostr.publishEvent(nostr.createGroupDeleteEvent(groupId, eventId));
    _invalidate(groupId);
  }

  void _invalidate(String groupId) {
    _ref.invalidate(groupMembersProvider(groupId));
    _ref.invalidate(isGroupMemberProvider(groupId));
    _ref.invalidate(myGroupsProvider);
  }
}

final groupControllerProvider = Provider<GroupController>(
  (ref) => GroupController(ref),
);
