import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { I18nProvider } from './I18n.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <I18nProvider>
      <App />
    </I18nProvider>
  </ErrorBoundary>,
);
