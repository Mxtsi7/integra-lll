import { costoPorHora, formatearFecha, formatearMonto, getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import styles from './SuscripcionDetallePage.module.css';

const ETIQUETAS_ESTADO: Record<Suscripcion['estado'], string> = {
  prueba: 'En prueba gratuita',
  activo: 'Activa',
  por_confirmar: 'Por confirmar',
  cancelado: 'Cancelada',
  fantasma: 'Fantasma (sin uso)',
};

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'no-encontrada' }
  | { tipo: 'listo'; suscripcion: Suscripcion };

export function SuscripcionDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'cargando' });

  useEffect(() => {
    let cancelado = false;

    // TODO: reemplazar por un endpoint dedicado (GET /suscripciones/:id)
    // cuando exista. Por ahora se reutiliza la lista completa y se busca
    // el id acá, para no bloquear esta pantalla esperando ese endpoint.
    getSuscripciones()
      .then((suscripciones) => {
        if (cancelado) return;
        const encontrada = suscripciones.find((s) => s.id === id);
        setEstado(encontrada ? { tipo: 'listo', suscripcion: encontrada } : { tipo: 'no-encontrada' });
      })
      .catch(() => {
        if (!cancelado) {
          setEstado({ tipo: 'error', mensaje: 'No pudimos cargar esta suscripción.' });
        }
      });

    return () => {
      cancelado = true;
    };
  }, [id]);

  return (
    <AppLayout headerTitulo="Detalle de suscripción" headerSubtitulo="Toda la información de este servicio.">
      <Link to="/dashboard" className={styles.volver}>
        ← Volver al panel
      </Link>

      {estado.tipo === 'cargando' && <p className={styles.mensaje}>Cargando…</p>}
      {estado.tipo === 'error' && <p className={styles.mensaje}>{estado.mensaje}</p>}
      {estado.tipo === 'no-encontrada' && (
        <p className={styles.mensaje}>No encontramos esa suscripción. Puede que haya sido eliminada.</p>
      )}
      {estado.tipo === 'listo' && <ContenidoDetalle suscripcion={estado.suscripcion} />}
    </AppLayout>
  );
}

function ContenidoDetalle({ suscripcion }: { suscripcion: Suscripcion }) {
  const porHora = costoPorHora(suscripcion.monto, suscripcion.horas_uso_mes ?? 0);

  return (
    <div className={styles.tarjeta}>
      <div className={styles.encabezado}>
        <span className={styles.icono} aria-hidden="true">
          {suscripcion.nombre.charAt(0).toUpperCase()}
        </span>
        <div>
          <h2 className={styles.nombre}>{suscripcion.nombre}</h2>
          <span className={styles.badgeEstado}>{ETIQUETAS_ESTADO[suscripcion.estado]}</span>
        </div>
      </div>

      <div className={styles.grid}>
        <Dato etiqueta="Monto" valor={`${formatearMonto(suscripcion.monto, suscripcion.moneda)} / ${suscripcion.frecuencia === 'mensual' ? 'mes' : 'año'}`} />
        <Dato etiqueta="Categoría" valor={suscripcion.categoria} />
        <Dato etiqueta="Próximo cobro" valor={formatearFecha(suscripcion.fecha_proximo_cobro)} />
        <Dato
          etiqueta="Costo por hora de uso"
          valor={porHora !== null ? formatearMonto(porHora, suscripcion.moneda) : 'Sin uso registrado este mes'}
        />
        {suscripcion.fin_prueba && <Dato etiqueta="Fin de la prueba gratis" valor={formatearFecha(suscripcion.fin_prueba)} />}
        <Dato etiqueta="Horas de uso este mes" valor={suscripcion.horas_uso_mes ? `${suscripcion.horas_uso_mes} h` : 'Sin registrar'} />
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className={styles.dato}>
      <p className={styles.datoEtiqueta}>{etiqueta}</p>
      <p className={styles.datoValor}>{valor}</p>
    </div>
  );
}
