import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-29 relay-based groups.
 *
 * Different in kind from the NIP-72 communities this app already has. A
 * community is an addressable event anyone can reference from anywhere; a
 * NIP-29 group is a set of rules a *particular relay* enforces over a plain
 * string id. The relay signs the group's metadata with its own key, decides
 * who may write, and rejects what it does not like.
 *
 * Two consequences run through everything here:
 *
 * - **A group is only meaningful together with its relay.** The same id on two
 *   relays can be two different communities with different admins and
 *   different history — the spec calls that a fork and treats it as a
 *   feature. So nothing in this file identifies a group by id alone.
 * - **The relay is the authority.** Membership, admin lists and metadata are
 *   read from what the relay published, not computed from what users claim.
 */

/** Relay-signed, addressed by group id in a `d` tag. */
export const GROUP_METADATA = 39000;
export const GROUP_ADMINS = 39001;
export const GROUP_MEMBERS = 39002;
export const GROUP_ROLES = 39003;
/** Who is currently in the group's live audio/video room. */
export const LIVEKIT_PARTICIPANTS = 39004;
export const GROUP_PINS = 39005;

/**
 * Moderation, sent by admins and carrying the group in an `h` tag.
 *
 * The relay decides who may send which of these — the spec deliberately does
 * not say what a role can do, only that the relay checks. So nothing here
 * gates on a role name: a client that guessed the policy would refuse actions
 * the relay would have allowed, and allow ones it rejects anyway.
 */
export const PUT_USER = 9000;
export const REMOVE_USER = 9001;
export const EDIT_METADATA = 9002;
export const DELETE_EVENT = 9005;
export const CREATE_GROUP = 9007;
export const DELETE_GROUP = 9008;
export const CREATE_INVITE = 9009;
export const UPDATE_PIN_LIST = 9010;

/** Sent by anyone about their own membership. */
export const JOIN_REQUEST = 9021;
export const LEAVE_REQUEST = 9022;

/** NIP-51: the groups a user wants to be remembered as being in. */
export const GROUP_LIST = 10009;

/** Chat and threads, the two kinds groups are used for in practice. */
export const GROUP_CHAT = 9;
export const GROUP_THREAD = 11;

export interface GroupMetadata {
  id: string;
  name: string;
  picture?: string;
  banner?: string;
  about?: string;
  /** Only members can read. */
  isPrivate: boolean;
  /** Only members can write. */
  isRestricted: boolean;
  /** Metadata is hidden from non-members. */
  isHidden: boolean;
  /** Join requests are ignored without an invite code. */
  isClosed: boolean;
  /** Supports LiveKit audio/video rooms. */
  hasLivekit: boolean;
  /**
   * Kinds the group accepts, or null when it accepts anything.
   *
   * An empty list is meaningful and distinct from an absent one: it means the
   * group takes no events at all, which is how an audio-only room is
   * described. Collapsing the two would show a text composer in a room that
   * will reject every message.
   */
  supportedKinds: number[] | null;
  /** The group this one sits under, when it is a subgroup. */
  parent?: string;
  /** Subgroups, in the order the parent chose to list them. */
  children: string[];
  event: NostrEvent;
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags
    .filter(([tagName, value]) => tagName === name && !!value)
    .map(([, value]) => value);
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return tagValues(event, name)[0];
}

function hasTag(event: NostrEvent, name: string): boolean {
  return event.tags.some(([tagName]) => tagName === name);
}

/**
 * Every value in a tag, not just the first.
 *
 * `supported_kinds` is one tag carrying a list — `["supported_kinds", "9",
 * "11"]` — unlike `child`, `role` and `p`, which repeat the tag once per
 * value. Reading it the usual way finds kind 9 and silently loses the rest,
 * so a group that accepts threads looks like one that only accepts chat.
 */
function tagList(event: NostrEvent, name: string): string[] {
  return event.tags
    .filter(([tagName]) => tagName === name)
    .flatMap(([, ...values]) => values)
    .filter(Boolean);
}

export function parseGroupMetadata(event: NostrEvent): GroupMetadata | null {
  if (event.kind !== GROUP_METADATA) return null;

  const id = tagValue(event, 'd');
  if (!id) return null;

  /**
   * Absent means "everything", which is not the same as an empty list. The
   * tag is `["supported_kinds", "9", "11"]`, so its presence is checked
   * separately from its values.
   */
  const supportedKinds = hasTag(event, 'supported_kinds')
    ? tagList(event, 'supported_kinds')
        .map((value) => Number(value))
        .filter((kind) => Number.isInteger(kind))
    : null;

  return {
    id,
    // Falling back to the id rather than "Untitled": the id is what the group
    // is actually called on that relay, and it is what someone would search
    name: tagValue(event, 'name') || id,
    picture: tagValue(event, 'picture'),
    banner: tagValue(event, 'banner'),
    about: tagValue(event, 'about'),
    isPrivate: hasTag(event, 'private'),
    isRestricted: hasTag(event, 'restricted'),
    isHidden: hasTag(event, 'hidden'),
    isClosed: hasTag(event, 'closed'),
    hasLivekit: hasTag(event, 'livekit'),
    supportedKinds,
    parent: tagValue(event, 'parent'),
    children: tagValues(event, 'child'),
    event,
  };
}

/** Whether the group will accept an event of this kind. */
export function acceptsKind(group: GroupMetadata, kind: number): boolean {
  return group.supportedKinds === null || group.supportedKinds.includes(kind);
}

export interface GroupAdmin {
  pubkey: string;
  /** Relay-defined labels; the spec deliberately fixes no vocabulary. */
  roles: string[];
}

export function parseGroupAdmins(event: NostrEvent | undefined): GroupAdmin[] {
  if (!event || event.kind !== GROUP_ADMINS) return [];

  return event.tags
    .filter(([name, pubkey]) => name === 'p' && !!pubkey)
    .map(([, pubkey, ...roles]) => ({ pubkey, roles: roles.filter(Boolean) }));
}

export function parseGroupMembers(event: NostrEvent | undefined): string[] {
  if (!event || event.kind !== GROUP_MEMBERS) return [];
  return tagValues(event, 'p');
}

export interface GroupRole {
  name: string;
  description?: string;
}

export function parseGroupRoles(event: NostrEvent | undefined): GroupRole[] {
  if (!event || event.kind !== GROUP_ROLES) return [];

  return event.tags
    .filter(([name, role]) => name === 'role' && !!role)
    .map(([, name, description]) => ({ name, description: description || undefined }));
}

/** Pinned events, in the order the relay listed them. */
export function parseGroupPins(event: NostrEvent | undefined): string[] {
  if (!event || event.kind !== GROUP_PINS) return [];

  return event.tags
    .filter(([name, value]) => (name === 'e' || name === 'a') && !!value)
    .map(([, value]) => value);
}

/**
 * Whether someone is currently in the group.
 *
 * Decided by whichever of `kind:9000` (added) or `kind:9001` (removed) is
 * newest, because both remain in the group's history forever — someone
 * removed and later re-added has one of each, and reading either alone gives
 * the wrong answer half the time. With neither, they are not a member.
 *
 * Ties go to removal. Two events in the same second is a relay quirk rather
 * than a real ordering, and wrongly showing someone as a member lets them
 * write into a group that will reject everything they send.
 */
export function isMember(
  moderation: NostrEvent[],
  pubkey: string
): boolean {
  let decidedAt = -1;
  let member = false;

  for (const event of moderation) {
    if (event.kind !== PUT_USER && event.kind !== REMOVE_USER) continue;

    const names = event.tags.some(
      ([name, value]) => name === 'p' && value === pubkey
    );
    if (!names) continue;

    const added = event.kind === PUT_USER;

    if (
      event.created_at > decidedAt ||
      (event.created_at === decidedAt && !added)
    ) {
      decidedAt = event.created_at;
      member = added;
    }
  }

  return member;
}

/** The roles a pubkey holds, from the relay's admin list. */
export function rolesOf(admins: GroupAdmin[], pubkey: string): string[] {
  return admins.find((admin) => admin.pubkey === pubkey)?.roles ?? [];
}

/**
 * How many recent events to draw timeline references from.
 *
 * The spec's window: references are taken from the last 50 events seen on
 * that relay.
 */
const PREVIOUS_WINDOW = 50;

/** How many references to include. The spec recommends at least three. */
const PREVIOUS_COUNT = 3;

/**
 * The `previous` tag: proof this message was written in context.
 *
 * Each reference is the first 8 characters of a recently seen event id, and a
 * relay rejects an event referring to ids it does not hold. That makes a
 * message hard to replay into a fork of the same group on another relay,
 * which is the whole point — the group id alone is a string anyone can reuse.
 *
 * Own events are excluded, since referencing only yourself proves nothing
 * about having seen the conversation.
 */
export function buildPrevious(
  seen: NostrEvent[],
  selfPubkey: string,
  count = PREVIOUS_COUNT
): string[] {
  const references = seen
    .filter((event) => event.pubkey !== selfPubkey)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, PREVIOUS_WINDOW)
    .slice(0, count)
    .map((event) => event.id.slice(0, 8));

  // Zero references is legal; an empty tag is not
  return references.length ? ['previous', ...references] : [];
}

/** The tags every user event in a group carries. */
export function groupTags(
  groupId: string,
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  const tags: string[][] = [['h', groupId]];

  if (options.seen?.length && options.selfPubkey) {
    const previous = buildPrevious(options.seen, options.selfPubkey);
    if (previous.length) tags.push(previous);
  }

  return tags;
}

/**
 * A group reference, which is an `naddr` optionally carrying an invite code.
 *
 * The code is appended after a `?`, which is outside the bech32 alphabet — so
 * everything before it stays a valid identifier and a client that knows
 * nothing about invites still resolves the group.
 */
export function parseGroupReference(input: string): {
  naddr: string;
  invite?: string;
} {
  const value = input.trim().replace(/^nostr:/, '');
  const at = value.indexOf('?');

  if (at === -1) return { naddr: value };

  const params = new URLSearchParams(value.slice(at + 1));

  return {
    naddr: value.slice(0, at),
    invite: params.get('invite') || undefined,
  };
}

export interface GroupNode extends GroupMetadata {
  subgroups: GroupNode[];
}

/**
 * Assembles the subgroup tree.
 *
 * Built locally from `parent` tags rather than trusted from the `child` lists,
 * because the two can disagree — the spec has relays maintain both — and a
 * child that names its parent is the direction that cannot invent a
 * relationship on someone else's behalf. The parent's `child` order is used
 * where it exists, since ordering is the one thing only the parent knows.
 *
 * A parent naming a group that is not here leaves that group as a root, which
 * is what a reader wants: an orphan is still worth showing.
 */
export function buildGroupTree(groups: GroupMetadata[]): GroupNode[] {
  const byId = new Map<string, GroupNode>(
    groups.map((group) => [group.id, { ...group, subgroups: [] }])
  );

  const roots: GroupNode[] = [];

  for (const node of byId.values()) {
    const parent = node.parent ? byId.get(node.parent) : undefined;

    // Self-reference would otherwise drop the group out of the tree entirely
    if (parent && parent.id !== node.id) {
      parent.subgroups.push(node);
    } else {
      roots.push(node);
    }
  }

  // The parent's `child` list is the only place ordering is expressed
  for (const node of byId.values()) {
    if (!node.children.length) continue;

    const order = new Map(node.children.map((id, index) => [id, index]));
    node.subgroups.sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  return roots;
}

/** One entry in the user's saved list of groups. */
export interface SavedGroup {
  id: string;
  /** Which relay enforces this group. Without it the id names nothing. */
  relay?: string;
  name?: string;
}

/** The groups in a user's NIP-51 `kind:10009` list. */
export function parseGroupList(event: NostrEvent | undefined): SavedGroup[] {
  if (!event || event.kind !== GROUP_LIST) return [];

  return event.tags
    .filter(([name, id]) => name === 'group' && !!id)
    .map(([, id, relay, name]) => ({
      id,
      relay: relay || undefined,
      name: name || undefined,
    }));
}

/**
 * The tags for a saved group list.
 *
 * `r` tags for every relay in use come along, as NIP-51 specifies. They are
 * redundant with the relays named in each `group` tag and they are the thing
 * that lets a client find a group again when its relay has gone quiet: the
 * spec has clients check a group's admins for a move, and that check needs
 * somewhere to connect to first.
 *
 * Identity is the pair, not the id. Two relays can host different groups
 * under one id, so leaving the same id twice with different relays is correct
 * and deduplicating on id alone would silently drop one of them.
 */
export function buildGroupListTags(groups: SavedGroup[]): string[][] {
  const tags: string[][] = [];
  const seen = new Set<string>();
  const relays = new Set<string>();

  for (const group of groups) {
    if (!group.id) continue;

    const key = `${group.id}|${group.relay ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tag = ['group', group.id, group.relay ?? ''];
    if (group.name) tag.push(group.name);

    // Positional: a name after a missing relay would be read as the relay
    while (tag.length > 2 && !tag[tag.length - 1]) tag.pop();

    tags.push(tag);
    if (group.relay) relays.add(group.relay);
  }

  for (const relay of relays) tags.push(['r', relay]);

  return tags;
}

/**
 * Metadata fields an admin can change, as `kind:9002` takes them.
 *
 * The booleans are three-state on purpose. `undefined` means "leave it as it
 * is", and the spec's flags are presence-only — `["private"]` with no value —
 * so there is no way to spell "off" other than omitting the tag. Conflating
 * "unchanged" with "off" would quietly make a private group public the first
 * time somebody renamed it.
 */
export interface GroupMetadataEdit {
  name?: string;
  picture?: string;
  banner?: string;
  about?: string;
  isPrivate?: boolean;
  isRestricted?: boolean;
  isHidden?: boolean;
  isClosed?: boolean;
  hasLivekit?: boolean;
  /** Null detaches the group and makes it a root. */
  parent?: string | null;
  supportedKinds?: number[] | null;
  /**
   * The child list, in order.
   *
   * Only for reordering. Left out, the group's existing children are carried
   * through unchanged — which is required, not merely polite: an edit missing
   * any of them is rejected outright.
   */
  children?: string[];
}

/**
 * Tags for a `kind:9002` edit-metadata event.
 *
 * Takes the group's current metadata as well as the changes, because this
 * event replaces the whole description rather than patching it — a field left
 * out is a field cleared. Two of those omissions are outright rejections
 * rather than quiet damage:
 *
 * - "kind:9002 metadata edits that do not include all the children as child
 *   tags MUST be rejected." So a rename that forgot the children would be
 *   thrown out by the relay, and the admin would see a failure with no
 *   explanation of which tag was missing.
 * - At most one `parent` tag is allowed, and its absence is what makes a group
 *   a root — so detaching is expressed by leaving it out, not by a value.
 */
export function editMetadataTags(
  current: GroupMetadata,
  changes: GroupMetadataEdit = {},
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  const tags = groupTags(current.id, options);

  const pick = <T>(next: T | undefined, existing: T): T =>
    next === undefined ? existing : next;

  const name = pick(changes.name, current.name);
  const picture = pick(changes.picture, current.picture);
  const banner = pick(changes.banner, current.banner);
  const about = pick(changes.about, current.about);

  if (name) tags.push(['name', name]);
  if (picture) tags.push(['picture', picture]);
  if (banner) tags.push(['banner', banner]);
  if (about) tags.push(['about', about]);

  // Presence-only flags: written when on, absent when off
  const flags: [string, boolean][] = [
    ['private', pick(changes.isPrivate, current.isPrivate)],
    ['restricted', pick(changes.isRestricted, current.isRestricted)],
    ['hidden', pick(changes.isHidden, current.isHidden)],
    ['closed', pick(changes.isClosed, current.isClosed)],
    ['livekit', pick(changes.hasLivekit, current.hasLivekit)],
  ];

  for (const [flag, on] of flags) {
    if (on) tags.push([flag]);
  }

  const supported = pick(changes.supportedKinds, current.supportedKinds);

  /**
   * An empty list is written as a bare tag, which is how an AV-only group is
   * described. Only a null — "no restriction stated" — omits it entirely.
   */
  if (supported !== null) {
    tags.push(['supported_kinds', ...supported.map(String)]);
  }

  const parent =
    changes.parent === undefined ? current.parent : changes.parent;

  if (parent) tags.push(['parent', parent]);

  /**
   * The full child list, in order. Carried through untouched unless the caller
   * is deliberately reordering it — the relay rejects an edit that omits any
   * child, so this is the difference between a rename working and failing.
   */
  for (const child of changes.children ?? current.children) {
    tags.push(['child', child]);
  }

  return tags;
}

/**
 * Tags for reordering a parent's children.
 *
 * Separate from a metadata edit only because the caller is thinking about a
 * different thing; on the wire it is the same `kind:9002`, carrying the same
 * complete list. The order of the `child` tags *is* the order.
 */
export function reorderChildrenTags(
  current: GroupMetadata,
  children: string[],
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  const known = new Set(current.children);

  /**
   * Only children the group already has, and all of them. A list that dropped
   * one would be rejected, and one that invented an id would claim a group
   * that may not exist.
   */
  const ordered = children.filter((id) => known.has(id));
  for (const id of current.children) {
    if (!ordered.includes(id)) ordered.push(id);
  }

  return editMetadataTags(current, { children: ordered }, options);
}

/** Tags for `kind:9000`, adding a user or changing their roles. */
export function putUserTags(
  groupId: string,
  pubkey: string,
  roles: string[] = [],
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  return [...groupTags(groupId, options), ['p', pubkey, ...roles]];
}

/** Tags for `kind:9001`, removing a user. */
export function removeUserTags(
  groupId: string,
  pubkey: string,
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  return [...groupTags(groupId, options), ['p', pubkey]];
}

/** Tags for `kind:9005`, asking the relay to drop an event. */
export function deleteEventTags(
  groupId: string,
  eventId: string,
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  return [...groupTags(groupId, options), ['e', eventId]];
}

/** Tags for `kind:9009`, minting an invite code. */
export function createInviteTags(
  groupId: string,
  code: string,
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  return [...groupTags(groupId, options), ['code', code]];
}

/**
 * Tags for `kind:9010`, setting the pinned list.
 *
 * The whole list every time. "Pinning, unpinning, reordering and clearing pins
 * are all done by submitting a new list", so an empty one is a legitimate
 * event meaning "nothing is pinned" rather than a mistake to guard against.
 *
 * Event ids go in `e` tags and addresses in `a`, told apart by shape: an
 * address is `kind:pubkey:d` and an id is 64 hex characters.
 */
export function updatePinsTags(
  groupId: string,
  pins: string[],
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  const tags = groupTags(groupId, options);

  for (const pin of pins) {
    const value = pin.trim();
    if (!value) continue;

    tags.push([/^\d+:[0-9a-f]{64}:/i.test(value) ? 'a' : 'e', value]);
  }

  return tags;
}

/** Tags for `kind:9007` / `kind:9008`, which carry nothing but the group. */
export function groupLifecycleTags(
  groupId: string,
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  return groupTags(groupId, options);
}

/** Tags for `kind:9021`, a join request, optionally with an invite code. */
export function joinRequestTags(
  groupId: string,
  invite?: string,
  options: { seen?: NostrEvent[]; selfPubkey?: string } = {}
): string[][] {
  const tags = groupTags(groupId, options);
  if (invite?.trim()) tags.push(['code', invite.trim()]);
  return tags;
}

/**
 * How a relay's rejection of a join request should be read.
 *
 * The spec asks relays to say in the message "whether the rejection is final,
 * if the request is pending review, or if some other special handling is
 * relevant", and mandates one exact prefix: a user who is already a member
 * gets `duplicate:`. That one is worth acting on rather than showing — it
 * means the join succeeded some time ago.
 */
export type JoinOutcome = 'joined' | 'already-member' | 'pending' | 'rejected';

export function readJoinRejection(message: string): JoinOutcome {
  const text = message.trim().toLowerCase();

  if (text.startsWith('duplicate:')) return 'already-member';

  /**
   * Everything else is a guess at prose, so it only ever softens the message
   * shown — never grants access. Getting this wrong displays the wrong
   * sentence; it cannot let anybody into a group.
   */
  if (/\b(pending|awaiting|review|moderat|approv)/.test(text)) return 'pending';

  return 'rejected';
}

/**
 * Where a group's admins say the group now lives.
 *
 * The spec's answer to a relay going away: "clients SHOULD periodically -- and
 * MUST, if their primary relay for a group is offline or unreachable -- look
 * at the kind:10009 event of the group's admins and of trusted friends. The
 * pubkeys of the admins of the groups the user is in SHOULD be cached locally
 * so this check can be performed even when the original relay is down."
 *
 * The caching is the part that is easy to skip and impossible to work without.
 * Admins are named in the group's own kind:39001, which lives on the relay
 * that just stopped answering — so a client that only learns who the admins
 * are by asking the dead relay can never perform the check the spec makes
 * mandatory for exactly that situation.
 */
export interface GroupLocation {
  relay: string;
  /** Admins pointing at this relay. More agreement is more confidence. */
  vouchedBy: string[];
}

export interface GroupMoveReport {
  groupId: string;
  /** Where the client has been looking. */
  from?: string;
  /** Other relays admins now name, most-vouched first. */
  candidates: GroupLocation[];
}

function normaliseRelay(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Reads admins' group lists to find where a group may have moved.
 *
 * Deliberately reports rather than decides. The same id on a second relay is
 * as likely to be a fork as a migration — the spec treats forks as a feature,
 * two communities that share a name and disagree — and no amount of tag
 * reading distinguishes "we moved" from "we split". So this returns the
 * candidates and leaves the choice to the person whose group it is.
 */
export function findGroupMoves(
  groupId: string,
  adminLists: { pubkey: string; event: NostrEvent }[],
  currentRelay?: string
): GroupMoveReport {
  const here = currentRelay ? normaliseRelay(currentRelay) : undefined;
  const byRelay = new Map<string, Set<string>>();

  for (const { pubkey, event } of adminLists) {
    for (const saved of parseGroupList(event)) {
      if (saved.id !== groupId || !saved.relay) continue;

      const relay = normaliseRelay(saved.relay);
      if (relay === here) continue;

      const vouchers = byRelay.get(relay) ?? new Set<string>();
      vouchers.add(pubkey);
      byRelay.set(relay, vouchers);
    }
  }

  const candidates = [...byRelay]
    .map(([relay, vouchers]) => ({ relay, vouchedBy: [...vouchers] }))
    .sort((a, b) => b.vouchedBy.length - a.vouchedBy.length);

  return { groupId, from: currentRelay, candidates };
}

/**
 * The LiveKit token endpoint for a group.
 *
 * Derived from the relay's websocket URL, since that is the only address a
 * client holds — `wss://` becomes `https://`, and `ws://` becomes `http://`
 * so a local relay over plain HTTP still works rather than failing on a
 * scheme mismatch nobody can debug.
 */
export function livekitTokenUrl(relayUrl: string, groupId: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:';
  url.pathname = `/.well-known/nip29/livekit/${encodeURIComponent(groupId)}`;
  url.search = '';

  return url.toString();
}

/** Where a relay says whether it does LiveKit at all. */
export function livekitSupportUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:';
  url.pathname = '/.well-known/nip29/livekit';
  url.search = '';

  return url.toString();
}

/** Who the relay says is currently in a group's AV room (`kind:39004`). */
export function parseLivekitParticipants(
  event: NostrEvent | undefined
): string[] {
  if (!event || event.kind !== LIVEKIT_PARTICIPANTS) return [];

  return event.tags
    .filter(
      ([name, value]) =>
        name === 'participant' && /^[0-9a-f]{64}$/i.test(value ?? '')
    )
    .map(([, pubkey]) => pubkey.toLowerCase());
}

/**
 * The Nostr pubkey behind a LiveKit participant identity.
 *
 * "Relays MUST set the sub property on the issued JWT such that the initial 64
 * characters correspond to the lowercase hex public key of the Nostr user",
 * with a random suffix so one person can join twice. Comparing identities
 * whole would show the same person as two strangers on their second device.
 */
export function pubkeyFromIdentity(identity: string): string | null {
  const head = identity.slice(0, 64).toLowerCase();
  return /^[0-9a-f]{64}$/.test(head) ? head : null;
}

/** Whether a relay's NIP-11 document claims subgroup support. */
export function supportsSubgroups(info: unknown): boolean {
  if (!info || typeof info !== 'object') return false;

  const nip29 = (info as { nip29?: unknown }).nip29;
  if (!nip29 || typeof nip29 !== 'object') return false;

  return (nip29 as { subgroups?: unknown }).subgroups === true;
}
