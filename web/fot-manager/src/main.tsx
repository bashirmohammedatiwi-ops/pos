import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { RootErrorBoundary } from './RootErrorBoundary';
import { ToastHost } from './ui';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <BrowserRouter>
          <ToastHost>
            <App />
          </ToastHost>
        </BrowserRouter>
      </RootErrorBoundary>
    </StrictMode>,
  );
}
