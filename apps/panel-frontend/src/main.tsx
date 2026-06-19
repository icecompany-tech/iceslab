import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { queryClient } from './lib/queryClient';
import { theme } from './theme';
import './i18n';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './index.css';

// Demo build serves under a sub-path inside an iframe (base '/panel-demo/');
// HashRouter keeps client-side routing working on any static host with no
// server rewrites. The normal panel keeps BrowserRouter.
const Router = __DEMO_MODE__ ? HashRouter : BrowserRouter;

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MantineProvider theme={theme} defaultColorScheme="dark" forceColorScheme="dark">
          <ModalsProvider>
            <Notifications />
            <Router>
              <App />
            </Router>
          </ModalsProvider>
        </MantineProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

if (__DEMO_MODE__) {
  // Dynamic import → the demo module + fixtures are tree-shaken out of the
  // normal build (__DEMO_MODE__ inlines to the literal `false`, so Rollup
  // eliminates this whole branch + the import).
  void import('./demo/install').then(({ installDemoMode }) => {
    installDemoMode();
    render();
  });
} else {
  render();
}
