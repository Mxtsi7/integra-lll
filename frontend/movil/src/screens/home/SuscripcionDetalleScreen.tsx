import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  costoPorHora,
  equivalenteMensual,
  ErrorDeApi,
  formatearHoras,
  formatearMonto,
  getSuscripcion,
  type Suscripcion,
} from '@ojoalgasto/shared';
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
  };
  route?: {
    params?: { id?: string };
  };
  onCargarSuscripcion?: (id: string) => Promise<Suscripcion>;
  estadoInicial?: EstadoDetalle;
  onEditar?: (suscripcion: Suscripcion) => void;
  onEliminar?: (suscripcion: Suscripcion) => void;
  onRegistrarUso?: (suscripcion: Suscripcion) => void;
}

export default function SuscripcionDetalleScreen({
  navigation,
  route,
  onCargarSuscripcion = getSuscripcion,
  estadoInicial,
  onEditar,
  onEliminar,
  onRegistrarUso,
}: (HomeScreenProps<'SuscripcionDetalle'> & SuscripcionDetalleContainerProps) | SuscripcionDetalleContainerProps) {
  const id = route?.params?.id ?? '';

  const [estado, setEstado] = useState<EstadoDetalle>(
    estadoInicial ?? { tipo: 'cargando' }
  );

  // Contador de generación e id activo para invalidar respuestas atrasadas y proteger contra desmontaje
  const generacionRef = useRef(0);
  const idActualRef = useRef(id);
  idActualRef.current = id;

  const cargarDatos = useCallback(
    async (idObjetivo: string) => {
      generacionRef.current += 1;
      const generacionActual = generacionRef.current;

      const sigueVigente = () =>
        generacionRef.current === generacionActual && idActualRef.current === idObjetivo;

      if (!idObjetivo) {
        if (sigueVigente()) {
          setEstado({ tipo: 'no-encontrada' });
        }
        return;
      }

      if (sigueVigente()) {
        setEstado({ tipo: 'cargando' });
      }

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
    if (estadoInicial) return;
    void cargarDatos(id);

    return () => {
      // Al cambiar id o desmontar el componente, se avanza la generación
      // para descartar inmediatamente cualquier respuesta pendiente en vuelo.
      generacionRef.current += 1;
    };
  }, [id, estadoInicial, cargarDatos]);

  const manejarVolver = () => {
    if (navigation?.goBack) {
      navigation.goBack();
    }
  };

  return (
    <SuscripcionDetalleView
      id={id}
      estado={estado}
      onVolver={manejarVolver}
      onReintentar={() => void cargarDatos(id)}
      onEditar={onEditar}
      onEliminar={onEliminar}
      onRegistrarUso={onRegistrarUso}
    />
  );
}
