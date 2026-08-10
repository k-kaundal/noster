/**
 * Applying Markdown formatting to a textarea's contents.
 *
 * Pure functions over a string and a selection, returning the new string and
 * where the caret should end up. Kept out of the component because the
 * interesting part is entirely about offsets — which characters were selected,
 * which line the caret is on, where it lands after the text around it grew —
 * and none of that is easier to reason about with a DOM node in the way.
 */

export interface EditState {
  value: string;
  start: number;
  end: number;
}

/** Where the line containing `index` begins. */
function lineStart(value: string, index: number): number {
  return value.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
}

/** Where the line containing `index` ends, not counting the newline. */
function lineEnd(value: string, index: number): number {
  const next = value.indexOf('\n', index);
  return next === -1 ? value.length : next;
}

/**
 * Where to leave the caret after a line-level change.
 *
 * Selecting the affected block is right when a block was selected — pressing
 * quote twice should undo it, which needs the lines still selected. It is
 * wrong for a bare caret: the whole line comes back selected, so the next
 * character typed replaces it, and pressing Heading then typing deleted the
 * `## ` that had just been added.
 */
function caretOrRange(
  state: EditState,
  from: number,
  to: number,
  shift: number
): { start: number; end: number } {
  if (state.start !== state.end) return { start: from, end: to };

  const at = Math.max(from, Math.min(state.start + shift, to));
  return { start: at, end: at };
}

/**
 * Wraps the selection in a marker, or unwraps it if it is already wrapped.
 *
 * Toggling matters more than it sounds: bold is one keystroke, and a shortcut
 * that can only ever add asterisks turns a mistaken press into a cleanup job.
 *
 * With nothing selected, a placeholder is inserted and left selected, so the
 * next keystroke replaces it rather than landing between the markers.
 */
export function toggleWrap(
  state: EditState,
  marker: string,
  placeholder = 'text'
): EditState {
  const { value, start, end } = state;
  const selected = value.slice(start, end);
  const width = marker.length;

  // Already wrapped, with the markers inside the selection
  if (
    selected.length >= width * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(width, -width);

    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    };
  }

  // Already wrapped, with the markers just outside the selection
  if (
    value.slice(Math.max(0, start - width), start) === marker &&
    value.slice(end, end + width) === marker
  ) {
    return {
      value:
        value.slice(0, start - width) + selected + value.slice(end + width),
      start: start - width,
      end: end - width,
    };
  }

  const body = selected || placeholder;
  const next = value.slice(0, start) + marker + body + marker + value.slice(end);

  return {
    value: next,
    start: start + width,
    end: start + width + body.length,
  };
}

/**
 * Puts a prefix on every line the selection touches, or takes it off.
 *
 * Whole lines, because a heading or a quote marker halfway along a line is not
 * Markdown, it is a stray character. Selecting three paragraphs and pressing
 * quote should quote all three.
 */
export function togglePrefix(state: EditState, prefix: string): EditState {
  const { value, start, end } = state;

  const from = lineStart(value, start);
  const to = lineEnd(value, end);

  const block = value.slice(from, to);
  const lines = block.split('\n');

  // Only strip when every line has it; a partial selection gets it added to
  // the rest instead, which is what someone means by pressing it again
  const allPrefixed = lines.every((line) => line.startsWith(prefix));

  const changed = lines
    .map((line) =>
      allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`
    )
    .join('\n');

  const next = value.slice(0, from) + changed + value.slice(to);
  const delta = changed.length - block.length;

  return {
    value: next,
    ...caretOrRange(state, from, to + delta, allPrefixed ? -prefix.length : prefix.length),
  };
}

/**
 * Numbers the selected lines, or unnumbers them.
 *
 * Separate from `togglePrefix` because the prefix is different on every line,
 * which also means an ordered list cannot be detected by a fixed string.
 */
export function toggleOrderedList(state: EditState): EditState {
  const { value, start, end } = state;

  const from = lineStart(value, start);
  const to = lineEnd(value, end);

  const block = value.slice(from, to);
  const lines = block.split('\n');
  const numbered = /^\d+\.\s/;

  const allNumbered = lines.every((line) => numbered.test(line));

  const changed = lines
    .map((line, index) =>
      allNumbered ? line.replace(numbered, '') : `${index + 1}. ${line}`
    )
    .join('\n');

  const next = value.slice(0, from) + changed + value.slice(to);
  const firstLineDelta = (changed.split('\n')[0] ?? '').length -
    (lines[0] ?? '').length;

  return {
    value: next,
    ...caretOrRange(state, from, to + (changed.length - block.length), firstLineDelta),
  };
}

/**
 * Turns the selection into a link.
 *
 * A selection that is already a URL becomes the target with the label left
 * selected to be typed over; anything else becomes the label with the target
 * selected. Either way the next keystroke goes where the missing half was,
 * which is the only part of inserting a link that is tedious.
 */
export function insertLink(state: EditState, url = ''): EditState {
  const { value, start, end } = state;
  const selected = value.slice(start, end);
  const selectionIsUrl = /^(https?:\/\/|nostr:)\S+$/i.test(selected.trim());

  const label = selectionIsUrl ? 'text' : selected || 'text';
  const target = selectionIsUrl ? selected.trim() : url || 'https://';

  const markdown = `[${label}](${target})`;
  const next = value.slice(0, start) + markdown + value.slice(end);

  // Select whichever half still needs typing
  const labelAt = start + 1;
  const targetAt = start + label.length + 3;

  return selectionIsUrl
    ? { value: next, start: labelAt, end: labelAt + label.length }
    : { value: next, start: targetAt, end: targetAt + target.length };
}

/**
 * Inserts a block on its own lines.
 *
 * Blank lines around it, because Markdown ends a paragraph on a blank line and
 * a rule or code fence written against the previous line is read as part of
 * it rather than as a block of its own.
 */
export function insertBlock(state: EditState, block: string): EditState {
  const { value, start, end } = state;

  const before = value.slice(0, start);
  const after = value.slice(end);

  const lead = !before || before.endsWith('\n\n')
    ? ''
    : before.endsWith('\n')
      ? '\n'
      : '\n\n';

  /**
   * Always a gap after, including at the end of the document.
   *
   * Leaving it off there put the caret hard against the block, so the next
   * thing typed joined it — a divider inserted at the end and typed after
   * became `---Some text`, which is one line of prose rather than a rule and
   * a paragraph.
   */
  const trail = after.startsWith('\n\n')
    ? ''
    : after.startsWith('\n')
      ? '\n'
      : '\n\n';

  const inserted = `${lead}${block}${trail}`;

  // After the gap, not before it: the caret should be where typing continues
  const at = start + lead.length + block.length + trail.length;

  return { value: before + inserted + after, start: at, end: at };
}

/** Words in a body of Markdown, near enough for a counter. */
export function wordCount(value: string): number {
  const words = value.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'h2'
  | 'h3'
  | 'link'
  | 'quote'
  | 'code'
  | 'bullets'
  | 'numbers'
  | 'rule';

/**
 * What each button does to the text.
 *
 * Exported as a plain map so the keyboard shortcuts run the same code as the
 * buttons — two implementations of "bold" is two things that can disagree.
 */
export function applyAction(
  action: MarkdownAction,
  state: EditState
): EditState {
  switch (action) {
    case 'bold':
      return toggleWrap(state, '**');
    case 'italic':
      return toggleWrap(state, '*');
    case 'code':
      return toggleWrap(state, '`', 'code');
    case 'h2':
      return togglePrefix(state, '## ');
    case 'h3':
      return togglePrefix(state, '### ');
    case 'quote':
      return togglePrefix(state, '> ');
    case 'bullets':
      return togglePrefix(state, '- ');
    case 'numbers':
      return toggleOrderedList(state);
    case 'link':
      return insertLink(state);
    case 'rule':
      return insertBlock(state, '---');
  }
}
