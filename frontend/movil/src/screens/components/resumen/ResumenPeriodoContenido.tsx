import React, { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  desplazarMes,
  etiquetaDelPeriodo,
  formatearMonto,
  gastosConMovimiento,
  NOMBRE_DE_ESTADO,
  textoDelResumen,
  type GastoPorMoneda,
  type ResumenDelPeriodo,
} from '@ojoalgasto/shared';
import { ContenidoConEstado } from '../../../components/estados';
import { NavButton } from '../NavButton';
import { isoDeFecha, mesDeFecha } from '../calendario/fechas';
import { COLORES_RESUMEN as C } from './estilos';
import { useResumenPeriodo, type ApiResumen } from './useResumenPeriodo';

export interface ResumenPeriodoContenidoProps {
  /**
   * 'panel': gasto del mes y cantidad por estado (AN-01).
   * 'informe': además el total estimado y el resumen en texto (AN-23).
   */
  variante: 'panel' | 'informe';
  /** El mes que se abre primero ("YYYY-MM"). Por defecto, el mes de hoy. */
  mesInicial?: string;
  /**
   * Avisa cuando la pantalla vuelve a estar a la vista (por ejemplo después de crear una suscripción
   * en Inicio), para que las cifras no queden viejas. Devuelve la función para dejar de escuchar.
   */
  alVolverAPantalla?: (recargar: () => void) => () => void;
  /** Acciones bajo el resumen (en AN-26 va el botón de compartir). Recibe el resumen ya cargado. */
  renderAcciones?: (resumen: ResumenDelPeriodo) => ReactNode;
  /** Solo en pruebas. */
  api?: ApiResumen;
}

export function ResumenPeriodoContenido({
  variante,
  mesInicial,
  alVolverAPantalla,
  renderAcciones,
  api,
}: ResumenPeriodoContenidoProps) {
  // "Hoy" se calcula en cada render: si la app queda abierta pasada la medianoche, el tope del selector se corrige.
  const mesActual = mesDeFecha(isoDeFecha(new Date()));
  const [mes, setMes] = React.useState(mesInicial ?? mesActual);
  const { estado, cargar } = useResumenPeriodo(mes, api);

  useEffect(() => {
    if (!alVolverAPantalla) return undefined;
    return alVolverAPantalla(() => void cargar({ enSegundoPlano: true }));
  }, [alVolverAPantalla, cargar]);

  // No se avanza más allá del mes actual: no hay cobros futuros confirmados que resumir.
  const puedeAvanzar = mes < mesActual;

  return (
    <View testID={`resumen-${variante}`} style={styles.contenedor}>
      <View style={styles.selector}>
        <NavButton
          testID="periodo-anterior"
          title="‹"
          accessibilityLabel="Periodo anterior"
          variant="secondary"
          style={styles.botonPeriodo}
          onPress={() => setMes(desplazarMes(mes, -1))}
        />
        <Text testID="titulo-periodo" style={styles.tituloPeriodo} accessibilityRole="header">
          {etiquetaDelPeriodo(mes)}
        </Text>
        <NavButton
          testID="periodo-siguiente"
          title="›"
          accessibilityLabel="Periodo siguiente"
          variant="secondary"
          disabled={!puedeAvanzar}
          style={styles.botonPeriodo}
          onPress={() => setMes(desplazarMes(mes, 1))}
        />
      </View>

      <ContenidoConEstado
        estado={estado}
        onReintentar={() => void cargar()}
        esVacio={(resumen) => gastosConMovimiento(resumen).length === 0 && resumen.conteo.total === 0}
        vacio={{
          titulo: 'Sin movimiento en este periodo',
          descripcion: 'Cuando tengas suscripciones o cobros en este mes, el resumen aparece aquí.',
        }}
      >
        {(resumen) => (
          <>
            <Gastos gastos={gastosConMovimiento(resumen)} informe={variante === 'informe'} />
            <Conteo resumen={resumen} />
            {variante === 'informe' ? (
              <View style={styles.tarjeta}>
                <Text style={styles.subtitulo}>Resumen en texto</Text>
                <Text testID="resumen-texto" style={styles.texto}>
                  {textoDelResumen(resumen)}
                </Text>
              </View>
            ) : null}
            {renderAcciones?.(resumen)}
          </>
        )}
      </ContenidoConEstado>
    </View>
  );
}

/** Una tarjeta por moneda: los importes de monedas distintas nunca se suman. */
function Gastos({ gastos, informe }: { gastos: GastoPorMoneda[]; informe: boolean }) {
  if (gastos.length === 0) {
    return (
      <Text testID="sin-gastos" style={styles.texto}>
        Sin gastos registrados ni proyectados en este periodo.
      </Text>
    );
  }
  return (
    <>
      {gastos.map((gasto) => (
        <View key={gasto.moneda} testID={`gasto-${gasto.moneda}`} style={styles.tarjeta}>
          <Text style={styles.subtitulo}>Gasto en {gasto.moneda}</Text>
          <Fila etiqueta="Gastado" valor={formatearMonto(gasto.gastoReal, gasto.moneda)} />
          <Fila etiqueta="Por cobrar" valor={formatearMonto(gasto.gastoProyectado, gasto.moneda)} />
          {informe ? <Fila etiqueta="Total estimado" valor={formatearMonto(gasto.totalEstimado, gasto.moneda)} fuerte /> : null}
        </View>
      ))}
    </>
  );
}

function Conteo({ resumen }: { resumen: ResumenDelPeriodo }) {
  return (
    <View testID="conteo-estados" style={styles.tarjeta}>
      <Text style={styles.subtitulo}>Suscripciones: {resumen.conteo.total}</Text>
      {(Object.keys(NOMBRE_DE_ESTADO) as (keyof typeof NOMBRE_DE_ESTADO)[]).map((estado) => (
        <Fila key={estado} etiqueta={NOMBRE_DE_ESTADO[estado]} valor={String(resumen.conteo[estado])} />
      ))}
    </View>
  );
}

function Fila({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <View style={styles.fila}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <Text style={[styles.valor, fuerte && styles.valorFuerte]}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  selector: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botonPeriodo: { minWidth: 48 },
  tituloPeriodo: { flex: 1, textAlign: 'center', color: C.tinta, fontSize: 18, fontWeight: '700' },
  tarjeta: { backgroundColor: C.superficie, borderRadius: 14, padding: 16, gap: 6, borderWidth: 1, borderColor: C.borde },
  subtitulo: { color: C.tinta2, fontSize: 13, fontWeight: '600' },
  fila: { flexDirection: 'row', justifyContent: 'space-between' },
  etiqueta: { color: C.tinta2, fontSize: 14 },
  valor: { color: C.tinta, fontSize: 16, fontWeight: '600' },
  valorFuerte: { color: C.acento, fontWeight: '700' },
  texto: { color: C.tinta2, fontSize: 14, lineHeight: 20 },
});
