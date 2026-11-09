import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatearFechaHora, type CuentaConectada } from '@ojoalgasto/shared';
import { ContenidoConEstado } from '../../../components/estados';
import { NavButton } from '../NavButton';
import { COLORES_CUENTAS as C } from './estilos';
import { useCuentas, type ApiCuentas } from './useCuentas';

export interface CuentasContenidoProps {
  /** Lleva a la pantalla para conectar un correo (también sirve para reconectar). */
  onConectar: () => void;
  /**
   * Avisa cuando la pantalla vuelve a estar a la vista, por ejemplo al regresar del navegador
   * después de autorizar. Devuelve la función para dejar de escuchar.
   */
  alVolverAPantalla?: (recargar: () => void) => () => void;
  /** Solo en pruebas. */
  api?: ApiCuentas;
}

export function CuentasContenido({ onConectar, alVolverAPantalla, api }: CuentasContenidoProps) {
  const { estado, idsDesconectando, mensajeError, cargar, desconectar } = useCuentas(api);

  useEffect(() => {
    if (!alVolverAPantalla) return undefined;
    return alVolverAPantalla(() => void cargar());
  }, [alVolverAPantalla, cargar]);

  return (
    <View testID="cuentas-contenido" style={styles.contenedor}>
      <ContenidoConEstado
        estado={estado}
        onReintentar={() => void cargar()}
        esVacio={(cuentas) => cuentas.length === 0}
        vacio={{
          titulo: 'Aún no conectas ninguna cuenta',
          descripcion: 'Conecta tu correo para que encontremos tus cobros automáticamente.',
          accion: { etiqueta: 'Conectar correo', onPress: onConectar },
        }}
      >
        {(cuentas) => (
          <>
            {mensajeError ? (
              <Text testID="error-cuentas" style={styles.error} accessibilityRole="alert">
                {mensajeError}
              </Text>
            ) : null}
            {cuentas.map((cuenta) => (
              <TarjetaCuenta
                key={cuenta.id}
                cuenta={cuenta}
                estaDesconectando={idsDesconectando.includes(cuenta.id)}
                onReconectar={onConectar}
                onDesconectar={() => void desconectar(cuenta.id)}
              />
            ))}
            <NavButton testID="conectar-correo" title="Conectar otro correo" variant="secondary" onPress={onConectar} />
          </>
        )}
      </ContenidoConEstado>
    </View>
  );
}

interface TarjetaCuentaProps {
  cuenta: CuentaConectada;
  estaDesconectando: boolean;
  onReconectar: () => void;
  onDesconectar: () => void;
}

function TarjetaCuenta({ cuenta, estaDesconectando, onReconectar, onDesconectar }: TarjetaCuentaProps) {
  // Desconectar quita el acceso a tu correo: se pide confirmar con un segundo toque.
  const [estaConfirmando, setEstaConfirmando] = useState(false);
  const sePuedeDesconectar = cuenta.estado !== 'desconectada';

  return (
    <View testID={`cuenta-${cuenta.id}`} style={[styles.tarjeta, cuenta.necesita_reautorizacion && styles.tarjetaConAviso]}>
      <Text style={styles.proveedor}>{cuenta.proveedor_legible}</Text>
      <Text style={styles.correo}>{cuenta.cuenta_externa}</Text>
      {/* El texto del estado lo traduce el backend; aquí solo se muestra. */}
      <Text testID={`cuenta-estado-${cuenta.id}`} style={styles.estado}>
        {cuenta.estado_legible}
      </Text>
      {cuenta.ultima_sincronizacion ? (
        <Text style={styles.detalle}>Última sincronización: {formatearFechaHora(cuenta.ultima_sincronizacion)}</Text>
      ) : (
        <Text style={styles.detalle}>Aún sin sincronizar</Text>
      )}
      {cuenta.necesita_reautorizacion ? (
        <>
          {cuenta.detalle_del_estado ? <Text style={styles.detalle}>{cuenta.detalle_del_estado}</Text> : null}
          <NavButton
            testID={`reconectar-${cuenta.id}`}
            title="Volver a autorizar"
            variant="secondary"
            onPress={onReconectar}
          />
        </>
      ) : null}
      {sePuedeDesconectar && !estaConfirmando ? (
        <NavButton
          testID={`desconectar-${cuenta.id}`}
          title="Desconectar"
          variant="danger"
          onPress={() => setEstaConfirmando(true)}
        />
      ) : null}
      {sePuedeDesconectar && estaConfirmando ? (
        <View style={styles.confirmacion}>
          <Text style={styles.detalle}>Dejaremos de leer los correos de esta cuenta. Tu historial se conserva.</Text>
          <NavButton
            testID={`confirmar-desconexion-${cuenta.id}`}
            title="Sí, desconectar"
            variant="danger"
            loading={estaDesconectando}
            onPress={() => {
              setEstaConfirmando(false);
              onDesconectar();
            }}
          />
          <NavButton
            testID={`cancelar-desconexion-${cuenta.id}`}
            title="Cancelar"
            variant="secondary"
            onPress={() => setEstaConfirmando(false)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  tarjeta: { backgroundColor: C.superficie, borderRadius: 14, padding: 16, gap: 4, borderWidth: 1, borderColor: C.borde },
  tarjetaConAviso: { borderColor: C.acento },
  proveedor: { color: C.tinta2, fontSize: 13 },
  correo: { color: C.tinta, fontSize: 16, fontWeight: '700' },
  estado: { color: C.acento, fontSize: 14, fontWeight: '600' },
  detalle: { color: C.tinta2, fontSize: 12 },
  error: { color: C.error, fontSize: 14 },
  confirmacion: { gap: 8, marginTop: 8 },
});
