import { Link } from 'react-router-dom';
import { PenSquare } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';

/**
 * Compose shortcut for small screens. Desktop gets the button in the left rail,
 * so this is hidden from `lg` up and sits above the mobile tab bar.
 */
export function FloatingActionButton() {
  const { user } = useCurrentUser();

  if (!user) return null;

  return (
    <Button
      asChild
      size="icon"
      className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-brand-gradient shadow-lg transition-transform hover:scale-105 active:scale-95 lg:hidden"
    >
      <Link to="/compose" aria-label="Compose a new note">
        <PenSquare className="h-6 w-6" />
      </Link>
    </Button>
  );
}
