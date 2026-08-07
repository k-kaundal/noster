import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { SmilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { useReactions } from '@/hooks/useReactions';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { QUICK_REACTIONS, type ReactionGroup } from '@/lib/reactions';
import { cn } from '@/lib/utils';

/** Emoji offered beyond the quick row, grouped roughly by sentiment. */
const EMOJI_SET = [
  '❤️', '🔥', '😂', '🤙', '👀', '🫂', '⚡', '🎉',
  '👍', '👏', '🙏', '💯', '🚀', '🧠', '💜', '😍',
  '🤔', '😢', '😱', '🤯', '🥹', '😴', '🤝', '☕',
  '🌱', '🎵', '📚', '🛠️', '🧡', '🥳', '✨', '🫡',
];

interface ReactionPickerProps {
  event: NostrEvent;
  className?: string;
}

/** Adds an arbitrary emoji reaction to a note. */
export function ReactionPicker({ event, className }: ReactionPickerProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { react, isReacting } = useReactions(event.id);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const choose = async (emoji: string) => {
    setOpen(false);
    setFilter('');

    if (!user) {
      toast({
        title: 'Login required',
        description: 'You must be logged in to react.',
        variant: 'destructive',
      });
      return;
    }

    await react({ targetEvent: event, emoji });
  };

  // A typed emoji is offered directly, so the grid isn't the only way in
  const typed = filter.trim();
  const isEmojiInput = typed.length > 0 && typed.length <= 4 && !/\w/.test(typed);
  const visible = isEmojiInput ? [typed, ...EMOJI_SET] : EMOJI_SET;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isReacting}
          aria-label="Add a reaction"
          className={cn(
            'press h-8 gap-1.5 rounded-full px-2 text-muted-foreground transition-colors hover:bg-like/10 hover:text-like',
            className
          )}
        >
          <SmilePlus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK_REACTIONS.map((emoji) => (
            <EmojiButton key={emoji} emoji={emoji} onSelect={choose} large />
          ))}
        </div>

        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Or paste any emoji…"
          aria-label="Emoji"
          className="mb-2 h-8"
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Enter' && isEmojiInput) {
              keyEvent.preventDefault();
              choose(typed);
            }
          }}
        />

        <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto scrollbar-thin">
          {visible.map((emoji, index) => (
            <EmojiButton
              key={`${emoji}-${index}`}
              emoji={emoji}
              onSelect={choose}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmojiButton({
  emoji,
  onSelect,
  large = false,
}: {
  emoji: string;
  onSelect: (emoji: string) => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(emoji)}
      aria-label={`React with ${emoji}`}
      className={cn(
        'flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-muted',
        large ? 'h-9 w-9 text-xl' : 'h-8 w-8 text-base'
      )}
    >
      {emoji}
    </button>
  );
}

/**
 * The emoji already left on a note, as tappable chips. Tapping one you have
 * already used withdraws it, which is what a filled chip implies.
 */
export function ReactionChips({
  event,
  groups,
  className,
}: {
  event: NostrEvent;
  groups: ReactionGroup[];
  className?: string;
}) {
  const { user } = useCurrentUser();
  const { react } = useReactions(event.id);

  // The heart is already counted by the like button beside these
  const visible = groups.filter((group) => group.emoji !== '❤️');
  if (!visible.length) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {visible.map((group) => (
        <button
          key={group.emoji}
          type="button"
          disabled={!user}
          onClick={() => react({ targetEvent: event, emoji: group.emoji })}
          aria-pressed={group.reacted}
          aria-label={`${group.emoji} ${group.count}`}
          className={cn(
            'press inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
            group.reacted
              ? 'border-primary/40 bg-primary/10 text-foreground'
              : 'border-border/70 text-muted-foreground hover:bg-accent'
          )}
        >
          {group.url ? (
            <img src={group.url} alt={group.emoji} className="h-4 w-4" />
          ) : (
            <span aria-hidden>{group.emoji}</span>
          )}
          <span className="tabular">{group.count}</span>
        </button>
      ))}
    </div>
  );
}
