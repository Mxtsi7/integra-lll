import { sumarEquivalentesMensuales, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { Zap } from 'lucide-react';
import { useConteo } from '../../hooks/useConteo';
import { usePresentacionCategoria } from '../subscriptions/presentacion';
import styles from './Tiles.module.css';

interface TileCategoriasProps {
  suscripciones: Suscripcion[];
  moneda: string;
}

/**
 * Cuánto se va en cada categoría, como el gráfico de consumo eléctrico:
 * barras verticales con la más alta en naranjo y su valor encima.
 */
export function TileCategorias({ suscripciones, moneda }: TileCategoriasProps) {
  const categoriaVisual = usePresentacionCategoria();
  // Esta métrica conserva activo + fantasma, sin incluir pruebas.
  const relevantes = suscripciones.filter((s) => s.estado === 'activo' || s.estado === 'fantasma');

  const porCategoria = new Map<Suscripcion['categoria'], Suscripcion[]>();
  for (const s of relevantes) {
    const grupo = porCategoria.get(s.categoria) ?? [];
    grupo.push(s);
    porCategoria.set(s.categoria, grupo);
  }

  const datos = Array.from(porCategoria.entries())
    .map(([categoria, grupo]) => ({ categoria, monto: sumarEquivalentesMensuales(grupo) }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 6);

  const maximo = datos[0]?.monto ?? 0;
  const total = sumarEquivalentesMensuales(relevantes);
  const totalMostrado = useConteo(total, 900);

  return (
    <section className={`tile ${styles.tile}`} aria-label="Gasto por categoría">
      <div className={styles.cabecera}>
        <span className={styles.icono} style={{ color: 'var(--acento)' }}>
          <Zap size={19} aria-hidden="true" />
        </span>
        <div className={styles.titulos}>
          <h2 className={styles.titulo}>Gasto por categoría</h2>
        </div>
        <span className={styles.pill}>Este mes</span>
      </div>

      <div className={styles.categoriasTotal}>
        <span className={styles.categoriasCifra}>{formatearMonto(totalMostrado, moneda)}</span>
        <span className={styles.categoriasSufijo}>
          en {porCategoria.size} {porCategoria.size === 1 ? 'categoría' : 'categorías'}
        </span>
      </div>

      {datos.length === 0 ? (
        <p className={styles.vacio}>Todavía no hay suscripciones activas para comparar.</p>
      ) : (
        <div className={styles.categoriasGrafico} role="img" aria-label={datos.map((d) => `${categoriaVisual(d.categoria).etiqueta} ${formatearMonto(d.monto, moneda)}`).join(', ')}>
          {datos.map((d, i) => (
            <div key={d.categoria} className={styles.categoriasColumna}>
              <span
                className={`${styles.categoriasBarra} ${i === 0 ? styles.categoriasBarraTop : ''}`}
                style={{ height: `${maximo > 0 ? Math.max(6, (d.monto / maximo) * 100) : 0}%` }}
              >
                {i === 0 && <span className={styles.categoriasBurbuja}>{formatearMonto(d.monto, moneda)}</span>}
              </span>
              <span className={styles.categoriasEje}>{categoriaVisual(d.categoria).etiqueta}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
