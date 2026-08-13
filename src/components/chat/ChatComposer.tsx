import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

/** Roughly five lines, after which the box scrolls instead of growing. */
const MAX_HEIGHT_PX = 132;

interface ChatComposerProps {
  placeholder: string;
  isSending: boolean;
  /** Resolves false when the send failed, so the draft can be put back. */
  onSend: (content: string) => Promise<boolean>;
}

/**
 * Writing a message, on a phone as much as a keyboard.
 *
 * The box grows with the message rather than scrolling a single line, because
 * a paragraph typed into a 42px slot cannot be re-read before sending — and
 * on a phone re-reading before sending is most of what the box is for.
 */
export function ChatComposer({
  placeholder,
  isSending,
  onSend,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  /*
   * Height is measured rather than counted. Wrapping depends on the width of
   * the words, so a newline count gets a long unbroken URL wrong in the
   * direction that hides text.
   */
  const resize = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, []);

  useEffect(resize, [draft, resize]);

  const submit = useCallback(async () => {
    const content = draft.trim();
    if (!content || isSending) return;

    // Cleared optimistically, and restored if the relays refuse it
    setDraft('');
    const sent = await onSend(content);
    if (!sent) setDraft(content);
  }, [draft, isSending, onSend]);

  return (
    <div className="flex items-end gap-2">
      <Textarea
        ref={inputRef}
        value={draft}
        onChange={(field) => setDraft(field.target.value)}
        onKeyDown={(key) => {
          if (key.key !== 'Enter' || key.shiftKey) return;

          /*
           * Never mid-composition. On a Japanese, Chinese or Korean keyboard
           * Enter commits the candidate being typed, and sending there
           * dispatches a half-finished word.
           */
          if (key.nativeEvent.isComposing) return;

          /*
           * On a phone Enter is the return key, and people use it for a new
           * line — there is a send button right there. Sending on it turns
           * every paragraph break into a message.
           */
          if (isMobile) return;

          key.preventDefault();
          void submit();
        }}
        placeholder={placeholder}
        aria-label="Message"
        rows={1}
        /*
         * `enterKeyHint` relabels the phone's return key, and the autocorrect
         * settings are the ones a messaging app wants: fix typos, capitalise
         * sentences, but never guess at a name or an npub.
         */
        enterKeyHint={isMobile ? 'enter' : 'send'}
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck
        className={cn(
          'max-h-[132px] min-h-[44px] flex-1 resize-none overflow-y-auto py-3 scrollbar-thin',
          // 16px on touch, or iOS zooms the whole page in on focus
          'text-base sm:text-sm'
        )}
      />

      <Button
        onClick={() => void submit()}
        disabled={!draft.trim() || isSending}
        size="icon"
        // 44px is the smallest target iOS calls reliable, and Android asks 48
        className="h-11 w-11 shrink-0 rounded-full"
        aria-label="Send message"
      >
        {isSending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
