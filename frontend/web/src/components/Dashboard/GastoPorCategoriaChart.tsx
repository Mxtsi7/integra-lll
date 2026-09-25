import { equivalenteMensual, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import styles from './GastoPorCategoriaChart.module.css';

interface GastoPorCategoriaChartProps {
  suscripciones: Suscripcion[];
}

const ETIQUETAS_CATEGORIA: Record<string, string> = {
  streaming: 'Streaming',
  musica: 'Música',
  productividad: 'Productividad',
  nube: 'Nube',
  juegos: 'Juegos',
  educacion: 'Educación',
  salud: 'Salud',
  noticias: 'Noticias',
  ia: 'IA',
  otro: 'Otro',
};

export function GastoPorCategoriaChart({ suscripciones }: GastoPorCategoriaChartProps) {
  // Solo las que efectivamente pesan en el gasto mensual: mismo criterio
  // que gastoProyectado() en shared/calculos.ts (activo + fantasma).
  const relevantes = suscripciones.filter((s) => s.estado === 'activo' || s.estado === 'fantasma');

  const porCategoria = new Map<string, number>();
  for (const s of relevantes) {
    const actual = porCategoria.get(s.categoria) ?? 0;
    porCategoria.set(s.categoria, actual + equivalenteMensual(s.monto, s.frecuencia));
  }

  const datos = Array.from(porCategoria.entries())
    .map(([categoria, monto]) => ({
      categoria: ETIQUETAS_CATEGORIA[categoria] ?? categoria,
      monto: Math.round(monto),
    }))
    .sort((a, b) => b.monto - a.monto);

  return (
    <section className={styles.panel}>
      <h2 className={styles.titulo}>
        <span className={styles.barra} aria-hidden="true" />
        Gasto mensual por categoría
      </h2>

      {datos.length === 0 ? (
        <p className={styles.vacio}>Todavía no hay suscripciones activas para graficar.</p>
      ) : (
        <div className={styles.grafico}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={datos} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oag-line)" vertical={false} />
              <XAxis
                dataKey="categoria"
                tick={{ fontSize: 11, fill: 'var(--oag-ink-soft)' }}
                axisLine={{ stroke: 'var(--oag-line)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--oag-ink-soft)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(valor: number) => formatearMonto(valor)}
                width={70}
              />
              <Tooltip
                formatter={(valor: any) => formatearMonto(typeof valor === 'number' ? valor : 0)}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid var(--oag-line)',
                  fontFamily: 'var(--oag-font-mono)',
                }}
              />
              <Bar dataKey="monto" fill="#16213e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
