import { useEffect, useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useAuthors } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import {
  applyMention,
  findMentionQuery,
  rankMentions,
  type MentionQuery,
} from '@/lib/mention';
import { cn } from '@/lib/utils';

interface Candidate {
  pubkey: string;
  displayName: string;
  name?: string;
  nip05?: string;
  picture?: string;
}

interface MentionAutocompleteProps {
  /** The textarea's current value. */
  value: string;
  textarea: HTMLTextAreaElement | null;
  onSelect: (next: string, caret: number) => void;
}

/**
 * Typeahead for `@` mentions, drawn from the people you follow.
 *
 * Only your follows, deliberately: a relay-wide search would need a query on
 * every keystroke and would surface strangers ahead of the people you actually
 * talk to.
 */
export function MentionAutocomplete({
  value,
  textarea,
  onSelect,
}: MentionAutocompleteProps) {
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey ?? '');

  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);

  // The caret only moves in response to input or navigation, both of which
  // reach the textarea before this runs.
  useEffect(() => {
    if (!textarea) return;

    const sync = () => {
      const caret = textarea.selectionStart ?? 0;
      setQuery(findMentionQuery(textarea.value, caret));
      setActive(0);
    };

    textarea.addEventListener('input', sync);
    textarea.addEventListener('keyup', sync);
    textarea.addEventListener('click', sync);
    textarea.addEventListener('blur', () => setQuery(null));

    return () => {
      textarea.removeEventListener('input', sync);
      textarea.removeEventListener('keyup', sync);
      textarea.removeEventListener('click', sync);
    };
  }, [textarea]);

  const pubkeys = useMemo(
    () => followingList.map((follow) => follow.pubkey).slice(0, 300),
    [followingList]
  );

  const candidates = useProfileCandidates(pubkeys, !!query);
  const matches = useMemo(
    () => (query ? rankMentions(candidates, query.term) : []),
    [candidates, query]
  );

  const choose = (candidate: Candidate) => {
    if (!query) return;
    const result = applyMention(
      value,
      query,
      nip19.npubEncode(candidate.pubkey)
    );
    setQuery(null);
    onSelect(result.text, result.caret);
  };

  // Arrow keys and Enter belong to the list while it is open
  useEffect(() => {
    if (!textarea || !matches.length) return;

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActive((index) => (index + 1) % matches.length);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActive((index) => (index - 1 + matches.length) % matches.length);
          break;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          choose(matches[active]);
          break;
        case 'Escape':
          event.preventDefault();
          setQuery(null);
          break;
      }
    };

    textarea.addEventListener('keydown', onKeyDown);
    return () => textarea.removeEventListener('keydown', onKeyDown);
  });

  if (!query || !matches.length) return null;

  return (
    <ul
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-float scrollbar-thin"
    >
      {matches.map((candidate, index) => (
        <li key={candidate.pubkey}>
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            // A click would blur the textarea first and close the list
            onMouseDown={(event) => {
              event.preventDefault();
              choose(candidate);
            }}
            onMouseEnter={() => setActive(index)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
              index === active && 'bg-accent'
            )}
          >
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={candidate.picture} alt="" />
              <AvatarFallback className="text-[10px]">
                {candidate.displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {candidate.displayName}
              </span>
              {candidate.nip05 && (
                <span className="block truncate text-xs text-muted-foreground">
                  {candidate.nip05}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Profile metadata for the follow list. Loading is deferred until the picker
 * is actually open, so opening the composer costs nothing.
 */
function useProfileCandidates(
  pubkeys: string[],
  enabled: boolean
): Candidate[] {
  const authors = useAuthors(pubkeys, enabled);

  return useMemo(
    () =>
      authors.map(({ pubkey, metadata }) => ({
        pubkey,
        displayName:
          metadata?.display_name || metadata?.name || genUserName(pubkey),
        name: metadata?.name,
        nip05: metadata?.nip05,
        picture: metadata?.picture,
      })),
    [authors]
  );
}
