import type { NostrEvent } from '@nostrify/nostrify';

/** Where an event sits in a conversation. */
export interface ThreadPosition {
  /** The note that started the conversation. */
  rootId: string | null;
  /** The note being replied to directly. */
  parentId: string | null;
}

/**
 * Reads an event's place in a thread from its `e` tags.
 *
 * NIP-10 has two conventions and both are still in the wild. The marked form
 * labels tags `root` and `reply`; the deprecated positional form uses order —
 * first tag is the root, last is the direct parent, and a lone tag is both.
 * Reading only one of the two puts replies under the wrong parent, which
 * scrambles the shape of every thread that used the other.
 */
export function getThreadPosition(event: NostrEvent): ThreadPosition {
  /**
   * `mention` is a quote, not a reply.
   *
   * NIP-10 defines the marker for exactly that, and dropping these before
   * anything else is what keeps a quote out of the thread it quotes. Left in,
   * a quote carrying a single `['e', id, '', 'mention']` fell through to the
   * positional reading below, which treats a lone tag as both root and parent
   * — so the quote appeared as a reply under the note it was talking about.
   *
   * Newer clients use a `q` tag instead, which never had this problem because
   * it is not an `e` tag at all.
   */
  const eTags = event.tags.filter(
    ([name, value, , marker]) => name === 'e' && !!value && marker !== 'mention'
  );

  if (!eTags.length) return { rootId: null, parentId: null };

  const marked = {
    root: eTags.find(([, , , marker]) => marker === 'root')?.[1] ?? null,
    reply: eTags.find(([, , , marker]) => marker === 'reply')?.[1] ?? null,
  };

  // A marker on either tag means the author used the marked form
  if (marked.root || marked.reply) {
    return {
      rootId: marked.root ?? marked.reply,
      // Replying directly to the root marks only `root`, with no `reply`
      parentId: marked.reply ?? marked.root,
    };
  }

  // Positional: a single tag is both root and parent
  if (eTags.length === 1) {
    return { rootId: eTags[0][1], parentId: eTags[0][1] };
  }

  return {
    rootId: eTags[0][1],
    parentId: eTags[eTags.length - 1][1],
  };
}

/** True when the event is a reply rather than a top-level note. */
export function isReply(event: NostrEvent): boolean {
  return getThreadPosition(event).parentId !== null;
}

/** How many people a reply notifies before the list is cut short. */
const MAX_MENTIONS = 12;

/**
 * NIP-10 tags for a reply to `parent`.
 *
 * Both `e` tags matter. The `reply` tag says who is being answered so the
 * thread has a shape; the `root` tag is what makes the whole conversation
 * fetchable in one query, since every reply at every depth carries it. A reply
 * that tags only its parent is invisible to anyone querying the root, which is
 * how deep threads end up looking empty.
 *
 * The `p` tags carry the parent's participants forward, so everyone already in
 * the conversation is notified rather than only the last speaker.
 */
export function buildReplyTags(parent: NostrEvent): string[][] {
  const { rootId } = getThreadPosition(parent);
  // Replying to a top-level note makes that note the root
  const root = rootId ?? parent.id;

  /**
   * The root tag carries its author when we know who that is.
   *
   * NIP-10's fifth field is a pubkey hint, and a client reading a deep reply
   * can use it to fetch the conversation's author without walking the chain.
   * The parent's own root tag is where it comes from, since replying to a
   * reply means the root is somebody else's note.
   */
  const rootAuthor =
    root === parent.id
      ? parent.pubkey
      : (parent.tags.find(
          ([name, value, , marker]) =>
            name === 'e' && value === root && marker === 'root'
        )?.[4] ?? '');

  const tags: string[][] = [['e', root, '', 'root', rootAuthor]];

  // A reply to the root itself needs no second tag — root is the parent
  if (root !== parent.id) {
    tags.push(['e', parent.id, '', 'reply', parent.pubkey]);
  }

  const mentioned = new Set<string>([parent.pubkey]);
  for (const [name, value] of parent.tags) {
    if (name !== 'p' || !value || mentioned.size >= MAX_MENTIONS) continue;
    mentioned.add(value);
  }

  for (const pubkey of mentioned) {
    tags.push(['p', pubkey]);
  }

  return tags;
}

export interface ThreadNode {
  event: NostrEvent;
  children: ThreadNode[];
  /** How far below the note the tree was built around this sits. */
  depth: number;
}

/**
 * Arranges a flat list of replies into the tree they describe.
 *
 * Replies whose parent is missing from the list are attached at the top level
 * rather than dropped. A relay can return a grandchild without its parent, and
 * silently hiding those loses real messages — showing them one level up is
 * wrong about the shape but right about the content.
 */
export function buildReplyTree(
  replies: NostrEvent[],
  rootId: string
): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>();
  for (const reply of replies) {
    // Relays repeat events across a fan-out query
    if (reply.id !== rootId) {
      nodes.set(reply.id, { event: reply, children: [], depth: 0 });
    }
  }

  const roots: ThreadNode[] = [];

  for (const node of nodes.values()) {
    const { parentId } = getThreadPosition(node.event);
    const parent =
      parentId && parentId !== rootId ? nodes.get(parentId) : undefined;

    // A parent that already descends from this node would close a loop, and
    // every walk over the result — sorting, counting, rendering — would then
    // never terminate. Such a note is shown at the top level instead.
    if (parent && parent !== node && !descendsFrom(parent, node, nodes)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortByTime(roots, 0);
  return roots;
}

/** Whether `candidate` sits somewhere below `ancestor` in the reply chain. */
function descendsFrom(
  candidate: ThreadNode,
  ancestor: ThreadNode,
  nodes: Map<string, ThreadNode>
): boolean {
  const seen = new Set<string>();
  let cursor: ThreadNode | undefined = candidate;

  while (cursor && !seen.has(cursor.event.id)) {
    if (cursor === ancestor) return true;
    seen.add(cursor.event.id);

    const { parentId } = getThreadPosition(cursor.event);
    cursor = parentId ? nodes.get(parentId) : undefined;
  }

  return false;
}

function sortByTime(list: ThreadNode[], depth: number) {
  list.sort((a, b) => a.event.created_at - b.event.created_at);
  for (const node of list) {
    node.depth = depth;
    sortByTime(node.children, depth + 1);
  }
}

/**
 * The replies directly below one note in a thread, with depth re-based to it.
 *
 * This is what lets any reply become the focus of its own page: the tree is
 * built once for the whole conversation, and focusing is a matter of picking
 * the subtree rather than fetching anything new.
 */
export function descendantsOf(
  tree: ThreadNode[],
  focusedId: string
): ThreadNode[] {
  const stack = [...tree];

  while (stack.length) {
    const node = stack.pop()!;
    if (node.event.id === focusedId) {
      // Depth is measured from the focused note, not the thread root
      sortByTime(node.children, 0);
      return node.children;
    }
    stack.push(...node.children);
  }

  // Focusing the root shows the whole tree
  return tree;
}

/** Total replies in a subtree, including the node's own children. */
export function countDescendants(node: ThreadNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0
  );
}

/**
 * How far replies indent before the thread continues flat.
 *
 * Indentation has to stop somewhere or a deep thread runs off the side of a
 * phone. Past this depth the conversation continues on its own page, with the
 * reply as the new focus — which is how a thread can be arbitrarily deep
 * without the layout ever breaking.
 */
export const MAX_VISIBLE_DEPTH = 3;

/** Replies shown before the rest are collapsed behind a "show more". */
export const REPLIES_BEFORE_COLLAPSE = 3;
