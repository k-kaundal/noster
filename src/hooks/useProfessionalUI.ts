import { useLocalStorage } from '@/hooks/useLocalStorage';

/**
 * Hook to control whether professional UI components are enabled.
 * Users can opt-in to experimental enhanced UI features.
 */
export function useProfessionalUI() {
  const [enabled, setEnabled] = useLocalStorage<boolean>(
    'ui:professional-mode',
    false
  );

  return {
    enabled,
    setEnabled,
  };
}
