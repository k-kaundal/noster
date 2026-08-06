import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface UseKeyboardShortcutsProps {
  onSearch?: () => void;
  onHelp?: () => void;
}

/** Window for the two-key "g …" sequences, in milliseconds. */
const CHORD_TIMEOUT = 1000;

export function useKeyboardShortcuts({
  onSearch,
  onHelp,
}: UseKeyboardShortcutsProps = {}) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const pendingChord = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore while typing, and let the browser keep its own modifier combos
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onSearch?.();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();

      // "g" prefixed sequences, e.g. g then p for profile
      const chord = pendingChord.current;
      if (chord && Date.now() - chord.at < CHORD_TIMEOUT) {
        pendingChord.current = null;
        if (chord.key === 'g') {
          event.preventDefault();
          switch (key) {
            case 'h':
              navigate('/');
              return;
            case 'e':
              navigate('/explore');
              return;
            case 't':
              navigate('/trending');
              return;
            case 'r':
              navigate('/relays');
              return;
            case 'v':
              navigate('/reels');
              return;
            case 'b':
              navigate('/bookmarks');
              return;
            case 'p':
              if (user) navigate(`/${nip19.npubEncode(user.pubkey)}`);
              return;
            default:
              return;
          }
        }
      }

      if (key === 'g') {
        pendingChord.current = { key: 'g', at: Date.now() };
        return;
      }

      switch (key) {
        case '/':
          event.preventDefault();
          onSearch?.();
          break;
        case 'h':
          navigate('/');
          break;
        case 't':
          navigate('/trending');
          break;
        case 'e':
          navigate('/explore');
          break;
        case 'r':
          navigate('/relays');
          break;
        case 'v':
          navigate('/reels');
          break;
        case 'b':
          navigate('/bookmarks');
          break;
        case 'c':
          navigate('/compose');
          break;
        case '?':
          event.preventDefault();
          onHelp?.();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, onSearch, onHelp, user]);
}
