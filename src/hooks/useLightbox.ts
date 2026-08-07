import { createContext, useContext } from 'react';

export interface LightboxContextValue {
  /** Opens the lightbox on `images[index]`. */
  open: (images: string[], index: number) => void;
}

export const LightboxContext = createContext<LightboxContextValue | null>(null);

export function useLightbox(): LightboxContextValue {
  const context = useContext(LightboxContext);
  // Notes render outside the provider in tests, where opening is a no-op
  return context ?? { open: () => {} };
}
