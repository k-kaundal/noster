import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { installChunkErrorHandler } from '@/lib/importChunk';
import App from './App.tsx';
import './index.css';

import '@fontsource-variable/inter';

// Before the first render, so a chunk that went missing during startup is
// recovered rather than reaching the boundary as a blank page
installChunkErrorHandler();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
