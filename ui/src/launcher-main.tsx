import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import LauncherPage from './pages/Launcher';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LauncherPage />
  </StrictMode>
);
