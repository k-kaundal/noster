import { useMemo } from 'react';
import { type NostrEvent } from '@nostrify/nostrify';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface NoteContentProps {
  event: NostrEvent;
  className?: string;
}

/** Parses content of text note events so that URLs, mentions, and hashtags are linkified. */
export function NoteContent({ event, className }: NoteContentProps) {
  const content = useMemo(() => {
    const text = event.content.trim(); // Remove leading/trailing whitespace

    // Enhanced regex to handle URLs, Nostr references, and hashtags
    const regex = /(https?:\/\/[^\s]+)|nostr:(npub1|note1|nprofile1|nevent1)([023456789acdefghjklmnpqrstuvwxyz]+)|(#\w+)/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyCounter = 0;

    while ((match = regex.exec(text)) !== null) {
      const [fullMatch, url, nostrPrefix, nostrData, hashtag] = match;
      const index = match.index;

      // Add text before this match, split by newlines
      if (index > lastIndex) {
        const beforeText = text.substring(lastIndex, index).split('\n');
        beforeText.forEach((line, i) => {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            parts.push(
              <p key={`text-${keyCounter++}-${i}`} className="mb-2 leading-relaxed text-base">
                {trimmedLine}
              </p>
            );
          }
        });
      }

      if (url) {
        // Handle URLs with truncation and better styling
        parts.push(
          <a
            key={`url-${keyCounter++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline underline-offset-2 break-words"
          >
            {url.length > 50 ? `${url.slice(0, 50)}…` : url}
          </a>
        );
      } else if (nostrPrefix && nostrData) {
        // Handle Nostr references
        try {
          const nostrId = `${nostrPrefix}${nostrData}`;
          const decoded = nip19.decode(nostrId);

          if (decoded.type === 'npub') {
            const pubkey = decoded.data;
            parts.push(<NostrMention key={`mention-${keyCounter++}`} pubkey={pubkey} />);
          } else {
            parts.push(
              <Link
                key={`nostr-${keyCounter++}`}
                to={`/${nostrId}`}
                className="text-blue-600 hover:text-blue-800 underline underline-offset-2"
              >
                {fullMatch}
              </Link>
            );
          }
        } catch {
          parts.push(fullMatch);
        }
      } else if (hashtag) {
        // Handle hashtags with improved styling
        const tag = hashtag.slice(1);
        parts.push(
          <Link
            key={`hashtag-${keyCounter++}`}
            to={`/t/${tag}`}
            className="text-blue-600 hover:text-blue-800 underline underline-offset-2"
          >
            {hashtag}
          </Link>
        );
      }

      lastIndex = index + fullMatch.length;
    }

    // Add any remaining text, split by newlines
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex).split('\n');
      remainingText.forEach((line, i) => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          parts.push(
            <p key={`text-${keyCounter++}-${i}`} className="mb-2 leading-relaxed text-base">
              {trimmedLine}
            </p>
          );
        }
      });
    }

    // If no special content was found, use plain text with paragraphs
    if (parts.length === 0) {
      return text.split('\n').map((line, i) => (
        line.trim() && (
          <p key={i} className="mb-2 leading-relaxed text-base">
            {line.trim()}
          </p>
        )
      ));
    }

    return parts;
  }, [event]);

  return <div className={cn("prose prose-sm max-w-none", className)}>{content}</div>;
}

// Helper component to display user mentions
function NostrMention({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const hasRealName = !!author.data?.metadata?.name;
  const displayName = author.data?.metadata?.name ?? genUserName(pubkey);

  return (
    <Link
      to={`/${npub}`}
      className={cn(
        "font-medium hover:underline",
        hasRealName ? "text-blue-600 hover:text-blue-800" : "text-gray-500 hover:text-gray-700"
      )}
    >
      @{displayName}
    </Link>
  );
}