import React from 'react';
import { Text, View } from 'react-native';
import { formatearFechaHora } from '@ojoalgasto/shared';
import { Loading, NetworkError } from '../../../components/estados';
import { NavButton } from '../NavButton';
import { FilaInterruptor } from './FilaInterruptor';
import { styles } from './notificaciones.styles';
import {
  formatearDiasAnticipacion,
  tieneCanalHabilitado,
  type CanalAviso,
  type ClaveInterruptor,
  type IPermisosDispositivoGateway,
  type IPreferenciasRepository,
} from './domain/preferencias.types';
import {
  usePreferenciasNotificaciones,
} from './usePreferenciasNotificaciones';

const CANALES: { clave: ClaveInterruptor; canal: CanalAviso; etiqueta: string; detalle: string }[] = [
  { clave: 'por_email', canal: 'email', etiqueta: 'Por correo', detalle: 'A la dirección de tu cuenta.' },
  { clave: 'por_push', canal: 'push', etiqueta: 'Notificaciones push', detalle: 'En tu teléfono.' },
  { clave: 'en_la_app', canal: 'in_app', etiqueta: 'Dentro de la app', detalle: 'En tus alertas de Ojo al Gasto.' },
];

const TIPOS: { clave: ClaveInterruptor; etiqueta: string; detalle: (dias: number) => string }[] = [
  {
    clave: 'avisar_proximo_cobro',
    etiqueta: 'Antes de cada cobro',
    detalle: (dias) => formatearDiasAnticipacion(dias),
  },
  {
    clave: 'avisar_fin_prueba',
    etiqueta: 'Cuando termina una prueba gratis',
    detalle: () => 'Antes de que empiece a cobrar.',
  },
  {
    clave: 'avisar_alza_tarifa',
    etiqueta: 'Alza de tarifa',
    detalle: () => 'Cuando una suscripción sube de precio.',
  },
  {
    clave: 'avisar_doble_cobro',
    etiqueta: 'Posible doble cobro',
    detalle: () => 'Cuando parece que te cobraron dos veces lo mismo.',
  },
  {
    clave: 'avisar_presupuesto_excedido',
    etiqueta: 'Presupuesto excedido',
    detalle: () => 'Cuando el gasto del mes supera tu presupuesto.',
  },
];

export interface PreferenciasNotificacionesContenidoProps {
  repository?: IPreferenciasRepository;
  controlPermisos?: IPermisosDispositivoGateway;
  permisosGateway?: IPermisosDispositivoGateway;
  onExitoGuardar?: () => void;
  usuarioId?: string;
}

export function PreferenciasNotificacionesContenido({
  repository,
  controlPermisos,
  permisosGateway,
  onExitoGuardar,
  usuarioId,
}: PreferenciasNotificacionesContenidoProps) {
  const {
    estadoCarga,
    errorCargaMensaje,
    guardadas,
    editadas,
    guardando,
    errorGuardado,
    alertaPushDispositivo,
    permisoDispositivo,
    pushHabilitadoEnDispositivo,
    hayCambios,
    cambiar,
    descartar,
    guardar,
    reintentar,
  } = usePreferenciasNotificaciones({
    repository,
    permisosGateway: permisosGateway ?? controlPermisos,
    onExitoGuardar,
    usuarioId,
  });

  if (estadoCarga === 'cargando') {
    return (
      <View testID="loading-preferencias">
        <Loading mensaje="Cargando tus preferencias…" />
      </View>
    );
  }

  if (estadoCarga === 'error' || !guardadas || !editadas) {
    return (
      <View testID="error-carga">
        <NetworkError mensaje={errorCargaMensaje} onReintentar={() => void reintentar()} />
      </View>
    );
  }

  const canalesActivos = tieneCanalHabilitado(
    editadas.por_email,
    editadas.por_push,
    editadas.en_la_app
  );

  return (
    <View testID="preferencias-notificaciones-contenido">
      {/* Sección Canales de Notificación */}
      <View style={styles.seccion}>
        <Text style={styles.tituloSeccion}>Por dónde</Text>

        <View style={styles.tarjeta}>
          {CANALES.map(({ clave, canal, etiqueta, detalle }, index) => {
            const noDisponibleEnBackend = !guardadas.canales_disponibles.includes(canal);
            const esPush = clave === 'por_push';

            const notaBackend = noDisponibleEnBackend
              ? 'Todavía no lo enviamos. Si lo activas, queda guardado para cuando esté listo.'
              : null;

            let badgeDispositivo: string | null = null;
            let alerta: string | null = null;

            if (esPush) {
              if (permisoDispositivo === 'denegado') {
                badgeDispositivo = 'Canal no habilitado en dispositivo';
                alerta =
                  alertaPushDispositivo ??
                  'Permiso denegado en este dispositivo. No recibirás push aquí hasta activarlo en los ajustes del sistema.';
              } else if (editadas.por_push && !pushHabilitadoEnDispositivo) {
                badgeDispositivo = 'Inactivo en dispositivo';
              }
            }

            return (
              <FilaInterruptor
                key={clave}
                testID={`switch-${clave}`}
                etiqueta={etiqueta}
                detalle={detalle}
                activo={editadas[clave]}
                deshabilitado={guardando}
                onChange={(valor) => void cambiar(clave, valor)}
                nota={notaBackend}
                alerta={alerta}
                alertaTestID={esPush ? 'alerta-push-dispositivo' : undefined}
                badgeDispositivo={badgeDispositivo}
                badgeTestID={esPush ? 'badge-push-dispositivo' : undefined}
                esUltimaFila={index === CANALES.length - 1}
              />
            );
          })}
        </View>

        {/* Indicador de estado del canal push en este dispositivo */}
        <View style={styles.estadoDispositivoContenedor}>
          <Text style={styles.textoEstadoDispositivo}>
            Estado push en este dispositivo:{' '}
            <Text
              testID="estado-push-dispositivo"
              style={
                pushHabilitadoEnDispositivo
                  ? styles.pushHabilitado
                  : styles.pushInhabilitado
              }
            >
              {pushHabilitadoEnDispositivo
                ? 'Habilitado'
                : permisoDispositivo === 'denegado'
                ? 'Inhabilitado (permiso denegado en dispositivo)'
                : 'No habilitado'}
            </Text>
          </Text>
        </View>

        {!canalesActivos && (
          <View style={styles.alertaContenedor} testID="aviso-canales-apagados">
            <Text style={styles.alertaTexto}>
              Con todos los canales apagados no te llega ningún aviso.
            </Text>
          </View>
        )}
      </View>

      {/* Sección Tipos de Avisos */}
      <View style={styles.seccion}>
        <Text style={styles.tituloSeccion}>De qué</Text>

        <View style={styles.tarjeta}>
          {TIPOS.map(({ clave, etiqueta, detalle }, index) => (
            <FilaInterruptor
              key={clave}
              testID={`switch-${clave}`}
              etiqueta={etiqueta}
              detalle={detalle(editadas.dias_anticipacion)}
              activo={editadas[clave]}
              deshabilitado={guardando}
              onChange={(valor) => void cambiar(clave, valor)}
              esUltimaFila={index === TIPOS.length - 1}
            />
          ))}
        </View>
      </View>

      {/* Error de guardado */}
      {errorGuardado ? (
        <View style={styles.errorGuardadoContenedor} testID="error-guardado">
          <Text style={styles.errorGuardadoTexto}>{errorGuardado}</Text>
        </View>
      ) : null}

      {/* Pie de guardado y acciones */}
      <View style={styles.pie}>
        <Text
          testID="estado-cambios"
          style={hayCambios ? styles.estadoPendiente : styles.estadoGuardado}
        >
          {hayCambios
            ? 'Tienes cambios sin guardar.'
            : `Guardado · ${formatearFechaHora(guardadas.actualizado_en)}`}
        </Text>

        <View style={styles.acciones}>
          <NavButton
            testID="btn-descartar"
            title="Descartar"
            variant="secondary"
            disabled={!hayCambios || guardando}
            onPress={descartar}
            style={styles.botonAccion}
          />
          <NavButton
            testID="btn-guardar"
            title="Guardar cambios"
            variant="primary"
            disabled={!hayCambios}
            loading={guardando}
            onPress={() => void guardar()}
            style={styles.botonAccion}
          />
        </View>
      </View>
    </View>
  );
}
