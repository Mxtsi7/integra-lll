import { getCatalogosSuscripciones, type CatalogosSuscripciones } from '@ojoalgasto/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Boton } from '../components/ui/Boton';

interface EstadoCatalogos {
  datos: CatalogosSuscripciones | null;
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

const CatalogosContext = createContext<EstadoCatalogos>({
  datos: null, cargando: true, error: null, recargar: () => {},
});

/** Se monta dentro de RutaPrivada; no carga catálogos durante el registro/login. */
export function CatalogosProvider({ children }: { children: ReactNode }) {
  const [datos, setDatos] = useState<CatalogosSuscripciones | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const peticion = useRef(0);
  const recargar = useCallback(() => {
    const id = ++peticion.current;
    setCargando(true);
    setError(null);
    getCatalogosSuscripciones().then((respuesta) => {
      if (peticion.current === id) setDatos(respuesta);
    }).catch(() => {
      if (peticion.current === id) setError('No pudimos cargar las opciones. Intenta de nuevo.');
    }).finally(() => {
      if (peticion.current === id) setCargando(false);
    });
  }, []);

  useEffect(() => {
    recargar();
    return () => { peticion.current += 1; };
  }, [recargar]);

  return <CatalogosContext.Provider value={{ datos, cargando, error, recargar }}>{children}</CatalogosContext.Provider>;
}

export function CatalogosLayout() {
  return <CatalogosProvider><Outlet /></CatalogosProvider>;
}

export function useCatalogos() {
  return useContext(CatalogosContext);
}

export function EstadoCargaCatalogos({ sinOpciones = false }: { sinOpciones?: boolean }) {
  const { cargando, error, recargar } = useCatalogos();
  return <>
    {cargando && <p role="status">Cargando opciones…</p>}
    {error && <p role="alert">{error}</p>}
    {!cargando && !error && sinOpciones && <p role="alert">No hay opciones disponibles. Intenta actualizar las opciones.</p>}
    <Boton variante="sutil" tamano="s" onClick={recargar} disabled={cargando}>{error ? 'Reintentar opciones' : 'Actualizar opciones'}</Boton>
  </>;
}
