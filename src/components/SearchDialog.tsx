import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { ArrowRight, FileText, Hash, Loader2, Search, User } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Detects a pasted NIP-19 identifier so it can be opened directly. */
function asNip19(query: string): string | null {
  const value = query.trim().replace(/^nostr:/, '');
  if (!/^(npub1|note1|nevent1|nprofile1|naddr1)/.test(value)) return null;
  try {
    nip19.decode(value);
    return value;
  } catch {
    return null;
  }
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const { data: results, isFetching } = useSearch(debouncedQuery);

  const identifier = useMemo(() => asNip19(query), [query]);
  const hashtag = query.trim().startsWith('#')
    ? query.trim().slice(1).toLowerCase()
    : null;

  // Reset between openings so an old query never greets the next search
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const close = () => onOpenChange(false);

  const go = (path: string) => {
    navigate(path);
    close();
  };

  const showResults = debouncedQuery.trim().length >= 2;
  const isEmpty =
    showResults &&
    !isFetching &&
    !results?.posts.length &&
    !results?.profiles.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Search Nostr
          </DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Search notes and people, or paste an npub / note ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (identifier) go(`/${identifier}`);
            else if (hashtag) go(`/t/${encodeURIComponent(hashtag)}`);
          }}
          autoFocus
        />

        <ScrollArea className="-mx-2 flex-1 px-2">
          <div className="space-y-5 pb-2">
            {identifier && (
              <button
                type="button"
                onClick={() => go(`/${identifier}`)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60"
              >
                <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    Open this Nostr identifier
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {identifier}
                  </span>
                </span>
              </button>
            )}

            {hashtag && (
              <button
                type="button"
                onClick={() => go(`/t/${encodeURIComponent(hashtag)}`)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60"
              >
                <Hash className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-medium">
                  Browse #{hashtag}
                </span>
              </button>
            )}

            {!showResults && !identifier && !hashtag && (
              <div className="space-y-2 py-10 text-center text-sm text-muted-foreground">
                <p>Type at least 2 characters to search.</p>
                <p className="text-xs">
                  Tip: paste an <code className="font-mono">npub</code> or{' '}
                  <code className="font-mono">note</code> ID to jump straight to
                  it, or start with <code className="font-mono">#</code> to
                  browse a hashtag.
                </p>
              </div>
            )}

            {showResults && isFetching && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            )}

            {showResults && !isFetching && results && (
              <>
                {results.profiles.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <User className="h-3.5 w-3.5" />
                      People
                    </h3>
                    {results.profiles.map((profile) => (
                      <ProfileResult
                        key={profile.id}
                        pubkey={profile.pubkey}
                        onSelect={close}
                      />
                    ))}
                  </section>
                )}

                {results.posts.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      Notes
                    </h3>
                    {results.posts.map((post) => (
                      <Post key={post.id} event={post} showReplies={false} />
                    ))}
                  </section>
                )}
              </>
            )}

            {isEmpty && !identifier && !hashtag && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No results for “{debouncedQuery}”. This relay may not support
                full-text search.
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ProfileResult({
  pubkey,
  onSelect,
}: {
  pubkey: string;
  onSelect: () => void;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <Link
      to={`/${nip19.npubEncode(pubkey)}`}
      onClick={onSelect}
      className="flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent/60"
    >
      <Avatar className="h-10 w-10">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-xs">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{displayName}</p>
          {metadata?.nip05 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              ✓
            </Badge>
          )}
        </div>
        {metadata?.about && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {metadata.about}
          </p>
        )}
      </div>
    </Link>
  );
}
