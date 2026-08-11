/**
 * A small syntax highlighter.
 *
 * Written here rather than pulled in because a highlighting library is a large
 * dependency for one card, and because the useful part of highlighting a
 * snippet is small: comments, strings, numbers and keywords carry nearly all
 * of the legibility. Languages this does not know fall back to plain
 * monospace, which is what an unknown language should look like anyway.
 *
 * The one invariant that matters: the tokens must concatenate back to exactly
 * the input. A highlighter that drops a character or collapses whitespace has
 * altered somebody's code on its way to being read — which is worse than not
 * colouring it at all, and silent. Every path below either consumes input into
 * a token or advances one character into `plain`; nothing is skipped.
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword';

export interface Token {
  kind: TokenKind;
  text: string;
}

interface LanguageRules {
  lineComments: string[];
  blockComment?: [string, string];
  /** Quote characters that open a string. */
  quotes: string[];
  keywords: Set<string>;
}

const C_KEYWORDS =
  'break case catch class const continue default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield async await';

const RULES: Record<string, LanguageRules> = {
  javascript: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
    keywords: new Set(C_KEYWORDS.split(' ')),
  },
  typescript: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'", '`'],
    keywords: new Set(
      `${C_KEYWORDS} type namespace declare readonly abstract as satisfies keyof infer never unknown any string number boolean`.split(
        ' '
      )
    ),
  },
  python: {
    lineComments: ['#'],
    quotes: ['"', "'"],
    keywords: new Set(
      'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self'.split(
        ' '
      )
    ),
  },
  rust: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"'],
    keywords: new Set(
      'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(
        ' '
      )
    ),
  },
  go: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', '`'],
    keywords: new Set(
      'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'.split(
        ' '
      )
    ),
  },
  ruby: {
    lineComments: ['#'],
    quotes: ['"', "'"],
    keywords: new Set(
      'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield'.split(
        ' '
      )
    ),
  },
  java: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    keywords: new Set(
      'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while true false null'.split(
        ' '
      )
    ),
  },
  c: {
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    keywords: new Set(
      'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while'.split(
        ' '
      )
    ),
  },
  bash: {
    lineComments: ['#'],
    quotes: ['"', "'"],
    keywords: new Set(
      'if then else elif fi case esac for while until do done function in return local export source alias set unset echo cd exit'.split(
        ' '
      )
    ),
  },
  sql: {
    lineComments: ['--'],
    blockComment: ['/*', '*/'],
    quotes: ["'", '"'],
    keywords: new Set(
      'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET AND OR NOT NULL AS DISTINCT UNION ALL PRIMARY KEY FOREIGN REFERENCES DEFAULT'.split(
        ' '
      )
    ),
  },
  json: {
    lineComments: [],
    quotes: ['"'],
    keywords: new Set(['true', 'false', 'null']),
  },
  yaml: {
    lineComments: ['#'],
    quotes: ['"', "'"],
    keywords: new Set(['true', 'false', 'null', 'yes', 'no']),
  },
  css: {
    lineComments: [],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    keywords: new Set([]),
  },
};

/** Languages that share another's rules closely enough to reuse them. */
const ALIASES: Record<string, string> = {
  jsx: 'javascript',
  tsx: 'typescript',
  cpp: 'c',
  csharp: 'java',
  php: 'c',
  swift: 'rust',
  kotlin: 'java',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  scss: 'css',
  toml: 'yaml',
};

export function supportsHighlighting(language: string | undefined): boolean {
  if (!language) return false;
  const key = language.toLowerCase();
  return !!(RULES[key] ?? RULES[ALIASES[key] ?? '']);
}

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * Splits code into coloured spans.
 *
 * Unterminated strings and comments run to the end of the input rather than
 * being rejected — a snippet is often a fragment, and refusing to highlight
 * one because it stops mid-string would fail on exactly the excerpts people
 * paste.
 */
export function tokenize(code: string, language?: string): Token[] {
  const key = language?.toLowerCase() ?? '';
  const rules = RULES[key] ?? RULES[ALIASES[key] ?? ''];

  if (!rules) return code ? [{ kind: 'plain', text: code }] : [];

  const tokens: Token[] = [];
  let plain = '';

  const flush = () => {
    if (plain) {
      tokens.push({ kind: 'plain', text: plain });
      plain = '';
    }
  };

  const push = (kind: TokenKind, text: string) => {
    flush();
    tokens.push({ kind, text });
  };

  let index = 0;

  while (index < code.length) {
    const rest = code.slice(index);

    const lineComment = rules.lineComments.find((marker) =>
      rest.startsWith(marker)
    );

    if (lineComment) {
      const end = code.indexOf('\n', index);
      const stop = end === -1 ? code.length : end;
      push('comment', code.slice(index, stop));
      index = stop;
      continue;
    }

    if (rules.blockComment && rest.startsWith(rules.blockComment[0])) {
      const [open, close] = rules.blockComment;
      const found = code.indexOf(close, index + open.length);
      const stop = found === -1 ? code.length : found + close.length;
      push('comment', code.slice(index, stop));
      index = stop;
      continue;
    }

    const quote = rules.quotes.find((mark) => rest.startsWith(mark));

    if (quote) {
      let cursor = index + quote.length;

      while (cursor < code.length) {
        // A backslash escapes the next character, including the closing quote
        if (code[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (code.startsWith(quote, cursor)) {
          cursor += quote.length;
          break;
        }
        cursor += 1;
      }

      // `cursor` can overshoot when the last character is a lone backslash
      const stop = Math.min(cursor, code.length);
      push('string', code.slice(index, stop));
      index = stop;
      continue;
    }

    const char = code[index];

    if (DIGIT.test(char)) {
      let cursor = index;
      while (cursor < code.length && /[0-9a-fA-FxXoObB._]/.test(code[cursor])) {
        cursor += 1;
      }
      push('number', code.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (IDENTIFIER_START.test(char)) {
      let cursor = index;
      while (cursor < code.length && IDENTIFIER_PART.test(code[cursor])) {
        cursor += 1;
      }

      const word = code.slice(index, cursor);

      // SQL keywords are conventionally written in either case
      if (rules.keywords.has(word) || rules.keywords.has(word.toUpperCase())) {
        push('keyword', word);
      } else {
        plain += word;
      }

      index = cursor;
      continue;
    }

    plain += char;
    index += 1;
  }

  flush();
  return tokens;
}
