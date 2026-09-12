import { configurarApi } from '@ojoalgasto/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// La URL de la API la define docker-compose.yml (VITE_API_URL). Se configura
// una sola vez, antes de montar cualquier pantalla.
configurarApi({ urlBase: import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api' });

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
