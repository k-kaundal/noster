import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface UseKeyboardShortcutsProps {
  onSearch?: () => void;
}

export function useKeyboardShortcuts({ onSearch }: UseKeyboardShortcutsProps = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target as HTMLElement)?.contentEditable === 'true'
      ) {
        return;
      }

      // Cmd/Ctrl + K for search
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        onSearch?.();
        return;
      }

      // Single key shortcuts
      switch (event.key) {
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
        case 'c':
          navigate('/compose');
          break;
        case '?':
          // Show help dialog (could be implemented later)
          console.log('Keyboard shortcuts: h=home, t=trending, e=explore, c=compose, /=search');
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, onSearch]);
}