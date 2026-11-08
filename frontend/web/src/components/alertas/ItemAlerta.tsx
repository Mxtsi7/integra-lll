import { formatearFechaHora, type Alerta, type LecturaAlerta, type TipoAlerta } from '@ojoalgasto/shared';
import { Bell, CalendarClock, Check, ChevronRight, CopyCheck, Hourglass, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Boton } from '../ui/Boton';
import { Insignia, type TonoInsignia } from '../ui/Insignia';
import styles from './ItemAlerta.module.css';

const ICONO_POR_TIPO: Record<TipoAlerta, LucideIcon> = {
  proximo_cobro: CalendarClock,
  fin_prueba: Hourglass,
  alza_tarifa: TrendingUp,
  doble_cobro: CopyCheck,
  presupuesto_excedido: Wallet,
};

/**
 * «Sin leer» y no «Pendiente», que es como lo llama el modelo. Neutra y no
 * del acento: en tema claro ningún tono de color de la insignia llega a 4,5:1
 * con letra de 12 px. Lo sin leer ya lo marcan la franja, el ícono y el título.
 */
const LECTURA: Record<LecturaAlerta, { etiqueta: string; tono: TonoInsignia }> = {
  pendiente: { etiqueta: 'Sin leer', tono: 'neutro' },
  leida: { etiqueta: 'Leída', tono: 'neutro' },
  revisada: { etiqueta: 'Revisada', tono: 'neutro' },
};

interface ItemAlertaProps {
  alerta: Alerta;
  /** Mientras el servidor la marca: el botón gira y no se puede pulsar otra vez. */
  marcando?: boolean;
  /** Sin esto no hay botón de leer. Solo aparece en las sin leer. */
  alMarcarLeida?: (alerta: Alerta) => void;
}

/** Una alerta del Centro (SE-01): qué pasó, cuándo, su estado y qué se puede hacer. */
export function ItemAlerta({ alerta, marcando = false, alMarcarLeida }: ItemAlertaProps) {
  const idTitulo = useId();
  // Un tipo que el backend agregue después se muestra igual, con la campana.
  const Icono: LucideIcon = (ICONO_POR_TIPO as Partial<Record<string, LucideIcon>>)[alerta.tipo] ?? Bell;
  const lectura = LECTURA[alerta.lectura] ?? { etiqueta: alerta.lectura_legible, tono: 'neutro' };

  return (
    <article
      className={`tile ${styles.alerta} ${alerta.pendiente ? styles.pendiente : ''}`}
      aria-labelledby={idTitulo}
    >
      <span className={styles.icono}>
        <Icono size={18} aria-hidden="true" />
      </span>

      <div className={styles.texto}>
        <div className={styles.cabecera}>
          <h2 id={idTitulo} className={styles.titulo}>
            {alerta.titulo}
          </h2>
          <Insignia tono={lectura.tono}>{lectura.etiqueta}</Insignia>
        </div>
        <p className={styles.mensaje}>{alerta.mensaje}</p>
        <p className={styles.meta}>
          {alerta.tipo_legible} · <time dateTime={alerta.creado_en}>{formatearFechaHora(alerta.creado_en)}</time>
        </p>
      </div>

      <div className={styles.acciones}>
        {alerta.pendiente && alMarcarLeida && (
          <Boton
            variante="secundario"
            tamano="s"
            cargando={marcando}
            icono={<Check size={15} aria-hidden="true" />}
            aria-label={`Marcar como leída: ${alerta.titulo}`}
            onClick={() => alMarcarLeida(alerta)}
          >
            Marcar como leída
          </Boton>
        )}
        {alerta.suscripcion_id && (
          <Link
            to={`/suscripciones/${encodeURIComponent(alerta.suscripcion_id)}`}
            className={styles.enlace}
            aria-label={`Ver suscripción: ${alerta.titulo}`}
          >
            Ver suscripción
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
    </article>
  );
}
