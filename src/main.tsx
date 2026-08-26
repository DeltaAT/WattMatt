import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { installGlobalErrorHandlers } from '@/platform/globalErrors';
import { logSessionStart } from '@/platform/log';
import { APP_VERSION } from '@/store/persistenceRuntime';
import '@/styles/global.css';

// Before the first render, so a failure during it is caught rather than
// reaching the console alone (issue #30). React's error boundaries do not see
// click handlers, timers or unawaited promises; these do.
installGlobalErrorHandlers();

// The one entry with a local clock in it. Rust stamps every line in UTC because
// it has no timezone database, and this line is what lets whoever reads the log
// afterwards translate the rest back to the evening the host remembers
// (src-tauri/src/logging.rs).
logSessionStart(APP_VERSION);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
