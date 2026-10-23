import { esUrlAutorizacionValida, type ProveedorCorreo, type ConsentimientoCorreo } from '@ojoalgasto/shared';
import { useState } from 'react';
import { Boton } from '../ui/Boton';
import styles from './ConectarCorreo.module.css';

export interface ConectarCorreoProps {
  /**
   * FE-03: pide al backend la URL de autorización del proveedor y la devuelve.
   * Rechazar (throw) si el backend falla.
   * Propuesta pendiente de aceptación FE-03: enviar el consentimiento y su
   * versión al servidor para que registre proveedor, usuario y fecha real.
   */
  onIniciar: (proveedor: ProveedorCorreo, consentimiento: ConsentimientoCorreo) => Promise<string>;
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
  const [consentimiento, setConsentimiento] = useState({ gmail: false, outlook: false });
  const [cargando, setCargando] = useState<ProveedorCorreo | null>(null);
  const [error, setError] = useState('');

  async function conectar(proveedor: ProveedorCorreo) {
    if (!consentimiento[proveedor] || cargando !== null) return;
    setError('');
    setCargando(proveedor);
    try {
      const url = await onIniciar(proveedor, { consentimiento: true, version_texto: 'correo-v1' });
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
      <div className={styles.botones}>
        {(Object.keys(NOMBRES) as ProveedorCorreo[]).map((p) => (
          <div key={p} className={styles.proveedor}>
            <label className={styles.consentimiento}>
              <input type="checkbox" checked={consentimiento[p]} disabled={cargando !== null}
                onChange={(e) => setConsentimiento({ ...consentimiento, [p]: e.target.checked })} />
              <span>Autorizo a Ojo al Gasto a leer en mi correo de {NOMBRES[p]} solo los mensajes de cobros y suscripciones, para detectarlos. Puedo desconectar mi cuenta cuando quiera.</span>
            </label>
          <Boton
            type="button"
            variante="secundario"
            cargando={cargando === p}
            disabled={!consentimiento[p] || cargando !== null}
            onClick={() => conectar(p)}
          >
            {cargando === p ? 'Abriendo…' : `Conectar ${NOMBRES[p]}`}
          </Boton>
          </div>
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
