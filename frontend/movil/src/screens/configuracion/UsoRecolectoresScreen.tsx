import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { obtenerAccessToken, sesionDelToken } from '@ojoalgasto/shared';
import { validarPaqueteAndroid } from '../../services/asociacionPaquetes';
import { NavButton } from '../components/NavButton';
import { usoAndroidNativo } from '../../services/usoAndroidNativo';
import { crearControlPermisoUsoAndroid, crearControlUsoAndroid, type AlcanceUsoAndroid, type EstadoPermisoUsoAndroid } from '../../services/usoAndroid';

const CONTROL_PERMISO = crearControlPermisoUsoAndroid(usoAndroidNativo);

const VENTANA_MAXIMA_MS = 86_400_000;

function obtenerSesionUso(): string | null {
  const token = obtenerAccessToken();
  return token ? sesionDelToken(token) : null;
}

const ETIQUETAS_PERMISO: Record<EstadoPermisoUsoAndroid, string> = {
  cargando: 'Comprobando permiso…',
  no_disponible: 'Disponible solo en una compilación Android compatible.',
  requerido: 'El permiso de acceso al uso está desactivado.',
  concedido: 'El permiso de Android está concedido.',
  error: 'No se pudo comprobar el permiso. Inténtalo de nuevo.',
};

export default function UsoRecolectoresScreen() {
  const [estadoPermiso, setEstadoPermiso] = useState<EstadoPermisoUsoAndroid>('cargando');

  const [paquete, setPaquete] = useState('');
  const [paqueteAceptado, setPaqueteAceptado] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);
  const consentimiento = useRef<{ sesion: string; alcance: AlcanceUsoAndroid } | null>(null);
  const generacion = useRef(0);

  const retirar = useCallback(() => {
    consentimiento.current = null;
    setPaqueteAceptado(null);
    setResultado(null);
    setConsultando(false);
  }, []);

  const verificarPermiso = useCallback(async () => {
    setEstadoPermiso('cargando');
    const permiso = await CONTROL_PERMISO.verificar();
    setEstadoPermiso(permiso);
    if (permiso !== 'concedido' || consentimiento.current?.sesion !== obtenerSesionUso()) retirar();
  }, [retirar]);

  useEffect(() => {
    void CONTROL_PERMISO.verificar().then(setEstadoPermiso);
    const suscripcion = AppState.addEventListener('change', (estadoAplicacion) => {
      if (estadoAplicacion === 'active') void verificarPermiso();
    });
    return () => {
      consentimiento.current = null;
      suscripcion.remove();
    };
  }, [verificarPermiso]);

  const abrirAjustes = async () => {
    const seAbrieron = await CONTROL_PERMISO.abrirAjustes();
    if (!seAbrieron) setEstadoPermiso(usoAndroidNativo ? 'error' : 'no_disponible');
  };

  const aceptar = () => {
    const sesion = obtenerSesionUso();
    if (!sesion || estadoPermiso !== 'concedido' || !usoAndroidNativo?.leerTramos) {
      setResultado('Necesitas una sesión activa y acceso de uso en Android.');
      return;
    }
    try {
      const autorizado = validarPaqueteAndroid(paquete);
      consentimiento.current = {
        sesion,
        alcance: { id: String(++generacion.current), desdeMs: Date.now(), paquetes: [autorizado] },
      };
      setPaqueteAceptado(autorizado);
      setResultado(null);
    } catch (error) {
      setResultado(error instanceof RangeError ? error.message : 'No se pudo autorizar la lectura.');
    }
  };

  const consultar = async () => {
    const aceptacion = consentimiento.current;
    if (!aceptacion) return;
    if (aceptacion.sesion !== obtenerSesionUso()) {
      retirar();
      return;
    }
    const finMs = Date.now();
    if (finMs <= aceptacion.alcance.desdeMs) return;
    const alcanceVigente = () => consentimiento.current?.sesion === obtenerSesionUso()
      ? consentimiento.current?.alcance ?? null : null;
    const control = crearControlUsoAndroid(
      usoAndroidNativo, obtenerSesionUso, () => alcanceVigente() !== null, alcanceVigente,
    );
    setConsultando(true);
    setResultado(null);
    try {
      const lectura = await control.leerTramos(Math.max(aceptacion.alcance.desdeMs, finMs - VENTANA_MAXIMA_MS), finMs);
      if (consentimiento.current !== aceptacion || !alcanceVigente()) return;
      if (lectura.estado === 'revocado' || lectura.estado === 'sin_permiso') {
        retirar();
        setEstadoPermiso('requerido');
        return;
      }
      setResultado(lectura.estado !== 'disponible'
        ? 'No se pudo realizar la consulta.'
        : lectura.tramos.length
          ? `Intervalos encontrados: ${lectura.tramos.length}.`
          : 'No se encontraron intervalos completos en la consulta.');
    } catch {
      if (consentimiento.current === aceptacion && alcanceVigente()) {
        setResultado('No se pudo realizar la consulta.');
      }
    } finally {
      if (consentimiento.current === aceptacion) {
        if (alcanceVigente()) setConsultando(false);
        else retirar();
      }
    }
  };

  return (
    <ScrollView testID="screen-uso-recolectores" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Acceso de uso</Text>
      <View style={styles.estado}>
        <Text style={styles.etiqueta}>Permiso del sistema</Text>
        <Text testID="estado-permiso-uso">{ETIQUETAS_PERMISO[estadoPermiso]}</Text>
      </View>
      <Text style={styles.texto}>
        Android gestiona este permiso en Ajustes. Al volver a la app se comprobará de nuevo;
        abrir Ajustes no se considera una concesión.
      </Text>
      <Text style={styles.texto}>
        Puedes autorizar una consulta local del paquete que elijas. Se leen los inicios y fines
        de uso desde tu aceptación. La consulta no se envía al servidor ni se guarda como
        historial. Puedes retirar la autorización aquí o salir de esta pantalla.
      </Text>
      <NavButton
        testID="abrir-ajustes-uso"
        title="Abrir ajustes de acceso al uso"
        onPress={() => void abrirAjustes()}
        disabled={!usoAndroidNativo || estadoPermiso === 'cargando'}
      />
      <NavButton
        testID="verificar-permiso-uso"
        title="Volver a comprobar permiso"
        variant="secondary"
        onPress={() => void verificarPermiso()}
        disabled={!usoAndroidNativo || estadoPermiso === 'cargando'}
      />
      {usoAndroidNativo?.leerTramos ? (
        <View style={styles.estado}>
          <Text style={styles.etiqueta}>Consulta local de uso</Text>
          {paqueteAceptado ? (
            <>
              <Text>Paquete autorizado: {paqueteAceptado}</Text>
              <NavButton title="Consultar intervalos" loading={consultando}
                disabled={estadoPermiso !== 'concedido'} onPress={() => void consultar()} />
              <NavButton title="Retirar autorización" variant="secondary" onPress={retirar} />
            </>
          ) : (
            <>
              <TextInput accessibilityLabel="Paquete autorizado para consulta"
                value={paquete} onChangeText={setPaquete} placeholder="com.ejemplo.app"
                autoCapitalize="none" autoCorrect={false} maxLength={255} />
              <NavButton title="Acepto autorizar la consulta local"
                disabled={!paquete.trim() || estadoPermiso !== 'concedido'} onPress={aceptar} />
            </>
          )}
          {resultado ? <Text accessibilityLiveRegion="polite">{resultado}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, gap: 16, backgroundColor: '#f8fafc' },
  titulo: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  estado: { padding: 14, borderRadius: 8, gap: 6, backgroundColor: '#e2e8f0' },
  etiqueta: { fontWeight: '700', color: '#334155' },
  texto: { color: '#475569', lineHeight: 22 },
});
