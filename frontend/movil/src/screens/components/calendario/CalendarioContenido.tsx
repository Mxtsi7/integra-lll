import React, { useState, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { conMayuscula, formatearFechaLarga, formatearMesAnio } from '@ojoalgasto/shared';
import { ContenidoConEstado } from '../../../components/estados';
import { NavButton } from '../NavButton';
import { CuadriculaMes } from './CuadriculaMes';
import { COLORES_CALENDARIO as C } from './estilos';
import { esDelMes, isoDeFecha, mesDeFecha, partesDeMes, primerDiaDelMes, sumarMeses } from './fechas';
import { ListaCobros } from './ListaCobros';
import { cobrosDelDia, contarPorDia, formatearImporte, totalesPorMoneda } from './reglasCalendario';
import { useCobrosDelMes, type ApiCalendario } from './useCobrosDelMes';

export interface CalendarioContenidoProps {
  /** Solo en pruebas: fija qué día es hoy ("YYYY-MM-DD"). */
  hoyInicial?: string;
  /** Solo en pruebas. */
  api?: ApiCalendario;
}

export function CalendarioContenido({ hoyInicial, api }: CalendarioContenidoProps) {
  // Permitimos actualizar 'hoy' con setHoy para recalcular la fecha actual
  const [hoy, setHoy] = useState(() => hoyInicial ?? isoDeFecha(new Date()));
  const [mes, setMes] = useState(() => mesDeFecha(hoy));
  const [diaPedido, setDiaPedido] = useState(hoy);
  const { estado, cargar } = useCobrosDelMes(mes, api);

  // Obtiene la fecha real vigente (o hoyInicial si es una prueba)
  const obtenerHoyActual = useCallback(() => hoyInicial ?? isoDeFecha(new Date()), [hoyInicial]);

  // Actualiza "hoy" automáticamente cuando la pantalla recupera el foco o se reanuda la app
  useFocusEffect(
    useCallback(() => {
      const hoyActual = obtenerHoyActual();
      setHoy(hoyActual);
    }, [obtenerHoyActual])
  );

  // Al presionar "Hoy", vuelve a calcular la fecha del reloj al instante
  const manejarIrAHoy = () => {
    const hoyActual = obtenerHoyActual();
    setHoy(hoyActual);
    setDiaPedido(hoyActual);
    setMes(mesDeFecha(hoyActual));
  };

  // Al cambiar de mes el día pedido puede quedar en otro mes: se usa hoy si es de este mes, o el día 1.
  const diaElegido = [diaPedido, hoy].find((dia) => esDelMes(dia, mes)) ?? primerDiaDelMes(mes);
  const { anio, mes: indiceMes } = partesDeMes(mes);

  return (
    <View testID="calendario-contenido" style={styles.contenedor}>
      <View style={styles.navegacion}>
        <NavButton testID="mes-anterior" title="‹" accessibilityLabel="Mes anterior" variant="secondary" style={styles.botonMes} onPress={() => setMes(sumarMeses(mes, -1))} />
        <Text testID="titulo-mes" style={styles.tituloMes} accessibilityRole="header">
          {conMayuscula(formatearMesAnio(anio, indiceMes))}
        </Text>
        <NavButton testID="mes-siguiente" title="›" accessibilityLabel="Mes siguiente" variant="secondary" style={styles.botonMes} onPress={() => setMes(sumarMeses(mes, 1))} />
      </View>
      <NavButton
        testID="ir-a-hoy"
        title="Hoy"
        variant="secondary"
        onPress={manejarIrAHoy}
      />

      <ContenidoConEstado
        estado={estado}
        onReintentar={() => void cargar()}
        esVacio={(cobros) => cobros.length === 0}
        vacio={{ titulo: 'Sin cobros este mes', descripcion: 'Cuando tengas suscripciones con cobros en este mes, aparecerán aquí.' }}
      >
        {(cobros) => (
          <>
            <CuadriculaMes mes={mes} hoy={hoy} diaElegido={diaElegido} cobrosPorDia={contarPorDia(cobros)} onElegirDia={setDiaPedido} />

            <Text style={styles.subtitulo}>{conMayuscula(formatearFechaLarga(diaElegido))}</Text>
            <ListaCobros cobros={cobrosDelDia(cobros, diaElegido)} textoVacio="No hay cobros este día." />

            <Text style={styles.subtitulo}>Agenda del mes</Text>
            {/* Un total por moneda: no se suman monedas distintas. */}
            <Text testID="totales-mes" style={styles.totales}>
              {totalesPorMoneda(cobros)
                .map(({ moneda, total }) => `${moneda} ${formatearImporte(total, moneda)}`)
                .join(' · ')}
            </Text>
            <ListaCobros cobros={cobros} textoVacio="" mostrarFecha />
          </>
        )}
      </ContenidoConEstado>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  navegacion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  botonMes: { minWidth: 48 },
  tituloMes: { flex: 1, textAlign: 'center', color: C.tinta, fontSize: 18, fontWeight: '700' },
  subtitulo: { color: C.tinta, fontSize: 16, fontWeight: '700', marginTop: 8 },
  totales: { color: C.tinta2, fontSize: 13 },
});
