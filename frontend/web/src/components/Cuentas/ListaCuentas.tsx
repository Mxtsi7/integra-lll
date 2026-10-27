import {
  formatearFechaHora,
  type CuentaConectada,
  type EstadoCuentaConectada,
  type ProveedorCuenta,
} from '@ojoalgasto/shared';
import { FileSpreadsheet, Mail, TriangleAlert } from 'lucide-react';
import EmptyState from '../subscriptions/EmptyState';
import { Spinner } from '../Spinner';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import { Insignia, type TonoInsignia } from '../ui/Insignia';
import styles from './Cuentas.module.css';

/**
 * Lo que puede mostrar el listado de Cuentas conectadas (CH-23). Es el
 * contrato con AN-17: la página pasa de "cargando" a "listo" o "error" con
 * lo que devuelva el GET del servicio connectors.
 *
 * "no_disponible" es mientras ese GET no exista: se dice tal cual, en vez
 * de mostrar "no tienes cuentas" (que sería falso) o cuentas inventadas.
 */
export type EstadoListaCuentas =
  | { tipo: 'no_disponible' }
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; cuentas: CuentaConectada[] };

// El texto del estado lo manda el backend (estado_legible); acá solo se
// decide el color. Es un Record completo: si connectors agrega un estado,
// TypeScript obliga a darle uno.
const TONO_POR_ESTADO: Record<EstadoCuentaConectada, TonoInsignia> = {
  conectada: 'verde',
  requiere_reautorizacion: 'acento',
  error: 'coral',
  desconectada: 'neutro',
};

const ICONO_POR_PROVEEDOR: Record<ProveedorCuenta, typeof Mail> = {
  gmail: Mail,
  outlook: Mail,
  csv: FileSpreadsheet,
};

interface ListaCuentasProps {
  estado: EstadoListaCuentas;
  onReintentar: () => void;
}

/** Listado de cuentas con sus estados: conectada, pendiente de reautorizar, con error, sin cuentas. */
export function ListaCuentas({ estado, onReintentar }: ListaCuentasProps) {
  if (estado.tipo === 'no_disponible') {
    return (
      <p className={styles.mensaje}>
        El listado de tus cuentas conectadas todavía no está disponible. Mientras tanto, registra tus
        suscripciones a mano desde Inicio.
      </p>
    );
  }

  if (estado.tipo === 'cargando') {
    return (
      <div className={styles.mensaje}>
        <Spinner size={22} etiqueta="Cargando tus cuentas conectadas" />
      </div>
    );
  }

  if (estado.tipo === 'error') return <ErrorConReintento mensaje={estado.mensaje} onReintentar={onReintentar} />;

  if (estado.cuentas.length === 0) {
    return (
      <EmptyState
        title="Todavía no conectas ninguna cuenta"
        description="Cuando conectes tu correo, aparece aquí con su estado y la última vez que se revisó."
      />
    );
  }

  return (
    <ul className={styles.lista} aria-label="Tus cuentas conectadas">
      {estado.cuentas.map((cuenta) => (
        <TarjetaCuenta key={cuenta.id} cuenta={cuenta} />
      ))}
    </ul>
  );
}

function TarjetaCuenta({ cuenta }: { cuenta: CuentaConectada }) {
  const Icono = ICONO_POR_PROVEEDOR[cuenta.proveedor];
  return (
    <li className={styles.cuenta}>
      <span className={styles.cuentaIcono}>
        <Icono size={20} aria-hidden="true" />
      </span>
      <div className={styles.cuentaTexto}>
        <p className={styles.cuentaProveedor}>{cuenta.proveedor_legible}</p>
        <p className={styles.cuentaExterna}>{cuenta.cuenta_externa}</p>
        <p className={styles.cuentaDetalle}>
          {cuenta.ultima_sincronizacion
            ? `Última revisión: ${formatearFechaHora(cuenta.ultima_sincronizacion)}`
            : 'Todavía no se revisa'}
        </p>
        {cuenta.detalle_del_estado && <p className={styles.cuentaDetalle}>{cuenta.detalle_del_estado}</p>}
        {cuenta.necesita_reautorizacion && (
          <p className={styles.cuentaAviso}>
            <TriangleAlert size={14} aria-hidden="true" />
            Vuelve a autorizar esta cuenta para que sigamos leyendo tus cobros.
          </p>
        )}
      </div>
      <Insignia tono={TONO_POR_ESTADO[cuenta.estado]}>{cuenta.estado_legible}</Insignia>
    </li>
  );
}
