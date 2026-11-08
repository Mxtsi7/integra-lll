import { formatearMonto, type Recomendacion } from '@ojoalgasto/shared';
import { Lightbulb } from 'lucide-react';
import { useRef } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import EmptyState from '../components/subscriptions/EmptyState';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Insignia } from '../components/ui/Insignia';
import { useToast } from '../context/ToastContext';
import { useRecomendaciones, type EstadoDescarte } from '../hooks/useRecomendaciones';
import styles from './RecomendacionesPage.module.css';

export function RecomendacionesPage() {
  const { estado, descartes, descartar, recargar } = useRecomendaciones();
  const toast = useToast();
  // Al retirar una tarjeta su botón desaparece: el foco vuelve a la lista
  // en vez de perderse en el documento.
  const resultados = useRef<HTMLDivElement>(null);

  const noMeInteresa = async (item: Recomendacion) => {
    // descartar() devuelve null también si, mientras viajaba, cambió la
    // sesión o se cerró la página: el descarte de otra cuenta no se anuncia
    // ni mueve el foco (revisión de #128).
    if (!(await descartar(item.id))) return;
    toast.exito('Listo, dejamos de mostrarte esa recomendación.');
    resultados.current?.focus();
  };

  return (
    <AppLayout
      headerTitulo="Consejos y Recomendaciones"
      headerSubtitulo="Sugerencias inteligentes para optimizar tus suscripciones y gastos."
    >
      <div ref={resultados} tabIndex={-1} className={styles.resultados} aria-label="Recomendaciones">
        {estado.tipo === 'cargando' && <p className={styles.mensaje}>Cargando recomendaciones…</p>}

        {/* Un error no es "no hay sugerencias": se dice qué pasó y se puede reintentar (CH-26). */}
        {estado.tipo === 'error' && <ErrorConReintento mensaje={estado.mensaje} onReintentar={recargar} />}

        {estado.tipo === 'listo' && estado.items.length === 0 && (
          <SinRecomendaciones disponible={estado.disponible} motivo={estado.motivoSinSugerencias} />
        )}

        {estado.tipo === 'listo' && estado.items.length > 0 && (
          <ul className={styles.lista}>
            {estado.items.map((item) => (
              <TarjetaRecomendacion
                key={item.id}
                item={item}
                descarte={descartes[item.id]}
                onDescartar={() => noMeInteresa(item)}
              />
            ))}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}

/**
 * CH-26: la respuesta llegó bien pero sin sugerencias. No se muestra ningún
 * ahorro (ni $0): no hay nada que ahorrar que podamos afirmar.
 */
function SinRecomendaciones({ disponible, motivo }: { disponible: boolean; motivo: string | null }) {
  const icono = <Lightbulb size={48} aria-hidden="true" />;
  if (!disponible) {
    return (
      <EmptyState
        icon={icono}
        title="Las recomendaciones todavía no están disponibles"
        description={motivo ?? 'Aún no podemos calcular sugerencias de ahorro. No es un problema de tus datos.'}
      />
    );
  }
  return (
    <EmptyState
      icon={icono}
      title="No tienes recomendaciones por ahora"
      description={motivo ?? 'Cuando veamos cómo ahorrar en tus suscripciones, te lo mostramos aquí.'}
    />
  );
}

interface TarjetaRecomendacionProps {
  item: Recomendacion;
  descarte: EstadoDescarte | undefined;
  onDescartar: () => void;
}

function TarjetaRecomendacion({ item, descarte, onDescartar }: TarjetaRecomendacionProps) {
  const titulo = item.nombre || 'Recomendación de ahorro';
  return (
    <li className={`tile ${styles.tarjeta}`}>
      <div className={styles.tarjetaContenido}>
        <h2 className={styles.nombreSuscripcion}>{titulo}</h2>
        {item.motivo && <p className={styles.motivo}>{item.motivo}</p>}
        {typeof item.ahorro_estimado === 'number' && item.moneda && (
          <Insignia tono="verde" className={styles.ahorro}>
            Ahorro estimado: {formatearMonto(item.ahorro_estimado, item.moneda)}
          </Insignia>
        )}
        {/* CH-32: si falla, la recomendación se queda y el botón sirve para reintentar. */}
        {descarte?.tipo === 'error' && (
          <p role="alert" className={styles.error}>
            {descarte.mensaje}
          </p>
        )}
      </div>

      <div className={styles.acciones}>
        {/* Solo hay detalle al que ir si trae suscripcion_id: el id de la recomendación no es el de la suscripción. */}
        {item.suscripcion_id && (
          <BotonEnlace to={`/suscripciones/${item.suscripcion_id}`} variante="secundario" tamano="s">
            Ver suscripción
          </BotonEnlace>
        )}
        <Boton
          variante="sutil"
          tamano="s"
          cargando={descarte?.tipo === 'enviando'}
          onClick={onDescartar}
          aria-label={`No me interesa: ${titulo}`}
        >
          No me interesa
        </Boton>
      </div>
    </li>
  );
}
