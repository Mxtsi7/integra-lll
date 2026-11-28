import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { EstadoColaUso } from '@ojoalgasto/shared';
import { NavButton } from '../components/NavButton';
import { usoAndroidNativo } from '../../services/usoAndroidNativo';
import { crearControlPermisoUsoAndroid, type EstadoPermisoUsoAndroid } from '../../services/usoAndroid';
import { aceptarUsoAndroid, cicloUsoAndroid, estadoUsoAndroid, pausarUsoAndroid, revocarUsoAndroid } from '../../services/usoAndroidSincronizacion';

const CONTROL_PERMISO = crearControlPermisoUsoAndroid(usoAndroidNativo);
const ETIQUETAS: Record<EstadoPermisoUsoAndroid, string> = {
  cargando: 'Comprobando permiso…', no_disponible: 'Disponible solo en una compilación Android compatible.',
  requerido: 'El permiso de acceso al uso está desactivado.', concedido: 'El permiso de Android está concedido.',
  error: 'No se pudo comprobar el permiso. Inténtalo de nuevo.',
};

export default function UsoRecolectoresScreen() {
  const [permiso, setPermiso] = useState<EstadoPermisoUsoAndroid>('cargando');
  const [paquete, setPaquete] = useState('');
  const [autorizado, setAutorizado] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoColaUso | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const refrescar = useCallback(async () => {
    const datos = await estadoUsoAndroid();
    setEstado(datos.estado); setAutorizado(datos.seleccion?.paquete ?? null);
  }, []);
  const verificar = useCallback(async () => {
    setPermiso('cargando');
    const actual = await CONTROL_PERMISO.verificar(); setPermiso(actual);
    if (actual !== 'concedido') await pausarUsoAndroid().catch(() => {});
    await refrescar();
  }, [refrescar]);
  useEffect(() => {
    let vigente = true;
    void CONTROL_PERMISO.verificar().then(valor => { if (vigente) setPermiso(valor); });
    void estadoUsoAndroid().then(datos => {
      if (vigente) { setEstado(datos.estado); setAutorizado(datos.seleccion?.paquete ?? null); }
    }).catch(() => {});
    const escucha = AppState.addEventListener('change', actual => {
      if (actual === 'active') void verificar().catch(() => {});
    });
    const intervalo = setInterval(() => { void refrescar().catch(() => {}); }, 5000);
    return () => { vigente = false; escucha.remove(); clearInterval(intervalo); };
  }, [refrescar, verificar]);
  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true); setMensaje(null);
    try { await accion(); }
    catch (error) { setMensaje(error instanceof Error ? error.message : 'No se pudo completar.'); }
    finally { await refrescar().catch(() => {}); setOcupado(false); }
  };
  return (
    <ScrollView testID="screen-uso-recolectores" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Acceso de uso</Text>
      <View style={styles.estado}>
        <Text style={styles.etiqueta}>Permiso del sistema</Text>
        <Text testID="estado-permiso-uso">{ETIQUETAS[permiso]}</Text>
      </View>
      <Text>Android gestiona este permiso en Ajustes. Al volver se comprobará de nuevo; abrir Ajustes no concede permiso.</Text>
      <NavButton testID="abrir-ajustes-uso" title="Abrir ajustes de acceso al uso"
        disabled={!usoAndroidNativo || permiso === 'cargando'} onPress={() => void ejecutar(async () => {
          if (!await CONTROL_PERMISO.abrirAjustes()) setPermiso(usoAndroidNativo ? 'error' : 'no_disponible');
        })} />
      <NavButton testID="verificar-permiso-uso" title="Volver a comprobar permiso" variant="secondary"
        disabled={!usoAndroidNativo || permiso === 'cargando'} onPress={() => void ejecutar(verificar)} />
      {usoAndroidNativo?.leerTramos ? <View style={styles.estado}>
        <Text style={styles.etiqueta}>Captura y sincronización</Text>
        <Text>Autoriza un paquete que ya hayas asociado con una suscripción. Se enviarán únicamente intervalos y duración de uso, sin contenido de otras apps. La app consulta mientras está abierta y conserva pendientes para reintentar sin duplicarlos.</Text>
        <Text>Los períodos sin medición se mantienen como desconocidos. Pausar detiene nuevas lecturas; retirar también descarta los pendientes de este recolector. El historial ya recibido se conserva.</Text>
        {autorizado && estado?.fase !== 'revocado' ? <>
          <Text>Paquete autorizado: {autorizado}</Text>
          <Text>Captura: {estado?.fase ?? 'sin autorización'}</Text>
          <Text>Pendientes: {estado?.pendientes.length ?? 0}</Text>
          <Text>Última sincronización: {estado?.ultimoEnvio ? new Date(estado.ultimoEnvio).toLocaleString('es-CL') : 'Sin envíos confirmados'}</Text>
          {estado?.accionPendiente ? <Text>Falta confirmar el cambio con el servidor. Se reintentará al sincronizar.</Text> : null}
          {estado?.error ? <Text>{estado.error}</Text> : null}
          <NavButton title="Sincronizar ahora" loading={ocupado} onPress={() => void ejecutar(cicloUsoAndroid)} />
          {estado?.fase === 'activo' ? <NavButton title="Pausar captura" variant="secondary"
            onPress={() => void ejecutar(pausarUsoAndroid)} /> : estado?.fase === 'pausado' || estado?.fase === 'pendiente' ?
            <NavButton title="Reanudar captura" disabled={ocupado || permiso !== 'concedido'}
              onPress={() => void ejecutar(() => aceptarUsoAndroid(autorizado))} /> : null}
          <NavButton title="Retirar autorización" variant="secondary" onPress={() => void ejecutar(revocarUsoAndroid)} />
        </> : <>
          <TextInput accessibilityLabel="Paquete autorizado para consulta" value={paquete} onChangeText={setPaquete}
            placeholder="com.ejemplo.app" autoCapitalize="none" autoCorrect={false} maxLength={255} />
          <NavButton title="Acepto capturar y sincronizar el uso" loading={ocupado}
            disabled={!paquete.trim() || permiso !== 'concedido'} onPress={() => void ejecutar(() => aceptarUsoAndroid(paquete.trim()))} />
        </>}
        {mensaje ? <Text accessibilityLiveRegion="polite">{mensaje}</Text> : null}
      </View> : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  contenedor: { padding: 20, gap: 16, backgroundColor: '#f8fafc' },
  titulo: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  estado: { padding: 14, borderRadius: 8, gap: 8, backgroundColor: '#e2e8f0' },
  etiqueta: { fontWeight: '700', color: '#334155' },
});
