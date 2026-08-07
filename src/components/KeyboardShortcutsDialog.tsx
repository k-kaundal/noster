import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['⌘', 'K'], description: 'Open search' },
  { keys: ['/'], description: 'Open search' },
  { keys: ['H'], description: 'Go home' },
  { keys: ['E'], description: 'Go to explore' },
  { keys: ['T'], description: 'Go to trending' },
  { keys: ['V'], description: 'Watch reels' },
  { keys: ['M'], description: 'Open messages' },
  { keys: ['B'], description: 'Open bookmarks' },
  { keys: ['R'], description: 'Manage relays' },
  { keys: ['C'], description: 'Compose a note' },
  { keys: ['G', 'P'], description: 'Go to your profile' },
  { keys: ['?'], description: 'Toggle this dialog' },
];

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are ignored while you're typing in a field.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y">
          {SHORTCUTS.map(({ keys, description }) => (
            <li
              key={`${keys.join('-')}-${description}`}
              className="flex items-center justify-between py-2.5 text-sm"
            >
              <span className="text-muted-foreground">{description}</span>
              <span className="flex items-center gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs font-medium"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
