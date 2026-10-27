import { equivalenteMensual, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { Download, Maximize2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { OjoMarca } from '../layout/Marca';
import { Boton, BotonEnlace } from '../ui/Boton';
import { usePresentacionCategoria, sufijoFrecuencia } from '../subscriptions/presentacion';
import styles from './Tiles.module.css';

interface TileHubProps {
  suscripciones: Suscripcion[];
  alExportar: () => void;
}

type Pestana = Suscripcion['categoria'] | null;

// Seis lugares alrededor del ojo, en porcentaje del escenario. En pantalla
// ancha forman un anillo; en el celular, dos columnas con el ojo al medio.
const LUGARES_ANCHO: [number, number][] = [
  [18, 24],
  [50, 13],
  [82, 24],
  [18, 76],
  [50, 87],
  [82, 76],
];
const LUGARES_ANGOSTO: [number, number][] = [
  [24, 15],
  [76, 15],
  [24, 50],
  [76, 50],
  [24, 85],
  [76, 85],
];
const CENTRO: [number, number] = [50, 50];

/** true cuando la ventana es angosta (celular). Sigue los cambios de tamaño. */
function useEsAngosto(): boolean {
  const [angosto, setAngosto] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 640px)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const consulta = window.matchMedia('(max-width: 640px)');
    const alCambiar = (e: MediaQueryListEvent) => setAngosto(e.matches);
    consulta.addEventListener('change', alCambiar);
    return () => consulta.removeEventListener('change', alCambiar);
  }, []);
  return angosto;
}

/**
 * El hub: el ojo al centro y, alrededor, las suscripciones que más pesan,
 * como los dispositivos de una casa. Las pestañas cambian la categoría.
 */
export function TileHub({ suscripciones, alExportar }: TileHubProps) {
  const categoriaVisual = usePresentacionCategoria();
  const [pestana, setPestana] = useState<Pestana>(null);
  const angosto = useEsAngosto();
  const lugares = angosto ? LUGARES_ANGOSTO : LUGARES_ANCHO;

  const categoriasPresentes = [...new Set(suscripciones
    .filter((s) => s.estado !== 'cancelado').map((s) => s.categoria))];

  const visibles = suscripciones
    .filter((s) => s.estado !== 'cancelado' && (pestana === null || s.categoria === pestana))
    .sort((a, b) => equivalenteMensual(b.monto, b.frecuencia) - equivalenteMensual(a.monto, a.frecuencia))
    .slice(0, lugares.length);

  const totalVisible = visibles.reduce((suma, s) => suma + equivalenteMensual(s.monto, s.frecuencia), 0);
  const fantasmas = suscripciones.filter((s) => s.estado === 'fantasma').length;

  const pestanas: { valor: Pestana; etiqueta: string; icono?: ReactNode }[] = [
    { valor: null, etiqueta: 'Todas' },
    ...categoriasPresentes.map((c) => {
      const { etiqueta, Icono } = categoriaVisual(c);
      return { valor: c as Pestana, etiqueta, icono: <Icono size={14} aria-hidden="true" /> };
    }),
  ];

  return (
    <section className={`tile ${styles.tile} ${styles.hub}`} aria-label="Tus suscripciones más grandes">
      <div className={styles.hubPestanas} role="tablist" aria-label="Categoría">
        {pestanas.map((p) => (
          <button
            key={p.valor ?? '__todas__'}
            type="button"
            role="tab"
            aria-selected={pestana === p.valor}
            className={pestana === p.valor ? `${styles.hubPestana} ${styles.hubPestanaActiva}` : styles.hubPestana}
            onClick={() => setPestana(p.valor)}
          >
            {p.icono}
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className={styles.hubEscena}>
        <svg className={styles.hubLineas} aria-hidden="true">
          {visibles.map((s, i) => (
            // Cada línea nace en su suscripción y se dibuja hacia el ojo, una
            // tras otra. Las coordenadas van en porcentaje para que el trazo
            // no se deforme con el tamaño del escenario. `key` incluye la
            // pestaña para que al cambiarla se vuelvan a dibujar.
            <line
              key={`${pestana}-${s.id}`}
              className={styles.hubLinea}
              style={{ animationDelay: `${260 + i * 90}ms` }}
              pathLength={100}
              x1={`${lugares[i][0]}%`}
              y1={`${lugares[i][1]}%`}
              x2={`${CENTRO[0]}%`}
              y2={`${CENTRO[1]}%`}
            />
          ))}
        </svg>

        <div className={styles.hubCentro}>
          <span className={styles.hubOjo}>
            <OjoMarca tamano={46} />
          </span>
          <span className={styles.hubCentroTexto}>
            {visibles.length > 0 && (
              <span className={styles.hubCentroEtiqueta}>
                {visibles.length === 1 ? 'La más grande: ' : `Las ${visibles.length} más grandes: `}
              </span>
            )}
            {visibles.length === 0 ? 'Nada por acá' : `${formatearMonto(totalVisible)} al mes`}
          </span>
        </div>

        {visibles.map((s, i) => {
          const { Icono, color } = categoriaVisual(s.categoria);
          return (
            <Link
              key={`${pestana}-${s.id}`}
              to={`/suscripciones/${s.id}`}
              className={`${styles.hubNodo} ${s.estado === 'fantasma' ? styles.hubNodoFantasma : ''}`}
              style={{ left: `${lugares[i][0]}%`, top: `${lugares[i][1]}%`, animationDelay: `${120 + i * 90}ms` }}
              title={s.estado === 'fantasma' ? `${s.nombre}: sin uso` : s.nombre}
            >
              <span className={styles.hubNodoIcono} style={{ color }}>
                <Icono size={22} aria-hidden="true" />
              </span>
              <span className={styles.hubNodoNombre}>{s.nombre}</span>
              <span className={styles.hubNodoMonto}>
                {formatearMonto(s.monto, s.moneda)}
                {sufijoFrecuencia(s.frecuencia)}
              </span>
            </Link>
          );
        })}

        {visibles.length === 0 && (
          <p className={styles.hubVacio}>No hay suscripciones en esta categoría todavía.</p>
        )}
      </div>

      <div className={styles.hubPie}>
        <span className={styles.hubEstado}>
          <span className={`${styles.hubPunto} ${fantasmas > 0 ? styles.hubPuntoCoral : ''}`} aria-hidden="true" />
          {fantasmas === 0
            ? 'Todo en uso'
            : fantasmas === 1
              ? '1 suscripción sin uso'
              : `${fantasmas} suscripciones sin uso`}
        </span>
        <div className={styles.hubAcciones}>
          <Boton variante="secundario" tamano="s" icono={<Download size={15} aria-hidden="true" />} onClick={alExportar}>
            Exportar CSV
          </Boton>
          <BotonEnlace to="/home" variante="secundario" tamano="s" icono={<Maximize2 size={15} aria-hidden="true" />}>
            Ver todas
          </BotonEnlace>
        </div>
      </div>
    </section>
  );
}
