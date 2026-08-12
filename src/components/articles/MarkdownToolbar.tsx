import {
  Bold,
  Code,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { MarkdownAction } from '@/lib/markdownEdit';

const BUTTONS: Array<{
  action: MarkdownAction;
  icon: typeof Bold;
  label: string;
  keys?: string;
}> = [
  { action: 'bold', icon: Bold, label: 'Bold', keys: '⌘B' },
  { action: 'italic', icon: Italic, label: 'Italic', keys: '⌘I' },
  { action: 'link', icon: Link2, label: 'Link', keys: '⌘K' },
  { action: 'h2', icon: Heading2, label: 'Heading' },
  { action: 'h3', icon: Heading3, label: 'Subheading' },
  { action: 'quote', icon: Quote, label: 'Quote' },
  { action: 'code', icon: Code, label: 'Code' },
  { action: 'bullets', icon: List, label: 'Bulleted list' },
  { action: 'numbers', icon: ListOrdered, label: 'Numbered list' },
  { action: 'rule', icon: Minus, label: 'Divider' },
];

interface MarkdownToolbarProps {
  onAction: (action: MarkdownAction) => void;
  onPickImage: () => void;
  isUploading?: boolean;
}

/**
 * Formatting, for people who do not write Markdown from memory.
 *
 * The editor asked for Markdown in a bare textarea, which is fine if you
 * already know it and a wall if you do not — and long-form is exactly where
 * someone who does not write it daily turns up. Every button is also a
 * keyboard shortcut, so knowing the syntax stays faster than reaching for the
 * mouse.
 */
export function MarkdownToolbar({
  onAction,
  onPickImage,
  isUploading,
}: MarkdownToolbarProps) {
  return (
    /*
     * Sticks below the app header while the body scrolls.
     *
     * A toolbar pinned to the top of a 420px-minimum textarea is off screen
     * by the second paragraph, which is precisely when somebody reaches for
     * a heading. Opaque rather than translucent, so the text does not show
     * through it as it passes underneath.
     */
    <div className="sticky top-[var(--header-height)] z-10 flex flex-wrap items-center gap-0.5 border-b bg-background px-2 py-1.5">
      {BUTTONS.map(({ action, icon: Icon, label, keys }) => (
        <Tooltip key={action}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              // Keeps the caret where it was: a button that steals focus
              // formats the selection and then loses it
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onAction(action)}
              aria-label={label}
            >
              <Icon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {label}
            {keys && (
              <span className="ml-2 text-muted-foreground">{keys}</span>
            )}
          </TooltipContent>
        </Tooltip>
      ))}

      <span className="mx-1 h-5 w-px bg-border" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onPickImage}
            disabled={isUploading}
            aria-label="Insert image"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Insert image</TooltipContent>
      </Tooltip>
    </div>
  );
}
