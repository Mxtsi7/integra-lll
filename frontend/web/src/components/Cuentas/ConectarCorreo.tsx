import { esUrlAutorizacionValida, type ProveedorCorreo } from '@ojoalgasto/shared';
import { useState } from 'react';
import styles from './ConectarCorreo.module.css';

export interface ConectarCorreoProps {
  /**
   * FE-03: pide al backend la URL de autorización del proveedor y la devuelve.
   * Rechazar (throw) si el backend falla.
   */
  onIniciar: (proveedor: ProveedorCorreo) => Promise<string>;
  /** Por defecto window.location.assign. Se puede inyectar para pruebas. */
  redirigir?: (url: string) => void;
}

const NOMBRES: Record<ProveedorCorreo, string> = { gmail: 'Gmail', outlook: 'Outlook' };

/**
 * Botones "Conectar Gmail / Outlook" con consentimiento explícito.
 * No muestra ninguna cuenta como conectada: eso solo ocurre tras el retorno OAuth (AN-16).
 * Si el usuario cancela o algo falla, no cambia nada.
 */
export function ConectarCorreo({ onIniciar, redirigir = (u) => window.location.assign(u) }: ConectarCorreoProps) {
  const [consentimiento, setConsentimiento] = useState(false);
  const [cargando, setCargando] = useState<ProveedorCorreo | null>(null);
  const [error, setError] = useState('');

  async function conectar(proveedor: ProveedorCorreo) {
    setError('');
    setCargando(proveedor);
    try {
      const url = await onIniciar(proveedor);
      if (!esUrlAutorizacionValida(proveedor, url)) {
        setError('No pudimos iniciar la conexión de forma segura. Inténtalo de nuevo más tarde.');
        return;
      }
      redirigir(url);
    } catch {
      setError('No pudimos iniciar la conexión. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setCargando(null);
    }
  }

  return (
    <section className={styles.caja} aria-label="Conectar correo">
      <label className={styles.consentimiento}>
        <input type="checkbox" checked={consentimiento} onChange={(e) => setConsentimiento(e.target.checked)} />
        <span>
          Autorizo a Ojo al Gasto a leer en mi correo solo los mensajes de cobros y suscripciones, para detectarlos.
          Puedo desconectar mi cuenta cuando quiera.
        </span>
      </label>

      <div className={styles.botones}>
        {(Object.keys(NOMBRES) as ProveedorCorreo[]).map((p) => (
          <button
            key={p}
            type="button"
            className={styles.boton}
            disabled={!consentimiento || cargando !== null}
            onClick={() => conectar(p)}
          >
            {cargando === p ? 'Abriendo…' : `Conectar ${NOMBRES[p]}`}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
