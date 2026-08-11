import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-C0: code snippets, kind 1337.
 *
 * The content is the code, verbatim. Everything that makes it presentable —
 * which language, what file it came from, what it needs to run — lives in
 * tags, which is what separates this from posting a fenced block in a kind 1:
 * the language is a fact about the event rather than three backticks a reader
 * has to trust.
 */

export const SNIPPET_KIND = 1337;

export interface SnippetLicense {
  /** SPDX short identifier, e.g. `MIT`, `GPL-3.0-or-later`. */
  id: string;
  /** Optional reference to the licence text. */
  url?: string;
}

export interface SnippetRepo {
  /** A plain URL, when that is what was given. */
  url?: string;
  /** A NIP-34 announcement coordinate: `30617:<pubkey>:<d>`. */
  address?: string;
  relay?: string;
}

export interface CodeSnippet {
  code: string;
  /** Lowercased language name. */
  language?: string;
  /** Usually a filename. */
  name?: string;
  /** Without the leading dot. */
  extension?: string;
  description?: string;
  runtime?: string;
  /** Repeatable: a snippet may be offered under several licences. */
  licenses: SnippetLicense[];
  dependencies: string[];
  repo?: SnippetRepo;
  event: NostrEvent;
}

function firstValue(event: NostrEvent, name: string): string | undefined {
  const value = event.tags.find(([key]) => key === name)?.[1]?.trim();
  return value || undefined;
}

/** `30617:<64 hex>:<identifier>` — a NIP-34 repository announcement. */
const REPO_ADDRESS = /^30617:[0-9a-f]{64}:/i;

function parseRepo(event: NostrEvent): SnippetRepo | undefined {
  const tag = event.tags.find(([name, value]) => name === 'repo' && !!value);
  if (!tag) return undefined;

  const value = tag[1].trim();
  const relay = tag[2]?.trim() || undefined;

  /**
   * "This MUST be either a standard URL or, alternatively, the address of a
   * NIP-34 Git repository announcement event." Told apart by shape, since
   * both arrive in the same position — and getting it wrong renders a
   * coordinate as a broken hyperlink.
   */
  return REPO_ADDRESS.test(value)
    ? { address: value, relay }
    : { url: value, relay };
}

export function parseCodeSnippet(event: NostrEvent): CodeSnippet | null {
  if (event.kind !== SNIPPET_KIND) return null;

  const extension = firstValue(event, 'extension')
    ?.replace(/^\.+/, '')
    .toLowerCase();

  return {
    code: event.content,
    language: firstValue(event, 'l')?.toLowerCase(),
    name: firstValue(event, 'name'),
    extension: extension || undefined,
    description: firstValue(event, 'description'),
    runtime: firstValue(event, 'runtime'),
    licenses: event.tags
      .filter(([name, value]) => name === 'license' && !!value?.trim())
      .map(([, id, url]) => ({ id: id.trim(), url: url?.trim() || undefined })),
    dependencies: event.tags
      .filter(([name, value]) => name === 'dep' && !!value?.trim())
      .map(([, value]) => value.trim()),
    repo: parseRepo(event),
    event,
  };
}

export interface SnippetInput {
  code: string;
  language?: string;
  name?: string;
  extension?: string;
  description?: string;
  runtime?: string;
  licenses?: SnippetLicense[];
  dependencies?: string[];
  repo?: SnippetRepo;
}

export function buildSnippetTags(input: SnippetInput): string[][] {
  const tags: string[][] = [];

  const language = input.language?.trim().toLowerCase();
  if (language) tags.push(['l', language]);

  if (input.name?.trim()) tags.push(['name', input.name.trim()]);

  const extension = input.extension?.trim().replace(/^\.+/, '').toLowerCase();
  if (extension) tags.push(['extension', extension]);

  if (input.description?.trim()) {
    tags.push(['description', input.description.trim()]);
  }

  if (input.runtime?.trim()) tags.push(['runtime', input.runtime.trim()]);

  for (const licence of input.licenses ?? []) {
    const id = licence.id.trim();
    if (!id) continue;
    tags.push(licence.url ? ['license', id, licence.url] : ['license', id]);
  }

  for (const dependency of input.dependencies ?? []) {
    if (dependency.trim()) tags.push(['dep', dependency.trim()]);
  }

  if (input.repo?.address) {
    tags.push(
      input.repo.relay
        ? ['repo', input.repo.address, input.repo.relay]
        : ['repo', input.repo.address]
    );
  } else if (input.repo?.url?.trim()) {
    tags.push(['repo', input.repo.url.trim()]);
  }

  return tags;
}

/**
 * Language names by file extension, and the reverse.
 *
 * Both tags are optional and people fill in one or the other, so each is
 * inferred from whichever is present — a snippet named `quick-sort.py` with no
 * `l` tag should still be highlighted as Python.
 */
const BY_EXTENSION: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  html: 'html',
  css: 'css',
  scss: 'css',
  md: 'markdown',
  xml: 'xml',
};

const BY_LANGUAGE: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  rust: 'rs',
  go: 'go',
  ruby: 'rb',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  bash: 'sh',
  shell: 'sh',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  toml: 'toml',
  html: 'html',
  css: 'css',
  markdown: 'md',
  xml: 'xml',
};

/** The language to highlight as, from whichever tags were supplied. */
export function resolveLanguage(snippet: CodeSnippet): string | undefined {
  if (snippet.language) return snippet.language;
  if (snippet.extension) return BY_EXTENSION[snippet.extension];

  // A `name` is usually a filename, so its suffix is the last thing to try
  const suffix = snippet.name?.split('.').pop()?.toLowerCase();
  return suffix ? BY_EXTENSION[suffix] : undefined;
}

export function extensionFor(language: string | undefined): string | undefined {
  return language ? BY_LANGUAGE[language.toLowerCase()] : undefined;
}

/** Languages offered when composing, in the order they are shown. */
export const SNIPPET_LANGUAGES = Object.keys(BY_LANGUAGE);

/**
 * A filename to download the snippet as.
 *
 * The `name` tag when there is one, since it is usually already a filename.
 * Otherwise built from the extension, because "Download" that produces a file
 * the operating system cannot open is not the feature it appears to be.
 */
export function downloadFilename(snippet: CodeSnippet): string {
  if (snippet.name?.trim()) return snippet.name.trim();

  const extension = snippet.extension ?? extensionFor(resolveLanguage(snippet));
  return extension ? `snippet.${extension}` : 'snippet.txt';
}

/** Common SPDX identifiers, for the composer's picker. */
export const COMMON_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'GPL-3.0-or-later',
  'AGPL-3.0-or-later',
  'MPL-2.0',
  'Unlicense',
  'CC0-1.0',
];

/** Where to read an SPDX identifier's actual terms. */
export function licenseUrl(licence: SnippetLicense): string {
  return licence.url ?? `https://spdx.org/licenses/${licence.id}.html`;
}
