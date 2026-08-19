/**
 * Runtime stand-in for `@nostrify/react`.
 *
 * Two exports, both trivial — the real package's value is the pool it carries,
 * and `NostrProvider` in this app builds that itself.
 */
import * as React from 'react';

export const NostrContext = React.createContext(undefined);

export function useNostr() {
  const context = React.useContext(NostrContext);
  if (!context) throw new Error('useNostr outside NostrProvider');
  return context;
}
