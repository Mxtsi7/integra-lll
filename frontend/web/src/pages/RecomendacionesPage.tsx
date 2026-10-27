import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { useRecomendaciones } from '../hooks/useRecomendaciones';
import styles from './RecomendacionesPage.module.css';

export function RecomendacionesPage() {
  const { estado, recargar } = useRecomendaciones();
  const navigate = useNavigate();

  return (
    <AppLayout headerTitulo="Consejos y Recomendaciones">
      <div className={styles.contenedor}>
        <header className={styles.encabezado}>
          <h1 className={styles.titulo}>Consejos y Recomendaciones</h1>
          <p className={styles.subtitulo}>
            Sugerencias inteligentes para optimizar tus suscripciones y gastos.
          </p>
        </header>

        {estado.tipo === 'cargando' && (
          <div className={styles.estadoCarga}>Cargando recomendaciones...</div>
        )}

        {estado.tipo === 'error' && (
          <div className={styles.estadoError}>
            <p>{estado.mensaje}</p>
            <button type="button" className={styles.botonDescartar} onClick={recargar}>
              Reintentar
            </button>
          </div>
        )}

        {estado.tipo === 'listo' && (
          <>
            {estado.items.length === 0 ? (
              <div className={styles.emptyStateContainer}>
                <p>No tienes recomendaciones pendientes en este momento.</p>
              </div>
            ) : (
              <div className={styles.lista}>
                {estado.items.map((item) => {
                  // Solo se navega al detalle existente /suscripciones/:id y únicamente
                  // si la recomendación trae suscripcion_id (el id de la recomendación NO es el de la suscripción).
                  const destino = item.suscripcion_id ? `/suscripciones/${item.suscripcion_id}` : null;
                  return (
                    <div
                      key={item.id}
                      className={styles.tarjeta}
                      onClick={destino ? () => navigate(destino) : undefined}
                      style={{ cursor: destino ? 'pointer' : 'default' }}
                    >
                      <div className={styles.tarjetaContenido}>
                       <h3 className={styles.nombreSuscripcion}>Recomendación de ahorro</h3>

                        {item.motivo && <p className={styles.motivo}>{item.motivo}</p>}
                        {item.ahorro_estimado !== undefined && (
                          <span className={styles.ahorroBadge}>
                            Ahorro estimado: ${item.ahorro_estimado}
                          </span>
                        )}
                      </div>

                      {destino && (
                        <div className={styles.acciones} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={styles.botonDescartar}
                            onClick={() => navigate(destino)}
                          >
                            Ver suscripción
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
