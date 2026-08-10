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
export const GROUP_PINS = 39005;

/** Moderation, sent by admins and carrying the group in an `h` tag. */
export const PUT_USER = 9000;
export const REMOVE_USER = 9001;

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
