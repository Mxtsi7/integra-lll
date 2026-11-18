import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  costoPorHora,
  eliminarSuscripcion,
  equivalenteMensual,
  ErrorDeApi,
  formatearHoras,
  formatearMonto,
  getSuscripcion,
  getUsos,
  registrarUso,
  type RegistroUso,
  type Suscripcion,
} from '@ojoalgasto/shared';
import { ConfirmarRetiroModal } from './ConfirmarRetiroModal';
import { HistorialUsoMovil, type EstadoHistorialUso } from './HistorialUsoMovil';
import { RegistrarUsoModal } from './RegistrarUsoModal';
import { Loading } from '../../components/estados/Loading';
import { NetworkError } from '../../components/estados/NetworkError';
import { NavButton } from '../components/NavButton';
import {
  ESTADOS_SUSCRIPCION,
  formatearTextoCobro,
  sufijoFrecuencia,
} from '../components/TarjetaSuscripcion';
import type { HomeScreenProps } from '../../navigation/types';
import { styles } from './SuscripcionDetalleScreen.styles';

export type EstadoDetalle =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; suscripcion: Suscripcion }
  | { tipo: 'no-encontrada' }
  | { tipo: 'no-autorizada' }
  | { tipo: 'error'; mensaje?: string };

export interface SuscripcionDetalleViewProps {
  id: string;
  estado: EstadoDetalle;
  onVolver: () => void;
  onReintentar: () => void;
  onEditar?: (suscripcion: Suscripcion) => void;
  onEliminar?: (suscripcion: Suscripcion) => void;
  onRegistrarUso?: (suscripcion: Suscripcion) => void;
  estadoHistorial?: EstadoHistorialUso;
  onReintentarHistorial?: () => void;
}

/**
 * Componente presentacional puro para el detalle de una suscripción.
 * Aislado de hooks de navegación directa o llamadas de red.
 */
export function SuscripcionDetalleView({
  id,
  estado,
  onVolver,
  onReintentar,
  onEditar,
  onEliminar,
  onRegistrarUso,
  estadoHistorial = { tipo: 'listo', usos: [] },
  onReintentarHistorial,
}: SuscripcionDetalleViewProps) {
  if (estado.tipo === 'cargando') {
    return (
      <View style={styles.safeArea} testID="screen-suscripcion-detalle">
        <View style={styles.contenedor}>
          <View style={styles.header}>
            <View style={styles.headerInfo}>
              <Text style={styles.titulo} accessibilityRole="header">
                Detalle de Suscripción
              </Text>
              <Text style={styles.idText}>ID Suscripción: {id}</Text>
            </View>
            <NavButton
              testID="go-back"
              title="Volver"
              variant="secondary"
              onPress={onVolver}
              style={styles.botonVolver}
            />
          </View>
          <Loading />
        </View>
      </View>
    );
  }

  if (estado.tipo === 'no-encontrada') {
    return (
      <View style={styles.safeArea} testID="screen-suscripcion-detalle">
        <View style={styles.contenedor}>
          <View style={styles.cajaMensaje} accessibilityRole="alert">
            <Text style={styles.cajaMensajeTitulo}>Suscripción no encontrada</Text>
            <Text style={styles.cajaMensajeTexto}>
              No encontramos esa suscripción. Puede que haya sido eliminada.
            </Text>
            <NavButton
              testID="go-back"
              title="Volver a la lista"
              variant="primary"
              onPress={onVolver}
              style={styles.botonAccion}
            />
          </View>
        </View>
      </View>
    );
  }

  if (estado.tipo === 'no-autorizada') {
    return (
      <View style={styles.safeArea} testID="screen-suscripcion-detalle">
        <View style={styles.contenedor}>
          <View style={styles.cajaMensaje} accessibilityRole="alert">
            <Text style={styles.cajaMensajeTitulo}>Acceso no autorizado</Text>
            <Text style={styles.cajaMensajeTexto}>
              No tienes permiso para ver esta suscripción.
            </Text>
            <NavButton
              testID="go-back"
              title="Volver a la lista"
              variant="primary"
              onPress={onVolver}
              style={styles.botonAccion}
            />
          </View>
        </View>
      </View>
    );
  }

  if (estado.tipo === 'error') {
    return (
      <View style={styles.safeArea} testID="screen-suscripcion-detalle">
        <View style={styles.contenedor}>
          <View style={styles.header}>
            <View style={styles.headerInfo}>
              <Text style={styles.titulo} accessibilityRole="header">
                Detalle de Suscripción
              </Text>
              <Text style={styles.idText}>ID Suscripción: {id}</Text>
            </View>
            <NavButton
              testID="go-back"
              title="Volver"
              variant="secondary"
              onPress={onVolver}
              style={styles.botonVolver}
            />
          </View>
          <NetworkError
            onReintentar={onReintentar}
            mensaje={estado.mensaje ?? 'No pudimos cargar esta suscripción.'}
          />
        </View>
      </View>
    );
  }

  const { suscripcion } = estado;
  const { nombre, categoria, monto, moneda, frecuencia, estado: estadoSub, horas_uso_mes } =
    suscripcion;

  const infoEstado = ESTADOS_SUSCRIPCION[estadoSub] ?? {
    etiqueta: estadoSub,
    fondo: '#334155',
    texto: '#ffffff',
  };

  const montoMensual = equivalenteMensual(monto, frecuencia);
  const textoCobro = formatearTextoCobro(suscripcion);
  const valorPorHora =
    horas_uso_mes !== undefined && horas_uso_mes > 0
      ? costoPorHora(montoMensual, horas_uso_mes)
      : null;

  return (
    <View style={styles.safeArea} testID="screen-suscripcion-detalle">
      <ScrollView
        style={styles.contenedor}
        contentContainerStyle={styles.scrollContenido}
        testID="scroll-detalle"
      >
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.titulo} accessibilityRole="header">
              {nombre}
            </Text>
            <Text style={styles.subtitulo}>{categoria}</Text>
            <Text style={styles.idText}>ID Suscripción: {id}</Text>
          </View>
          <NavButton
            testID="go-back"
            title="Volver a la lista"
            variant="secondary"
            onPress={onVolver}
            style={styles.botonVolver}
          />
        </View>

        {/* Tarjeta principal con monto, frecuencia y badge accesible */}
        <View style={styles.tarjetaPrincipal}>
          <View style={styles.tarjetaPrincipalFila}>
            <View>
              <Text style={styles.montoEtiqueta}>Monto recurrente</Text>
              <Text style={styles.montoValor}>
                {formatearMonto(monto, moneda)}{' '}
                <Text style={styles.periodoTexto}>{sufijoFrecuencia(frecuencia)}</Text>
              </Text>
              {frecuencia === 'anual' ? (
                <Text style={styles.equivalenteTexto}>
                  Equivale a {formatearMonto(montoMensual, moneda)} al mes
                </Text>
              ) : null}
            </View>
            <View style={[styles.badge, { backgroundColor: infoEstado.fondo }]}>
              <Text style={[styles.badgeTexto, { color: infoEstado.texto }]}>
                {infoEstado.etiqueta}
              </Text>
            </View>
          </View>
        </View>

        {/* Aviso preventivo para suscripción fantasma sin uso */}
        {estadoSub === 'fantasma' ? (
          <View style={styles.avisoFantasma} testID="aviso-fantasma">
            <Text style={styles.avisoFantasmaTitulo}>Suscripción sin uso prolongado</Text>
            <Text style={styles.avisoFantasmaTexto}>
              Lleva más de 45 días sin uso registrado y sigue cobrando. Si no la vas a usar,
              retirarla te ahorra {formatearMonto(montoMensual, moneda)} al mes.
            </Text>
          </View>
        ) : null}

        {/* Cuadrícula de datos descriptivos */}
        <View style={styles.seccionCuadricula} testID="cuadricula-datos">
          <Text style={styles.seccionTitulo}>Detalles del cobro y uso</Text>

          <View style={styles.datoFila}>
            <Text style={styles.datoEtiqueta}>Próximo cobro</Text>
            <Text style={styles.datoValor}>{textoCobro}</Text>
          </View>

          <View style={styles.datoFila}>
            <Text style={styles.datoEtiqueta}>Categoría</Text>
            <Text style={styles.datoValor}>{categoria}</Text>
          </View>

          <View style={styles.datoFila}>
            <Text style={styles.datoEtiqueta}>Periodicidad</Text>
            <Text style={styles.datoValor}>{frecuencia}</Text>
          </View>

          {horas_uso_mes !== undefined && horas_uso_mes > 0 ? (
            <>
              <View style={styles.datoFila}>
                <Text style={styles.datoEtiqueta}>Uso del mes</Text>
                <Text style={styles.datoValor}>{formatearHoras(horas_uso_mes)}</Text>
              </View>

              {valorPorHora !== null ? (
                <View style={styles.datoFila}>
                  <Text style={styles.datoEtiqueta}>Costo estimado por hora</Text>
                  <Text style={styles.datoValor}>{formatearMonto(valorPorHora, moneda)}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        {/* Sección de Historial y Registro de Uso (SE-28 y SE-30) */}
        <View style={styles.seccionCuadricula} testID="seccion-historial-uso">
          <Text style={styles.seccionTitulo}>Historial y Registro de Uso</Text>
          <Text style={styles.seccionDescripcion}>
            Registra los minutos u horas que utilizas esta suscripción para optimizar tu presupuesto.
          </Text>
          <NavButton
            testID="btn-registrar-uso"
            title="Registrar Uso"
            variant="secondary"
            onPress={() => onRegistrarUso?.(suscripcion)}
            style={styles.botonAccion}
          />
          <HistorialUsoMovil
            estado={estadoHistorial}
            onReintentar={onReintentarHistorial ?? (() => {})}
          />
        </View>

        {/* Acciones principales de suscripción (SE-24 y SE-26) */}
        <View style={styles.seccionAcciones}>
          <NavButton
            testID="btn-editar-suscripcion"
            title="Editar Suscripción"
            variant="secondary"
            onPress={() => onEditar?.(suscripcion)}
            style={styles.botonAccion}
          />
          <NavButton
            testID="btn-eliminar-suscripcion"
            title="Retirar Suscripción"
            variant="danger"
            onPress={() => onEliminar?.(suscripcion)}
            style={styles.botonAccion}
          />
        </View>
      </ScrollView>
    </View>
  );
}

export interface SuscripcionDetalleContainerProps {
  navigation?: {
    goBack?: () => void;
    navigate?: (pantalla: any, params?: any) => void;
    addListener?: (event: string, callback: () => void) => () => void;
  };
  route?: {
    params?: { id?: string; suscripcion?: Suscripcion };
  };
  onCargarSuscripcion?: (id: string) => Promise<Suscripcion>;
  onEliminarSuscripcion?: (id: string) => Promise<void>;
  onRetiroExitoso?: (id: string) => void;
  estadoInicial?: EstadoDetalle;
  onEditar?: (suscripcion: Suscripcion) => void;
  onEliminar?: (suscripcion: Suscripcion) => void;
  onRegistrarUso?: (suscripcion: Suscripcion) => void;
  onRegistrarUsoApi?: (id: string, payload: { minutos: number; fecha?: string }) => Promise<Suscripcion>;
  onUsoRegistrado?: (suscripcionActualizada: Suscripcion) => void;
  onCargarHistorial?: (id: string) => Promise<RegistroUso[]>;
  estadoHistorialInicial?: EstadoHistorialUso;
}

export default function SuscripcionDetalleScreen({
  navigation,
  route,
  onCargarSuscripcion = getSuscripcion,
  onEliminarSuscripcion = eliminarSuscripcion,
  onRetiroExitoso,
  estadoInicial,
  onEditar,
  onEliminar,
  onRegistrarUso,
  onRegistrarUsoApi = registrarUso,
  onUsoRegistrado,
  onCargarHistorial = getUsos,
  estadoHistorialInicial,
}: (HomeScreenProps<'SuscripcionDetalle'> & SuscripcionDetalleContainerProps) | SuscripcionDetalleContainerProps) {
  const id = route?.params?.id ?? '';

  const [estado, setEstado] = useState<EstadoDetalle>(
    estadoInicial ?? { tipo: 'cargando' }
  );

  // Estado del historial de uso (SE-30)
  const [estadoHistorial, setEstadoHistorial] = useState<EstadoHistorialUso>(
    estadoHistorialInicial ?? { tipo: 'cargando' }
  );

  // Estados para modal de confirmación y retiro (SE-26)
  const [mostrarModalRetiro, setMostrarModalRetiro] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorRetiro, setErrorRetiro] = useState<string | null>(null);
  const eliminandoRef = useRef(false);

  // Estados para modal de registro de minutos de uso (SE-28)
  const [mostrarModalUso, setMostrarModalUso] = useState(false);
  const [registrandoUso, setRegistrandoUso] = useState(false);
  const registrandoUsoRef = useRef(false);

  // Contador de generación e id activo para invalidar respuestas atrasadas y proteger contra desmontaje
  const generacionRef = useRef(0);
  const generacionHistorialRef = useRef(0);
  const idActualRef = useRef(id);
  idActualRef.current = id;

  const cargarHistorial = useCallback(
    async (idObjetivo: string) => {
      if (!idObjetivo) {
        setEstadoHistorial({ tipo: 'listo', usos: [] });
        return;
      }
      generacionHistorialRef.current += 1;
      const generacionHistorialActual = generacionHistorialRef.current;
      const generacionActual = generacionRef.current;
      const sigueVigente = () =>
        generacionRef.current === generacionActual &&
        generacionHistorialRef.current === generacionHistorialActual &&
        idActualRef.current === idObjetivo;

      setEstadoHistorial({ tipo: 'cargando' });
      try {
        const usos = await onCargarHistorial(idObjetivo);
        if (!sigueVigente()) return;
        setEstadoHistorial({ tipo: 'listo', usos });
      } catch {
        if (!sigueVigente()) return;
        setEstadoHistorial({
          tipo: 'error',
          mensaje: 'No pudimos cargar el historial de uso.',
        });
      }
    },
    [onCargarHistorial]
  );

  const cargarDatos = useCallback(
    async (idObjetivo: string) => {
      generacionRef.current += 1;
      const generacionActual = generacionRef.current;

      const sigueVigente = () =>
        generacionRef.current === generacionActual && idActualRef.current === idObjetivo;

      if (!idObjetivo) {
        if (sigueVigente()) {
          setEstado({ tipo: 'no-encontrada' });
          setEstadoHistorial({ tipo: 'listo', usos: [] });
        }
        return;
      }

      if (sigueVigente()) {
        setEstado({ tipo: 'cargando' });
      }

      void cargarHistorial(idObjetivo);

      try {
        const suscripcion = await onCargarSuscripcion(idObjetivo);
        if (!sigueVigente()) return;
        setEstado({ tipo: 'listo', suscripcion });
      } catch (err: unknown) {
        if (!sigueVigente()) return;
        if (err instanceof ErrorDeApi) {
          if (err.status === 404) {
            setEstado({ tipo: 'no-encontrada' });
            return;
          }
          if (err.status === 403) {
            setEstado({ tipo: 'no-autorizada' });
            return;
          }
        }
        setEstado({
          tipo: 'error',
          mensaje: 'No pudimos cargar esta suscripción. Revisa tu conexión e inténtalo de nuevo.',
        });
      }
    },
    [onCargarSuscripcion]
  );

  useEffect(() => {
    if (route?.params?.suscripcion) {
      setEstado({ tipo: 'listo', suscripcion: route.params.suscripcion });
    }
  }, [route?.params?.suscripcion]);

  useEffect(() => {
    if (estadoInicial) return;
    void cargarDatos(id);

    const unsubscribe = (navigation as any)?.addListener?.('focus', () => {
      void cargarDatos(id);
    });

    return () => {
      unsubscribe?.();
      // Al cambiar id o desmontar el componente, se avanza la generación
      // para descartar inmediatamente cualquier respuesta pendiente en vuelo.
      generacionRef.current += 1;
      generacionHistorialRef.current += 1;
    };
  }, [id, estadoInicial, cargarDatos, navigation]);

  const manejarVolver = () => {
    if (navigation?.goBack) {
      navigation.goBack();
    }
  };

  const manejarEditar = (sub: Suscripcion) => {
    if (onEditar) {
      onEditar(sub);
    } else if (navigation?.navigate) {
      navigation.navigate('SuscripcionEditar', { id: sub.id, suscripcion: sub });
    }
  };

  const manejarEliminar = (sub: Suscripcion) => {
    onEliminar?.(sub);
    setErrorRetiro(null);
    setMostrarModalRetiro(true);
  };

  const cerrarModalRetiro = () => {
    if (isDeleting) return;
    setMostrarModalRetiro(false);
    setErrorRetiro(null);
  };

  const manejarRegistrarUso = (sub: Suscripcion) => {
    onRegistrarUso?.(sub);
    setMostrarModalUso(true);
  };

  const cerrarModalUso = () => {
    if (registrandoUsoRef.current || registrandoUso) return;
    setMostrarModalUso(false);
  };

  const ejecutarRegistrarUso = async (
    minutos: number,
    fecha?: string
  ): Promise<Suscripcion> => {
    if (estado.tipo !== 'listo') {
      throw new Error('No hay suscripción activa para registrar uso');
    }
    if (registrandoUsoRef.current) {
      throw new Error('Ya hay un registro de uso en curso para esta suscripción');
    }
    const idSuscripcion = estado.suscripcion.id;
    registrandoUsoRef.current = true;
    setRegistrandoUso(true);

    try {
      const actualizada = await onRegistrarUsoApi(idSuscripcion, { minutos, fecha });
      if (idActualRef.current === idSuscripcion) {
        setEstado({ tipo: 'listo', suscripcion: actualizada });
        onUsoRegistrado?.(actualizada);
        void cargarHistorial(idSuscripcion);
      }
      return actualizada;
    } finally {
      registrandoUsoRef.current = false;
      setRegistrandoUso(false);
    }
  };

  const ejecutarRetiro = async () => {
    if (eliminandoRef.current || isDeleting) return;
    if (estado.tipo !== 'listo') return;

    const idParaEliminar = estado.suscripcion.id;
    eliminandoRef.current = true;
    setIsDeleting(true);
    setErrorRetiro(null);

    try {
      await onEliminarSuscripcion(idParaEliminar);
      onRetiroExitoso?.(idParaEliminar);
      setMostrarModalRetiro(false);
      if (typeof (navigation as any)?.popTo === 'function') {
        (navigation as any).popTo('HomeScreen');
      } else if (navigation?.navigate) {
        navigation.navigate('HomeScreen');
      } else if (navigation?.goBack) {
        navigation.goBack();
      }
    } catch (err: unknown) {
      let mensaje = 'No pudimos retirar la suscripción. Revisa tu conexión e inténtalo de nuevo.';
      if (err instanceof ErrorDeApi && err.message) {
        mensaje = err.message;
      }
      setErrorRetiro(mensaje);
    } finally {
      setIsDeleting(false);
      eliminandoRef.current = false;
    }
  };

  return (
    <>
      <SuscripcionDetalleView
        id={id}
        estado={estado}
        onVolver={manejarVolver}
        onReintentar={() => void cargarDatos(id)}
        onEditar={manejarEditar}
        onEliminar={manejarEliminar}
        onRegistrarUso={manejarRegistrarUso}
        estadoHistorial={estadoHistorial}
        onReintentarHistorial={() => void cargarHistorial(id)}
      />
      {mostrarModalUso && estado.tipo === 'listo' && (
        <RegistrarUsoModal
          visible={mostrarModalUso}
          idSuscripcion={estado.suscripcion.id}
          nombreSuscripcion={estado.suscripcion.nombre}
          onRegistrar={ejecutarRegistrarUso}
          onCancelar={cerrarModalUso}
          bloqueado={registrandoUso || isDeleting}
          sigueVigente={() => idActualRef.current === estado.suscripcion.id}
        />
      )}
      {mostrarModalRetiro && estado.tipo === 'listo' && (
        <ConfirmarRetiroModal
          visible={mostrarModalRetiro}
          nombreSuscripcion={estado.suscripcion.nombre}
          onConfirmar={ejecutarRetiro}
          onCancelar={cerrarModalRetiro}
          isDeleting={isDeleting}
          error={errorRetiro}
        />
      )}
    </>
  );
}
