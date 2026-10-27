import {
  costoPorHora,
  equivalenteMensual,
  formatearFecha,
  formatearMonto,
  getSuscripciones,
  type Suscripcion,
} from '@ojoalgasto/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Insignia } from '../components/ui/Insignia';
import {
  usePresentacionCategoria,
  cuandoEnDias,
  ESTADOS,
  etiquetaFrecuencia,
  sufijoFrecuencia,
} from '../components/subscriptions/presentacion';
import { diasHasta } from '../utils/fechas';
import styles from './SuscripcionDetallePage.module.css';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'no-encontrada' }
  | { tipo: 'listo'; suscripcion: Suscripcion };

export function SuscripcionDetallePage() {
  const categoriaVisual = usePresentacionCategoria();
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
    <AppLayout
      headerTitulo={estado.tipo === 'listo' ? estado.suscripcion.nombre : 'Suscripción'}
      headerSubtitulo={estado.tipo === 'listo' ? categoriaVisual(estado.suscripcion.categoria).etiqueta : undefined}
      angosto
    >
      <Link to="/home" className={styles.volver}>
        <ArrowLeft size={15} aria-hidden="true" />
        Volver a Inicio
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
  const categoriaVisual = usePresentacionCategoria();
  const montoMensual = equivalenteMensual(suscripcion.monto, suscripcion.frecuencia);
  const porHora = costoPorHora(montoMensual, suscripcion.horas_uso_mes ?? 0);
  const info = ESTADOS[suscripcion.estado];
  const { Icono, color, suave } = categoriaVisual(suscripcion.categoria);
  const dias = diasHasta(suscripcion.fecha_proximo_cobro);

  return (
    <div className={`tile ${styles.tarjeta}`} style={{ '--tinte': suave } as React.CSSProperties}>
      <div className={styles.encabezado}>
        <span className={styles.icono} style={{ color }}>
          <Icono size={28} aria-hidden="true" />
        </span>
        <div className={styles.encabezadoTexto}>
          <p className={styles.monto}>
            {formatearMonto(suscripcion.monto, suscripcion.moneda)}
            <span className={styles.periodo}>{sufijoFrecuencia(suscripcion.frecuencia)}</span>
          </p>
          {suscripcion.frecuencia === 'anual' && (
            <p className={styles.equivalente}>
              Equivale a {formatearMonto(montoMensual, suscripcion.moneda)} al mes
            </p>
          )}
        </div>
        <Insignia tono={info.tono} className={styles.estado}>
          {info.etiqueta}
        </Insignia>
      </div>

      {suscripcion.estado === 'fantasma' && (
        <p className={styles.avisoFantasma}>
          Lleva más de 45 días sin uso registrado y sigue cobrando. Si no la vas a usar, cancelarla
          te ahorra {formatearMonto(montoMensual, suscripcion.moneda)} al mes.
        </p>
      )}

      <dl className={styles.grid}>
        <Dato etiqueta="Próximo cobro">
          {formatearFecha(suscripcion.fecha_proximo_cobro)}
          {dias >= 0 && dias <= 7 && <span className={styles.datoNota}>{cuandoEnDias(dias).toLowerCase()}</span>}
        </Dato>
        <Dato etiqueta="Se cobra">{etiquetaFrecuencia(suscripcion.frecuencia)}</Dato>
        <Dato etiqueta="Horas de uso este mes">
          {suscripcion.horas_uso_mes ? `${suscripcion.horas_uso_mes} h` : 'Sin registrar'}
        </Dato>
        <Dato etiqueta="Costo por hora de uso">
          {porHora !== null ? formatearMonto(porHora, suscripcion.moneda) : 'Sin uso este mes'}
        </Dato>
        {suscripcion.fin_prueba && (
          <Dato etiqueta="Termina la prueba gratis">{formatearFecha(suscripcion.fin_prueba)}</Dato>
        )}
      </dl>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className={styles.dato}>
      <dt className={styles.datoEtiqueta}>{etiqueta}</dt>
      <dd className={styles.datoValor}>{children}</dd>
    </div>
  );
}
