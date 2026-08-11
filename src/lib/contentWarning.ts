import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-36, sensitive content.
 *
 * The `content-warning` tag is the whole of the NIP: a marker, and an optional
 * reason in the author's own words. What the NIP adds on top is that `L`/`l`
 * labels from NIP-32 MAY qualify it — which matters, because prose is not
 * queryable and a label is. A relay can answer `#l: ["nudity"]`; it cannot
 * answer "warnings whose reason mentions nudity".
 *
 * So both are read here, and both are written: the reason for the person
 * reading, the labels for everything else.
 */

/** The namespace NIP-36 names for qualifying labels. */
export const WARNING_NAMESPACE = 'content-warning';

/**
 * How strongly to hide something.
 *
 * Not part of any NIP — a spoiler and a beheading are the same tag on the
 * wire. The difference is entirely in how much of it should be visible behind
 * the blur, which is a client decision, so it is made here.
 */
export type WarningSeverity = 'mild' | 'moderate' | 'explicit';

export interface WarningCategory {
  /** Written to `l` tags, so it must stay stable once published. */
  id: string;
  label: string;
  severity: WarningSeverity;
}

/**
 * The categories offered when composing.
 *
 * Deliberately short. A long list produces one-off labels nobody else uses,
 * which is the same as no label at all — the point of writing `l` tags is that
 * another client can filter on them.
 */
export const WARNING_CATEGORIES: WarningCategory[] = [
  { id: 'nudity', label: 'Nudity', severity: 'moderate' },
  { id: 'sexual', label: 'Sexual content', severity: 'explicit' },
  { id: 'violence', label: 'Violence', severity: 'moderate' },
  { id: 'gore', label: 'Gore', severity: 'explicit' },
  { id: 'self-harm', label: 'Self-harm', severity: 'explicit' },
  { id: 'drugs', label: 'Drugs', severity: 'moderate' },
  { id: 'profanity', label: 'Profanity', severity: 'mild' },
  { id: 'spoiler', label: 'Spoiler', severity: 'mild' },
  { id: 'politics', label: 'Politics', severity: 'mild' },
];

const BY_ID = new Map(WARNING_CATEGORIES.map((entry) => [entry.id, entry]));

/**
 * Codes from other people's ontologies, mapped to ours.
 *
 * Only `NS-nud` is here because only `NS-nud` is documented — it is the single
 * example given in NIP-36 and NIP-56, and the rest of `social.nos.ontology` is
 * not written down anywhere this could be read from. Guessing at the other
 * codes would put words like "violence" on posts that never said so, so
 * unrecognised codes stay unrecognised: they still count as a warning, they
 * just do not get a caption invented for them.
 */
const FOREIGN_LABELS: Record<string, string> = {
  'social.nos.ontology:ns-nud': 'nudity',
};

/** Keyword fallback, for warnings written as prose by clients that do not label. */
const SEVERITY_HINTS: [RegExp, WarningSeverity][] = [
  [
    /\b(porn|pornograph\w*|xxx|hentai|rule ?34|gore|beheading|graphic violence|sexually explicit|explicit|self.?harm|suicide)\b/i,
    'explicit',
  ],
  [
    /\b(nsfw|nude|nudity|naked|sex|sexual|violence|violent|blood|death|drugs?|abuse|slur)\b/i,
    'moderate',
  ],
  [/\b(spoiler|spoilers|politics|political|language|profanity)\b/i, 'mild'],
];

export interface ContentWarning {
  /** The author's own words, when they gave any. */
  reason?: string;
  /**
   * Category ids, from `l` tags. Ours where they match, otherwise whatever the
   * other client wrote — an unrecognised label is still a label.
   */
  categories: string[];
  severity: WarningSeverity;
}

function normalise(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/**
 * Reads the labels that qualify a warning.
 *
 * NIP-32 puts the namespace in the third position of an `l` tag. That mark is
 * required here and the matching `L` declaration is not, which is a deliberate
 * asymmetry: the mark is what makes the label mean something — a bare
 * `["l", "nudity"]` could have come from any vocabulary at all — whereas the
 * `L` tag only announces a namespace already named on the label itself.
 *
 * Insisting on the declaration would be reading the spec at the reader's
 * expense. Clients do omit it, and the two ways of being wrong here are not
 * symmetrical: missing a label shows warned content to somebody who did not
 * ask for it, while an extra one covers a post that can be uncovered with a
 * click.
 */
function readLabels(event: NostrEvent): string[] {
  const found: string[] = [];

  for (const [name, value, namespace] of event.tags) {
    if (name !== 'l') continue;

    const label = normalise(value);
    const ns = normalise(namespace);
    if (!label || !ns) continue;

    if (ns === WARNING_NAMESPACE) {
      found.push(label);
      continue;
    }

    const mapped = FOREIGN_LABELS[`${ns}:${label}`];
    if (mapped) found.push(mapped);
  }

  return [...new Set(found)];
}

function severityOf(reason: string, categories: string[]): WarningSeverity {
  const known = categories
    .map((id) => BY_ID.get(id)?.severity)
    .filter((value): value is WarningSeverity => !!value);

  if (known.includes('explicit')) return 'explicit';
  if (known.includes('moderate')) return 'moderate';

  const text = [reason, ...categories].join(' ');
  for (const [pattern, severity] of SEVERITY_HINTS) {
    if (pattern.test(text)) return severity;
  }

  // A category we do not know is still a stated category, so it is worth more
  // than nothing; a warning with no reason at all gets the middle setting,
  // since the author asked for it to be covered and said no more than that
  return known.length || categories.length ? 'mild' : 'moderate';
}

/**
 * The warning on an event, or null when it carries none.
 *
 * A `content-warning` tag with no reason still warns — the value is optional
 * per the spec, and an empty one must not read as "no warning". So the tag's
 * presence is the test, not its contents.
 */
export function readContentWarning(event: NostrEvent): ContentWarning | null {
  const tag = event.tags.find(([name]) => name === WARNING_NAMESPACE);
  const categories = readLabels(event);

  if (!tag && !categories.length) return null;

  const reason = tag?.[1]?.trim() || undefined;

  return { reason, categories, severity: severityOf(reason ?? '', categories) };
}

/** Whether an event asks to be covered before it is read. */
export function isWarned(event: NostrEvent): boolean {
  return !!readContentWarning(event);
}

/** The categories on a warning, named for a reader. */
export function categoryLabels(warning: ContentWarning): string[] {
  return warning.categories.map((id) => BY_ID.get(id)?.label ?? id);
}

/**
 * The line shown on the cover.
 *
 * The author's words first — they know what they posted. Categories stand in
 * when there are none, which is the common case for a note labelled by a
 * client rather than typed into a box.
 */
export function describeWarning(warning: ContentWarning): string | undefined {
  if (warning.reason) return warning.reason;

  const named = categoryLabels(warning);
  return named.length ? named.join(' · ') : undefined;
}

export interface WarningInput {
  /** Free text from the author. Optional, per the spec. */
  reason?: string;
  /** Category ids, which become `l` tags. */
  categories?: string[];
}

/**
 * The tags that mark an event sensitive.
 *
 * Emits the `L`/`l` pair only for categories, never for the free-text reason.
 * A label is an index key, and a sentence makes a useless one — a relay
 * queried for `#l` should find "nudity", not "contains some stuff from the
 * beach last summer". The sentence has a field of its own.
 */
export function contentWarningTags(input: WarningInput): string[][] {
  const reason = input.reason?.trim();

  const categories = [
    ...new Set(
      (input.categories ?? []).map((id) => normalise(id)).filter(Boolean)
    ),
  ];

  const tags: string[][] = [
    reason ? [WARNING_NAMESPACE, reason] : [WARNING_NAMESPACE],
  ];

  if (categories.length) {
    tags.push(['L', WARNING_NAMESPACE]);
    for (const id of categories) tags.push(['l', id, WARNING_NAMESPACE]);
  }

  return tags;
}
