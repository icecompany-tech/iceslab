import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';

import App from '@/app/App';
import { queryClient } from '@/lib/net/queryClient';
import { theme } from '@/app/theme';
import '@/i18n';

// Fonts ship with the bundle instead of coming from Google. An operator runs
// this panel on their own box, often somewhere Google's CDN is slow or blocked:
// a webfont request that never returns drops the whole UI onto system faces and
// the mono micro-labels lose the tracking the layout is built on. It also stops
// every admin page view from announcing itself to a third party, which is a
// strange thing for a privacy-infrastructure tool to do. Variable builds, so one
// file per family covers every weight we use.
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="dark" forceColorScheme="dark">
        <ModalsProvider>
          <Notifications />
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
);
