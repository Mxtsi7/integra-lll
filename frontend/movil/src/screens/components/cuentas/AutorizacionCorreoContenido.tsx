import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { ProveedorCorreo } from '@ojoalgasto/shared';
import { NavButton } from '../NavButton';
import { COLORES_CUENTAS as C } from './estilos';
import { useAutorizacionCorreo, type ApiAutorizacion } from './useAutorizacionCorreo';

const PROVEEDORES: { proveedor: ProveedorCorreo; nombre: string }[] = [
  { proveedor: 'gmail', nombre: 'Gmail' },
  { proveedor: 'outlook', nombre: 'Outlook' },
];

export interface AutorizacionCorreoContenidoProps {
  onVerCuentas: () => void;
  /** Solo en pruebas. */
  api?: ApiAutorizacion;
  /** Solo en pruebas; en la app abre el navegador del teléfono. */
  abrirUrl?: (url: string) => Promise<unknown>;
}

export function AutorizacionCorreoContenido({
  onVerCuentas,
  api,
  abrirUrl = (url) => Linking.openURL(url),
}: AutorizacionCorreoContenidoProps) {
  const { estado, iniciar } = useAutorizacionCorreo(abrirUrl, api);
  const estaIniciando = estado.tipo === 'iniciando';

  return (
    <View testID="autorizacion-contenido" style={styles.contenedor}>
      <Text style={styles.texto}>
        Elige tu proveedor. Se abrirá su página en el navegador para que autorices la lectura de tus correos de cobro.
      </Text>

      {PROVEEDORES.map(({ proveedor, nombre }) => (
        <NavButton
          key={proveedor}
          testID={`conectar-${proveedor}`}
          title={`Conectar ${nombre}`}
          variant={proveedor === 'gmail' ? 'primary' : 'secondary'}
          loading={estado.tipo === 'iniciando' && estado.proveedor === proveedor}
          disabled={estaIniciando}
          onPress={() => void iniciar(proveedor)}
        />
      ))}

      {estado.tipo === 'error' ? (
        <Text testID="error-autorizacion" style={styles.error} accessibilityRole="alert">
          {estado.mensaje}
        </Text>
      ) : null}

      {estado.tipo === 'esperando' ? (
        <View testID="autorizacion-esperando" style={styles.aviso}>
          <Text style={styles.texto}>
            Termina en el navegador y vuelve a la app. Si cancelaste, no se conectó ninguna cuenta.
          </Text>
          <NavButton testID="ver-cuentas" title="Ver cuentas conectadas" variant="secondary" onPress={onVerCuentas} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  texto: { color: C.tinta2, fontSize: 14 },
  error: { color: C.error, fontSize: 14 },
  aviso: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde },
});
