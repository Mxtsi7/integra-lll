import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { useRecomendaciones } from '../hooks/useRecomendaciones';
import styles from './RecomendacionesPage.module.css';

export function RecomendacionesPage() {
  const { estado, quitar } = useRecomendaciones();
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

        {/* Estado de carga */}
        {estado.tipo === 'cargando' && (
          <div className={styles.estadoCarga}>
            Cargando recomendaciones...
          </div>
        )}

        {/* Estado de error / Indisponibilidad */}
        {estado.tipo === 'error' && (
          <div className={styles.estadoError}>
            <p>{estado.mensaje || 'El servicio de recomendaciones no está disponible actualmente.'}</p>
          </div>
        )}

        {/* Estado listo */}
        {estado.tipo === 'listo' && (
          <>
            {estado.items.length === 0 ? (
              <div className={styles.emptyStateContainer}>
                <p>No tienes recomendaciones pendientes en este momento.</p>
              </div>
            ) : (
              <div className={styles.lista}>
                {estado.items.map((item) => (
                  <div
                    key={item.id}
                    className={styles.tarjeta}
                    onClick={() => navigate(`/recomendaciones/${item.suscripcion_id || item.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.tarjetaContenido}>
                      <h3 className={styles.nombreSuscripcion}>
                        {item.nombre || item.titulo || 'Suscripción'}
                      </h3>

                      {item.motivo && (
                        <p className={styles.motivo}>{item.motivo}</p>
                      )}
                      {item.ahorro_estimado !== undefined && (
                        <span className={styles.ahorroBadge}>
                          Ahorro estimado: ${item.ahorro_estimado}
                        </span>
                      )}
                    </div>

                    <div className={styles.acciones} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.botonDescartar}
                        onClick={() => navigate(`/recomendaciones/${item.suscripcion_id || item.id}`)}
                      >
                        Ver detalle
                      </button>
                      <button
                        type="button"
                        className={styles.botonDescartar}
                        onClick={() => quitar(item.id)}
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
    </AppLayout>
  );
}
