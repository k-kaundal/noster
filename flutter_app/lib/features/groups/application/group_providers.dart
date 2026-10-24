import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/groups/domain/group_models.dart';

/// All NIP-29 groups (kind 39000), parsed to GroupInfo models.
final groupsProvider = FutureProvider.autoDispose<List<GroupInfo>>((ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final events = await nostr.fetchGroups();
  // Only kind 39000 are group definitions; dedupe by d tag (newest wins).
  final byD = <String, NostrEvent>{};
  for (final e in events.where((e) => e.kind == 39000)) {
    final d = e.getTag('d') ?? '';
    final existing = byD[d];
    if (existing == null || e.createdAt > existing.createdAt) byD[d] = e;
  }
  final groups = byD.values.map(GroupInfo.fromEvent).toList()
    ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return groups;
});

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
final myGroupsProvider = FutureProvider.autoDispose<List<GroupInfo>>((ref) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  final groups = await ref.watch(groupsProvider.future);
  final nostr = ref.read(nostrServiceProvider);
  final mine = <GroupInfo>[];
  for (final g in groups) {
    if (await nostr.isGroupMember(g.groupId, auth.pubkey!)) {
      mine.add(g);
    }
  }
  return mine;
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
