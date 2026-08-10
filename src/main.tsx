import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { installChunkErrorHandler } from '@/lib/importChunk';
import { registerServiceWorker } from '@/lib/serviceWorker';
import App from './App.tsx';
import './index.css';

import '@fontsource-variable/inter';

// Before the first render, so a chunk that went missing during startup is
// recovered rather than reaching the boundary as a blank page
installChunkErrorHandler();

// After the handler above, which is what recovers a page whose chunks the
// worker no longer has
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
