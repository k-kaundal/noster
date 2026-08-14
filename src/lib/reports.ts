import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-56, reporting.
 *
 * A kind 1984 event says "this is objectionable" about a pubkey, a note, or a
 * file. There is no authority on the other end of it: the spec is explicit
 * that reports are a signal every agent decides what to do with, and that
 * relays should *not* moderate automatically because reports are easy to game.
 *
 * That cuts both ways, and this file holds both halves. Writing a report is
 * the easy half. Reading other people's is where the care goes — a count of
 * strangers means nothing, so the only reports acted on here are ones from
 * people the reader already follows, and even then the strongest automatic
 * response is a blur that a click removes.
 */

export const REPORT_KIND = 1984;

/** NIP-56 report categories, with wording a reader can actually choose between. */
export const REPORT_TYPES = [
  {
    value: 'spam',
    label: 'Spam',
    description: 'Unsolicited, repetitive or automated posting.',
  },
  {
    value: 'nudity',
    label: 'Nudity or sexual content',
    description: 'Explicit imagery posted without a content warning.',
  },
  {
    value: 'profanity',
    label: 'Profanity or hateful speech',
    description: 'Slurs, harassment or abuse directed at someone.',
  },
  {
    value: 'illegal',
    label: 'Illegal content',
    description: 'Content that is unlawful where it was published.',
  },
  {
    value: 'impersonation',
    label: 'Impersonation',
    description: 'Pretending to be someone else.',
  },
  {
    value: 'malware',
    label: 'Malware',
    description: 'Links that install or run hostile software.',
  },
  {
    value: 'other',
    label: 'Something else',
    description: "Doesn't fit any of the above.",
  },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]['value'];

const KNOWN_TYPES = new Set<string>(REPORT_TYPES.map((entry) => entry.value));

/** Only meaningful about a person, never about a note. */
export const PROFILE_ONLY_TYPES: ReadonlySet<ReportType> = new Set([
  'impersonation',
]);

const NOS_ONTOLOGY = 'social.nos.ontology';

/**
 * Ontology codes for report types, as NIP-32 labels.
 *
 * Only nudity is here, because `NS-nud` is the only code from
 * `social.nos.ontology` written down anywhere — it is the single example given
 * in both NIP-36 and NIP-56, and the rest of that vocabulary is not published.
 * Inventing plausible-looking siblings (`NS-vio`, `NS-spm`) would put codes on
 * the wire that no reader can resolve, which is worse than omitting a tag the
 * spec only says MAY.
 */
const ONTOLOGY_CODES: Partial<Record<ReportType, string>> = {
  nudity: 'NS-nud',
};

/** A file inside a reported event, identified the way NIP-94/NIP-92 identify one. */
export interface ReportBlob {
  /** The blob's sha256, from an `imeta x` field or a bare `x` tag. */
  hash: string;
  /** Where it was served from, so a moderator can fetch it without the note. */
  server?: string;
  /** For the picker; never published. */
  url?: string;
}

export interface ReportInput {
  pubkey: string;
  eventId?: string;
  kind?: number;
  type: ReportType;
  /** One specific file in the event, rather than the whole note. */
  blob?: ReportBlob;
}

/**
 * Tags for a NIP-56 report.
 *
 * The reported author is always tagged — that is the one tag the spec makes
 * unconditional — and the note as well when one is named. A moderator seeing
 * only a `p` tag can act on the account; seeing an `e` tag too tells them
 * which post prompted it.
 *
 * The type goes on the tag "being reported", and only that one. This used to
 * be stamped on `p` as well, which quietly turned "this post is nudity" into
 * "this account is nudity" — two very different claims, and the spec's own
 * example leaves `p` bare for exactly that reason:
 *
 *     ["e", "<eventId>", "illegal"],
 *     ["p", "<pubkey>"]
 *
 * It mattered beyond tidiness: a profile-level claim is what the NIP's
 * suggested blur reads, so three friends reporting three separate posts used
 * to cover everything the author had ever posted.
 *
 * A blob report is the precise form: "this image is malware", not "this person
 * posts malware". The spec makes the `e` tag mandatory whenever `x` is present,
 * because a hash with no event is unresolvable — nobody can find the file to
 * look at it. So a blob without an event is dropped rather than published as a
 * report that cannot be checked.
 */
export function buildReportTags(input: ReportInput): string[][] {
  const hash = input.eventId ? input.blob?.hash?.trim().toLowerCase() : undefined;

  /*
   * Bare whenever something more specific is named. A report with no `e` is a
   * report about the person, and then `p` is the tag being reported.
   */
  const tags: string[][] = [
    input.eventId ? ['p', input.pubkey] : ['p', input.pubkey, input.type],
  ];

  if (input.eventId) {
    /*
     * Typed even when a blob is named, following the spec's malware example,
     * which types both: the hash says which file, the event says where to
     * find it, and a moderator reaching either should learn what the claim is.
     */
    tags.push(['e', input.eventId, input.type]);

    if (typeof input.kind === 'number') {
      tags.push(['k', String(input.kind)]);
    }

    if (hash) {
      tags.push(['x', hash, input.type]);

      const server = input.blob?.server?.trim();
      if (server) tags.push(['server', server]);
    }
  }

  /**
   * The label pair from NIP-32, when the type has a published code. The `L`
   * declaration and the namespace on the `l` tag are both written: a bare
   * `["l", "NS-nud"]` belongs to no vocabulary, and a reader has no way to
   * tell whose "NS-nud" it is.
   */
  const code = ONTOLOGY_CODES[input.type];

  if (code) {
    tags.push(['L', NOS_ONTOLOGY]);
    tags.push(['l', code, NOS_ONTOLOGY]);
  }

  return tags;
}

/**
 * The origin server for a blob, taken from where it was actually served.
 *
 * Blossom and NIP-96 both serve a blob at `<host>/<sha256>`, so the host is
 * what a moderator needs and the full URL is what the client has. Falling back
 * to the whole URL is fine — the tag is a pointer, and a working pointer with
 * extra path is better than a truncated one.
 */
export function blobServer(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The files attached to an event, as reportable blobs.
 *
 * Reads `imeta` tags (NIP-92) first, since that is where a hash lives next to
 * the URL it belongs to. Bare `x` tags are not read as attachments: on most
 * kinds `x` means something else entirely, and guessing wrong would offer a
 * reader a file that is not there.
 */
export function reportableBlobs(event: NostrEvent): ReportBlob[] {
  const found: ReportBlob[] = [];
  const seen = new Set<string>();

  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;

    let url: string | undefined;
    let hash: string | undefined;

    for (const part of tag.slice(1)) {
      const space = part.indexOf(' ');
      if (space === -1) continue;

      const key = part.slice(0, space);
      const value = part.slice(space + 1).trim();
      if (!value) continue;

      if (key === 'url' && !url) url = value;
      else if (key === 'x' && !hash) hash = value;
    }

    if (!hash || seen.has(hash)) continue;
    seen.add(hash);

    found.push({ hash, url, server: url ? blobServer(url) : undefined });
  }

  return found;
}

/** What a report event says, once read. */
export interface ParsedReport {
  event: NostrEvent;
  reporter: string;
  /**
   * The reported account.
   *
   * The spec makes `p` a MUST, and its own malware example then omits it — so
   * this is optional on the way in. A report naming only a note is still
   * evidence about that note.
   */
  pubkey?: string;
  eventId?: string;
  blobHash?: string;
  type: ReportType;
  /**
   * Whether this is a claim about the account rather than one of its posts.
   *
   * The distinction the NIP's client-behavior section rests on: "if 3+ of your
   * friends report a *profile* for nudity". Three reports of three different
   * posts are not that, and treating them as one covers everything an author
   * has ever posted on the strength of three posts.
   */
  aboutProfile: boolean;
  /** The reporter's own words, when they wrote any. */
  note?: string;
}

function readType(value: string | undefined): ReportType {
  const lowered = value?.trim().toLowerCase() ?? '';
  return KNOWN_TYPES.has(lowered) ? (lowered as ReportType) : 'other';
}

/**
 * Reads a report, or returns null when it is not usable.
 *
 * The type is taken from whichever tag carries one, because clients differ
 * about where they put it and the spec's own examples are inconsistent: the
 * `illegal` example types the `e` tag and leaves `p` bare, while the nudity
 * example types `p`. Reading only one position would silently mis-file half
 * the reports on the network as "other".
 *
 * A report naming no account at all is still read. `p` is a MUST that the
 * spec's own malware example does not keep, so requiring it would throw away
 * exactly the reports the NIP demonstrates.
 */
export function parseReport(event: NostrEvent): ParsedReport | null {
  if (event.kind !== REPORT_KIND) return null;

  let pubkey: string | undefined;
  let eventId: string | undefined;
  let blobHash: string | undefined;
  let type: ReportType | undefined;

  for (const [name, value, third] of event.tags) {
    if (!value) continue;

    if (name === 'p' && !pubkey && /^[0-9a-f]{64}$/i.test(value)) {
      pubkey = value.toLowerCase();
      type ??= third ? readType(third) : undefined;
    } else if (name === 'e' && !eventId && /^[0-9a-f]{64}$/i.test(value)) {
      eventId = value.toLowerCase();
      type ??= third ? readType(third) : undefined;
    } else if (name === 'x' && !blobHash) {
      blobHash = value.toLowerCase();
      type ??= third ? readType(third) : undefined;
    }
  }

  // Something has to be reported, even if the spec's required `p` is missing
  if (!pubkey && !eventId && !blobHash) return null;

  /*
   * A report of its own author is dropped. That is either a mistake or an
   * attempt to pad somebody else's count, and it is never information.
   */
  if (pubkey && pubkey === event.pubkey) return null;

  return {
    event,
    reporter: event.pubkey,
    pubkey,
    eventId,
    blobHash,
    type: type ?? 'other',
    aboutProfile: !eventId && !blobHash,
    note: event.content.trim() || undefined,
  };
}

/** Reports about one target, counted by distinct reporter. */
export interface ReportSummary {
  /** What this summary is about, which decides how it may be acted on. */
  scope: 'pubkey' | 'event' | 'blob';
  /** Distinct reporters per type. */
  counts: Partial<Record<ReportType, number>>;
  /**
   * The same, counting only reports about the account itself.
   *
   * Empty for an event or blob summary, where every report named the thing it
   * is keyed by. It exists so the one automatic response in the NIP can ask
   * the question the NIP actually asks — see `shouldBlurMedia`.
   */
  profileCounts: Partial<Record<ReportType, number>>;
  /** Distinct reporters overall — never the sum of `counts`. */
  reporters: string[];
  /** The loudest type, by reporter count. */
  leading: ReportType;
  /** Anything the reporters wrote, for a reader who opens the details. */
  notes: string[];
}

/**
 * The number of following-list reports that changes how something is shown.
 *
 * Three, which is the spec's own example ("if 3+ of your friends report a
 * profile for nudity"). Picking it from the NIP rather than inventing one
 * matters less for the number itself than for it being a number somebody can
 * argue with — one friend is an opinion, and a threshold makes that explicit
 * instead of leaving it to whoever tuned a constant.
 */
export const REPORT_THRESHOLD = 3;

class Tally {
  readonly perType = new Map<ReportType, Set<string>>();
  readonly perTypeAboutProfile = new Map<ReportType, Set<string>>();
  readonly all = new Set<string>();
  readonly notes: string[] = [];

  add(report: ParsedReport): void {
    const existing = this.perType.get(report.type) ?? new Set<string>();

    /**
     * Counted per reporter, not per event. Somebody who files the same report
     * five times is one person who thinks so, and counting events would let a
     * single account reach any threshold alone.
     */
    if (!existing.has(report.reporter)) {
      existing.add(report.reporter);
      this.perType.set(report.type, existing);

      if (report.note) this.notes.push(report.note);
    }

    if (report.aboutProfile) {
      const profile =
        this.perTypeAboutProfile.get(report.type) ?? new Set<string>();
      profile.add(report.reporter);
      this.perTypeAboutProfile.set(report.type, profile);
    }

    this.all.add(report.reporter);
  }

  summarise(scope: ReportSummary['scope']): ReportSummary {
    const tally = (source: Map<ReportType, Set<string>>) => {
      const counts: Partial<Record<ReportType, number>> = {};
      for (const [type, reporters] of source) counts[type] = reporters.size;
      return counts;
    };

    const counts = tally(this.perType);
    let leading: ReportType = 'other';
    let best = 0;

    for (const [type, reporters] of this.perType) {
      if (reporters.size > best) {
        best = reporters.size;
        leading = type;
      }
    }

    return {
      scope,
      counts,
      profileCounts: tally(this.perTypeAboutProfile),
      reporters: [...this.all],
      leading,
      notes: this.notes,
    };
  }
}

export interface ReportIndex {
  /** Keyed by reported pubkey. */
  byPubkey: Map<string, ReportSummary>;
  /** Keyed by reported event id. */
  byEvent: Map<string, ReportSummary>;
  /** Keyed by reported blob hash. */
  byBlob: Map<string, ReportSummary>;
}

export const EMPTY_REPORT_INDEX: ReportIndex = {
  byPubkey: new Map(),
  byEvent: new Map(),
  byBlob: new Map(),
};

/**
 * Groups reports by what they are about.
 *
 * `viewer` is excluded as a *target*, not as a reporter. Covering somebody's
 * own posts because three of the people they follow reported them would be a
 * strange thing to do to a reader — they cannot act on it, and it reads as the
 * app taking a side in an argument it should only be relaying.
 */
export function indexReports(
  events: NostrEvent[],
  options: { viewer?: string } = {}
): ReportIndex {
  const byPubkey = new Map<string, Tally>();
  const byEvent = new Map<string, Tally>();
  const byBlob = new Map<string, Tally>();

  const into = (map: Map<string, Tally>, key: string, report: ParsedReport) => {
    const tally = map.get(key) ?? new Tally();
    tally.add(report);
    map.set(key, tally);
  };

  for (const event of events) {
    const report = parseReport(event);
    if (!report) continue;
    if (options.viewer && report.pubkey === options.viewer) continue;

    // A report may name no account at all — the spec's own malware example
    // does not, and it is still evidence about the blob and the event
    if (report.pubkey) into(byPubkey, report.pubkey, report);
    if (report.eventId) into(byEvent, report.eventId, report);
    if (report.blobHash) into(byBlob, report.blobHash, report);
  }

  const collapse = (map: Map<string, Tally>, scope: ReportSummary['scope']) =>
    new Map([...map].map(([key, tally]) => [key, tally.summarise(scope)]));

  return {
    byPubkey: collapse(byPubkey, 'pubkey'),
    byEvent: collapse(byEvent, 'event'),
    byBlob: collapse(byBlob, 'blob'),
  };
}

/** Reporters who agree on one type. */
export function agreementOn(
  summary: ReportSummary | undefined,
  type: ReportType
): number {
  return summary?.counts[type] ?? 0;
}

/**
 * Whether enough followed accounts called something explicit to cover it.
 *
 * This is the one automatic response in the spec's client-behavior section,
 * and it is deliberately the only one taken here. Blurring is reversible with
 * a click and costs a reader nothing if the reports were wrong; hiding a post
 * or an account on the same evidence would make a gameable signal into a
 * silencing tool, which is exactly what the NIP warns relays away from.
 *
 * An account is covered only on reports about the account: "if 3+ of your
 * friends report a profile for nudity". Reports of particular posts still
 * cover those posts — they are keyed by event, and the summary for an event
 * has every one of its reports in `counts` — but three reports of three posts
 * no longer blur a decade of unrelated ones.
 */
export function shouldBlurMedia(summary: ReportSummary | undefined): boolean {
  if (!summary) return false;

  /*
   * An account is judged on what was said about the account. An event or a
   * blob is judged on everything, because every report in those summaries
   * named the thing they are keyed by.
   */
  const counts =
    summary.scope === 'pubkey' ? summary.profileCounts : summary.counts;

  return (counts.nudity ?? 0) >= REPORT_THRESHOLD;
}

/** Whether to say out loud that followed accounts have reported this. */
export function shouldWarn(summary: ReportSummary | undefined): boolean {
  if (!summary) return false;
  return summary.reporters.length >= REPORT_THRESHOLD;
}

const TYPE_LABELS = new Map<ReportType, string>(
  REPORT_TYPES.map((entry) => [entry.value, entry.label])
);

/** A sentence for a notice, in terms of who did the reporting. */
export function describeReports(summary: ReportSummary): string {
  const people = summary.reporters.length;
  const who = people === 1 ? '1 person you follow' : `${people} people you follow`;
  const label = TYPE_LABELS.get(summary.leading) ?? 'something else';

  return `${who} reported this as ${label.toLowerCase()}.`;
}
