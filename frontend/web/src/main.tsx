import { configurarApi } from '@ojoalgasto/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles/theme.css';

configurarApi({ urlBase: import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api' });

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
