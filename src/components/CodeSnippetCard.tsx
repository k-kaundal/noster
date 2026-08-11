import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  Package,
  Scale,
  Terminal,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import {
  downloadFilename,
  licenseUrl,
  parseCodeSnippet,
  resolveLanguage,
  type CodeSnippet,
} from '@/lib/nipc0';
import { supportsHighlighting, tokenize, type TokenKind } from '@/lib/syntax';
import { cn } from '@/lib/utils';

/**
 * Colours per token kind.
 *
 * Given explicitly for both themes rather than through the palette tokens,
 * because these need to stay legible against the code block's own background
 * whatever accent the reader has picked.
 */
const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: '',
  comment: 'text-muted-foreground italic',
  string: 'text-emerald-700 dark:text-emerald-400',
  number: 'text-amber-700 dark:text-amber-400',
  keyword: 'text-violet-700 dark:text-violet-400',
};

/** A kind 1337, with the things NIP-C0 asks clients to provide. */
export function CodeSnippetCard({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const snippet = parseCodeSnippet(event);
  if (!snippet) return null;

  return <SnippetBody snippet={snippet} className={className} />;
}

function SnippetBody({
  snippet,
  className,
}: {
  snippet: CodeSnippet;
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const language = resolveLanguage(snippet);
  const tokens = tokenize(snippet.code, language);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Select the code and copy it manually.',
        variant: 'destructive',
      });
    }
  };

  /**
   * Downloaded as a Blob rather than a data URI: code runs to any length and
   * a data URI long enough to hold a file is refused by some browsers.
   */
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([snippet.code], { type: 'text/plain;charset=utf-8' })
    );

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadFilename(snippet);
    anchor.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn('overflow-hidden rounded-lg border', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

        {snippet.name ? (
          <span className="truncate font-mono text-xs font-medium">
            {snippet.name}
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            Code snippet
          </span>
        )}

        {/* "Display the language and extension prominently" */}
        {language && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {language}
          </Badge>
        )}
        {snippet.extension && snippet.extension !== language && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            .{snippet.extension}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={copy}
            aria-label="Copy the code"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success-strong" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={download}
            aria-label={`Download as ${downloadFilename(snippet)}`}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {snippet.description && (
        <p className="border-b bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          {snippet.description}
        </p>
      )}

      {/*
        `pre` keeps whitespace and indentation exactly as published, which is
        the one thing a code view must not get wrong. The tokens below rebuild
        the source character for character — see `lib/syntax`.
      */}
      <pre className="scrollbar-thin max-h-96 overflow-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono">
          {supportsHighlighting(language)
            ? tokens.map((token, index) => (
                <span key={index} className={TOKEN_CLASS[token.kind]}>
                  {token.text}
                </span>
              ))
            : snippet.code}
        </code>
      </pre>

      {(snippet.runtime ||
        snippet.dependencies.length > 0 ||
        snippet.licenses.length > 0 ||
        snippet.repo) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {snippet.runtime && (
            <span className="flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              {snippet.runtime}
            </span>
          )}

          {snippet.dependencies.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              {snippet.dependencies.join(', ')}
            </span>
          )}

          {/*
            Several licences means a choice, not a stack — "allowing recipients
            to use the code under any license of choosing among the referenced
            ones" — so they are joined with "or".
          */}
          {snippet.licenses.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5" />
              {snippet.licenses.map((licence, index) => (
                <span key={licence.id}>
                  {index > 0 && ' or '}
                  <a
                    href={licenseUrl(licence)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {licence.id}
                  </a>
                </span>
              ))}
            </span>
          )}

          <RepoLink snippet={snippet} />
        </div>
      )}
    </div>
  );
}

function RepoLink({ snippet }: { snippet: CodeSnippet }) {
  const repo = snippet.repo;
  if (!repo) return null;

  if (repo.address) {
    const [kind, pubkey, identifier] = repo.address.split(':');

    try {
      const naddr = nip19.naddrEncode({
        kind: Number.parseInt(kind, 10),
        pubkey,
        identifier: identifier ?? '',
        relays: repo.relay ? [repo.relay] : undefined,
      });

      return (
        <Link to={`/${naddr}`} className="hover:text-foreground hover:underline">
          {identifier || 'repository'}
        </Link>
      );
    } catch {
      return null;
    }
  }

  if (!repo.url) return null;

  let label = repo.url;
  try {
    label = new URL(repo.url).host;
  } catch {
    // Shown whole when it will not parse
  }

  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 hover:text-foreground hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
