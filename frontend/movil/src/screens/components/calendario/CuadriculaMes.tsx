import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatearFechaLarga, nombresDiasSemana } from '@ojoalgasto/shared';
import { COLORES_CALENDARIO as C } from './estilos';
import { semanasDelMes } from './fechas';

export interface CuadriculaMesProps {
  mes: string;
  hoy: string;
  diaElegido: string;
  /** Cuántos cobros tiene cada día; los días que no aparecen no tienen. */
  cobrosPorDia: Record<string, number>;
  onElegirDia: (dia: string) => void;
}

/** El mes en cuadrícula, de lunes a domingo. Los días con cobros llevan un punto. */
export function CuadriculaMes({ mes, hoy, diaElegido, cobrosPorDia, onElegirDia }: CuadriculaMesProps) {
  const encabezados = nombresDiasSemana('short');

  return (
    <View testID="cuadricula-mes" style={styles.cuadricula}>
      <View style={styles.semana}>
        {encabezados.map((nombre) => (
          <Text key={nombre} style={[styles.celda, styles.encabezado]}>
            {nombre}
          </Text>
        ))}
      </View>
      {semanasDelMes(mes).map((semana, indice) => (
        <View key={indice} style={styles.semana}>
          {semana.map((dia, posicion) =>
            dia === null ? (
              <View key={`vacio-${posicion}`} style={styles.celda} />
            ) : (
              <CeldaDia
                key={dia}
                dia={dia}
                esHoy={dia === hoy}
                estaElegido={dia === diaElegido}
                cantidadDeCobros={cobrosPorDia[dia] ?? 0}
                onElegir={onElegirDia}
              />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

interface CeldaDiaProps {
  dia: string;
  esHoy: boolean;
  estaElegido: boolean;
  cantidadDeCobros: number;
  onElegir: (dia: string) => void;
}

function CeldaDia({ dia, esHoy, estaElegido, cantidadDeCobros, onElegir }: CeldaDiaProps) {
  const numeroDelDia = Number(dia.slice(8));
  const resumenDeCobros = cantidadDeCobros === 0 ? 'sin cobros' : `${cantidadDeCobros} ${cantidadDeCobros === 1 ? 'cobro' : 'cobros'}`;

  return (
    <Pressable
      testID={`dia-${dia}`}
      style={[styles.celda, styles.dia, esHoy && styles.diaDeHoy, estaElegido && styles.diaElegido]}
      onPress={() => onElegir(dia)}
      accessibilityRole="button"
      accessibilityLabel={`${formatearFechaLarga(dia)}, ${resumenDeCobros}`}
      accessibilityState={{ selected: estaElegido }}
    >
      <Text style={[styles.numero, estaElegido && styles.numeroElegido]}>{numeroDelDia}</Text>
      {cantidadDeCobros > 0 ? <Text style={[styles.punto, estaElegido && styles.numeroElegido]}>●</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cuadricula: { gap: 4 },
  semana: { flexDirection: 'row', gap: 4 },
  celda: { flex: 1, minHeight: 44 },
  encabezado: { color: C.tinta2, fontSize: 12, textAlign: 'center' },
  dia: { alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  diaDeHoy: { borderWidth: 1, borderColor: C.acento },
  diaElegido: { backgroundColor: C.acento },
  numero: { color: C.tinta, fontSize: 14 },
  numeroElegido: { color: C.acentoTinta, fontWeight: '700' },
  punto: { color: C.acento, fontSize: 8 },
});
