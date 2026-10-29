import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Usuario } from '@ojoalgasto/shared';
import { EditarNombre } from './EditarNombre';
import { COLORES_PERFIL as C } from './estilos';

export interface PerfilContenidoProps {
  usuario: Usuario;
  onGuardarNombre: (nombre: string) => Promise<unknown>;
}

function Fila({ etiqueta, valor, testID }: { etiqueta: string; valor: string; testID: string }) {
  return (
    <View style={styles.fila}>
      <Text style={styles.valor}>
        <Text style={styles.etiqueta}>{etiqueta}: </Text>
        <Text testID={testID}>{valor}</Text>
      </Text>
    </View>
  );
}

/** Solo el nombre se puede editar. Correo, rol, plan y organización son de solo lectura. */
export function PerfilContenido({ usuario, onGuardarNombre }: PerfilContenidoProps) {
  return (
    <View testID="perfil-contenido" style={styles.tarjeta}>
      <EditarNombre nombreActual={usuario.nombre} onGuardar={onGuardarNombre} />
      <Fila etiqueta="Correo" valor={usuario.correo} testID="perfil-correo" />
      <Fila etiqueta="Rol" valor={usuario.rol} testID="perfil-rol" />
      <Fila etiqueta="Plan" valor={usuario.plan} testID="perfil-plan" />
      <Fila
        etiqueta="Organización"
        valor={usuario.organizacion_id || 'No asignada'}
        testID="perfil-organizacion"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    backgroundColor: C.superficie,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  fila: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borde,
    gap: 4,
  },
  etiqueta: { color: C.tinta2, fontSize: 13 },
  valor: { color: C.tinta, fontSize: 16 },
});
