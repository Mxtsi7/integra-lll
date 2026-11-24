import React from 'react';
import { Switch, Text, View } from 'react-native';
import { styles } from './notificaciones.styles';

export interface FilaInterruptorProps {
  testID: string;
  etiqueta: string;
  detalle: string;
  activo: boolean;
  deshabilitado?: boolean;
  onChange: (valor: boolean) => void;
  nota?: string | null;
  alerta?: string | null;
  alertaTestID?: string;
  badgeDispositivo?: string | null;
  badgeTestID?: string;
  esUltimaFila?: boolean;
}

export function FilaInterruptor({
  testID,
  etiqueta,
  detalle,
  activo,
  deshabilitado = false,
  onChange,
  nota,
  alerta,
  alertaTestID,
  badgeDispositivo,
  badgeTestID,
  esUltimaFila = false,
}: FilaInterruptorProps) {
  return (
    <View
      style={[styles.fila, esUltimaFila && styles.filaSinBorde]}
      testID={`fila-${testID}`}
    >
      <View style={styles.textoContenedor}>
        <Text style={styles.etiqueta}>{etiqueta}</Text>
        <Text style={styles.detalle}>{detalle}</Text>

        {badgeDispositivo ? (
          <View style={styles.badge} testID={badgeTestID ?? `badge-${testID}`}>
            <Text style={styles.badgeTexto}>{badgeDispositivo}</Text>
          </View>
        ) : null}

        {nota ? (
          <Text style={styles.nota} testID={`nota-${testID}`}>
            {nota}
          </Text>
        ) : null}

        {alerta ? (
          <Text style={styles.alerta} testID={alertaTestID ?? `alerta-${testID}`}>
            {alerta}
          </Text>
        ) : null}
      </View>

      <View style={styles.switchContenedor}>
        <Switch
          testID={testID}
          value={activo}
          disabled={deshabilitado}
          onValueChange={onChange}
          accessibilityLabel={etiqueta}
          trackColor={{ false: '#334155', true: '#38bdf8' }}
          thumbColor={activo ? '#ffffff' : '#94a3b8'}
        />
      </View>
    </View>
  );
}
