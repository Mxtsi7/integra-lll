import React from 'react';
import { useRecomendaciones } from '../hooks/useRecomendaciones';
import styles from './RecomendacionesPage.module.css';

/**
 * AN-20: Página web de Recomendaciones (Consejos)
 * 
 * Puntos de extensión preparados para Christopher:
 * - CH-22: Integrar visualización de motivo y ahorro estimado.
 * - CH-26: Integrar componente corporativo de Estado Vacío (Empty State).
 * - CH-32: Integrar la acción/handler para descartar recomendaciones.
 */
export function RecomendacionesPage() {
  const { estado, quitar } = useRecomendaciones();

  return (
    <div className={styles.contenedor}>
      <header className={styles.encabezado}>
        <h1 className={styles.titulo}>Consejos y Recomendaciones</h1>
        <p className={styles.subtitulo}>
          Sugerencias inteligentes para optimizar tus suscripciones y gastos.
        </p>
      </header>

      {/* Estado de carga */}
      {estado.tipo === 'cargando' && (
        <div className={styles.estadoCarga}>
          Cargando recomendaciones...
        </div>
      )}

      {/* Estado de error */}
      {estado.tipo === 'error' && (
        <div className={styles.estadoError}>
          {estado.mensaje || 'Ocurrió un error al obtener las recomendaciones.'}
        </div>
      )}

      {/* Estado con datos reales del hook */}
      {estado.tipo === 'listo' && (
        <>
          {/* PUNTO DE EXTENSIÓN CH-26 (Christopher Solís): Estado Vacío */}
          {estado.items.length === 0 ? (
            <div className={styles.emptyStateContainer}>
              <p>No tienes recomendaciones pendientes en este momento.</p>
              {/* Inserción del componente EmptyState de CH-26 */}
            </div>
          ) : (
            <div className={styles.lista}>
              {estado.items.map((item: any) => (
                <div key={item.id} className={styles.tarjeta}>
                  <div className={styles.tarjetaContenido}>
                    <h3 className={styles.nombreSuscripcion}>
                      {item.nombre || item.titulo || 'Suscripción'}
                    </h3>

                    {/* PUNTO DE EXTENSIÓN CH-22 (Christopher Solís): Motivo y Ahorro */}
                    {item.motivo && (
                      <p className={styles.motivo}>{item.motivo}</p>
                    )}
                    {item.ahorro_estimado !== undefined && (
                      <span className={styles.ahorroBadge}>
                        Ahorro estimado: ${item.ahorro_estimado}
                      </span>
                    )}
                  </div>

                  <div className={styles.acciones}>
                    {/* PUNTO DE EXTENSIÓN CH-32 (Christopher Solís): Descartar */}
                    <button
                      type="button"
                      className={styles.botonDescartar}
                      onClick={() => quitar && quitar(item.id)}
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}