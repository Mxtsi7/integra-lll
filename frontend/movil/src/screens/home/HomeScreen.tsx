import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import {
  esFechaReal,
  formatearTotales,
  gastosPorMoneda,
  getSuscripciones,
  getSuscripcionesPaginadas,
  ORDEN_PREDETERMINADO,
  type ConsultaSuscripciones,
  type EstadoCarga,
  type Moneda,
  type OrdenSuscripciones,
  type Suscripcion,
  type SuscripcionesPaginadas,
  type Usuario,
} from '@ojoalgasto/shared';
import { useAuth } from '../../../context/AuthContext';
import { ContenidoConEstado } from '../../components/estados/ContenidoConEstado';
import { NavButton } from '../components/NavButton';
import type { HomeScreenProps } from '../../navigation/types';
import {
  FiltrosSuscripcionesMovil,
  describirCriterioActivo,
  type FiltroEstado,
} from './FiltrosSuscripcionesMovil';
import { styles } from './HomeScreen.styles';
import { TarjetaSuscripcionMovil } from './TarjetaSuscripcionMovil';

/**
 * Deduplica suscripciones por id para evitar elementos repetidos
 * al concatenar páginas subsecuentes (Criterio SE-19).
 */
export function deduplicarSuscripciones(
  acumuladas: Suscripcion[],
  nuevas: Suscripcion[],
): Suscripcion[] {
  const idsVistos = new Set(acumuladas.map((s) => s.id));
  const unicas = nuevas.filter((s) => !idsVistos.has(s.id));
  return [...acumuladas, ...unicas];
}

/** Configuración de rendimiento de FlatList sin números mágicos (SE-19). */
export const FLATLIST_CONFIG_MOVIL = {
  initialNumToRender: 10,
  maxToRenderPerBatch: 10,
  windowSize: 5,
} as const;

export interface HomeViewProps {
  estado: EstadoCarga<Suscripcion[]>;
  usuario?: Usuario | null;
  onSuscripcionPress: (suscripcion: Suscripcion) => void;
  onNuevaSuscripcion: () => void;
  onReintentar: () => void;
  onLogout?: () => void;
  // Filtros (SE-27)
  filtroEstado?: FiltroEstado;
  filtroFecha?: string;
  onCambiarEstado?: (estado: FiltroEstado) => void;
  onCambiarFecha?: (fecha: string) => void;
  onLimpiarFiltros?: () => void;
  hayFiltrosActivos?: boolean;
  // Orden (SE-29)
  orden?: OrdenSuscripciones;
  onCambiarOrden?: (orden: OrdenSuscripciones) => void;
  // Paginación (SE-19)
  totalGeneral?: number;
  hayMas?: boolean;
  cargandoMas?: boolean;
  onCargarMas?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  paginaActual?: number;
  resumenGlobal?: { moneda: Moneda; total: number }[];
}

/**
 * Componente presentacional puro del Home de Suscripciones.
 * Desacoplado de la API y navegación para facilitar pruebas y extensibilidad.
 */
export function HomeView({
  estado,
  usuario,
  onSuscripcionPress,
  onNuevaSuscripcion,
  onReintentar,
  onLogout,
  filtroEstado = 'todas',
  filtroFecha = '',
  onCambiarEstado,
  onCambiarFecha,
  onLimpiarFiltros,
  hayFiltrosActivos = false,
  orden,
  onCambiarOrden,
  totalGeneral,
  hayMas = false,
  cargandoMas = false,
  onCargarMas,
  refreshing = false,
  onRefresh,
  paginaActual = 1,
  resumenGlobal,
}: HomeViewProps) {
  const tieneSuscripciones =
    estado.tipo === 'listo' && estado.datos.length > 0;
  const mostrarFiltros =
    Boolean(onCambiarEstado) &&
    (tieneSuscripciones || hayFiltrosActivos || estado.tipo === 'cargando');

  const encabezadoComun = (
    <>
      <View style={styles.header}>
        <Text style={styles.titulo} accessibilityRole="header">
          Home de Suscripciones
        </Text>
        <Text style={styles.usuarioTexto}>
          Usuario: {usuario?.nombre ?? 'Cargando...'}
        </Text>
      </View>

      <View style={styles.accionesBarra}>
        <NavButton
          testID="go-nueva-suscripcion"
          title="Crear Nueva Suscripción"
          variant="secondary"
          onPress={onNuevaSuscripcion}
          style={styles.botonAccion}
        />
        {onLogout ? (
          <NavButton
            testID="logout"
            title="Cerrar Sesión"
            variant="danger"
            onPress={onLogout}
            style={styles.botonAccion}
          />
        ) : null}
      </View>

      {mostrarFiltros && onCambiarEstado ? (
        <FiltrosSuscripcionesMovil
          filtroEstado={filtroEstado}
          filtroFecha={filtroFecha}
          orden={orden}
          onCambiarEstado={onCambiarEstado}
          onCambiarFecha={onCambiarFecha ?? (() => {})}
          onCambiarOrden={onCambiarOrden}
          onLimpiarFiltros={onLimpiarFiltros ?? (() => {})}
          hayFiltrosActivos={hayFiltrosActivos}
          totalResultados={
            estado.tipo === 'listo'
              ? (totalGeneral ?? estado.datos.length)
              : undefined
          }
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.safeArea} testID="screen-home">
      <View style={styles.contenedor}>
        {estado.tipo === 'listo' && estado.datos.length > 0 ? (
          (() => {
            const suscripciones = estado.datos;
            const esParcial =
              !resumenGlobal &&
              Boolean(
                hayMas ||
                (totalGeneral !== undefined && totalGeneral > suscripciones.length)
              );

            const totales = resumenGlobal ?? gastosPorMoneda(suscripciones);
            const totalTexto = formatearTotales(totales);

            const etiquetaResumen = esParcial
              ? 'Subtotal mensual proyectado (parcial)'
              : 'Gasto mensual proyectado';

            const subtituloResumen = esParcial
              ? `Subtotal de ${suscripciones.length} de ${totalGeneral ?? suscripciones.length} suscripciones (parcial)`
              : `${totalGeneral !== undefined ? totalGeneral : suscripciones.length} ${(totalGeneral !== undefined ? totalGeneral : suscripciones.length) === 1 ? 'suscripción activa' : 'suscripciones en total'}`;

            return (
              <FlatList
                testID="lista-suscripciones"
                data={suscripciones}
                keyExtractor={(item) => item.id}
                renderItem={({ item, index }) => (
                  <TarjetaSuscripcionMovil
                    suscripcion={item}
                    testID={index === 0 ? 'go-detalle' : undefined}
                    onPress={onSuscripcionPress}
                  />
                )}
                ListHeaderComponent={
                  <>
                    {encabezadoComun}
                    <View
                      style={styles.resumenCaja}
                      testID="resumen-gastos"
                      accessibilityRole="summary"
                      accessibilityLabel={
                        esParcial
                          ? `Subtotal mensual proyectado (parcial): ${totalTexto}, correspondiente a ${suscripciones.length} de ${totalGeneral} suscripciones`
                          : `Gasto mensual proyectado: ${totalTexto}`
                      }
                    >
                      <Text
                        style={esParcial ? styles.resumenEtiquetaParcial : styles.resumenEtiqueta}
                        testID="resumen-etiqueta"
                      >
                        {etiquetaResumen}
                      </Text>
                      <Text style={styles.resumenTotal} testID="resumen-total">{totalTexto}</Text>
                      <Text style={styles.resumenSubtitulo} testID="resumen-subtitulo">
                        {subtituloResumen}
                      </Text>
                    </View>
                  </>
                }
                refreshing={refreshing}
                onRefresh={onRefresh}
                style={styles.lista}
                contentContainerStyle={styles.listaContainer}
                initialNumToRender={FLATLIST_CONFIG_MOVIL.initialNumToRender}
                maxToRenderPerBatch={FLATLIST_CONFIG_MOVIL.maxToRenderPerBatch}
                windowSize={FLATLIST_CONFIG_MOVIL.windowSize}
                accessibilityRole="list"
                ListFooterComponent={
                  hayMas ? (
                    <View style={styles.footerPaginacion}>
                      <Pressable
                        testID="btn-cargar-mas"
                        accessibilityRole="button"
                        accessibilityLabel="Cargar más suscripciones"
                        disabled={cargandoMas}
                        accessibilityState={{ disabled: cargandoMas }}
                        style={styles.botonCargarMas}
                        onPress={onCargarMas}
                      >
                        <Text style={styles.textoCargarMas}>
                          {cargandoMas ? 'Cargando más...' : 'Cargar más'}
                        </Text>
                      </Pressable>
                      {totalGeneral !== undefined ? (
                        <View style={styles.contadorPaginacion}>
                          <Text
                            style={styles.contadorTexto}
                            testID="contador-paginacion"
                          >
                            Mostrando {suscripciones.length} de {totalGeneral}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null
                }
              />
            );
          })()
        ) : (
          <>
            {encabezadoComun}
            <ContenidoConEstado<Suscripcion[]>
              estado={estado}
              onReintentar={onReintentar}
              esVacio={(datos) => datos.length === 0}
              vacio={
                hayFiltrosActivos
                  ? {
                      titulo: 'Ninguna suscripción coincide',
                      descripcion:
                        describirCriterioActivo(
                          filtroEstado,
                          filtroFecha,
                          orden !== ORDEN_PREDETERMINADO ? orden : undefined
                        ) ||
                        'No se encontraron suscripciones con los filtros aplicados.',
                      accion: {
                        etiqueta: 'Limpiar filtros',
                        onPress: onLimpiarFiltros ?? onNuevaSuscripcion,
                        variante: 'primario',
                        testID: 'btn-limpiar-filtros-vacio',
                      },
                      testID: 'empty-state-filtros',
                    }
                  : {
                      titulo: 'Todavía no registras suscripciones',
                      descripcion:
                        'Agrega la primera y empieza a ver cuánto gastas al mes, qué cobros vienen y cuáles pagas sin usar.',
                      accion: {
                        etiqueta: 'Agregar suscripción',
                        onPress: onNuevaSuscripcion,
                        variante: 'primario',
                        testID: 'btn-crear-primera-suscripcion',
                      },
                      testID: 'empty-state-home',
                    }
              }
            >
              {() => null}
            </ContenidoConEstado>
          </>
        )}
      </View>
    </View>
  );
}

export interface HomeScreenPropsContainer {
  navigation?: {
    navigate: (pantalla: any, params?: any) => void;
    goBack?: () => void;
    addListener?: (evento: any, callback: any) => (() => void) | void;
  };
  route?: any;
  estadoInicial?: EstadoCarga<Suscripcion[]>;
  onCargarSuscripciones?: (consulta?: ConsultaSuscripciones) => Promise<Suscripcion[]>;
  onCargarPagina?: (
    consulta?: ConsultaSuscripciones,
    pagina?: number,
  ) => Promise<SuscripcionesPaginadas>;
  usuario?: Usuario | null;
  onLogout?: () => void;
  resumenGlobal?: { moneda: Moneda; total: number }[];
  onCargarResumen?: (
    consulta?: ConsultaSuscripciones,
  ) => Promise<{ moneda: Moneda; total: number }[]>;
  orden?: OrdenSuscripciones;
}

export { ORDEN_PREDETERMINADO };

/**
 * Contenedor principal de HomeScreen.
 * Conecta autenticación, navegación, paginación real (SE-19), filtros por servidor (SE-27) y ordenamiento (SE-29).
 */
export default function HomeScreen({
  navigation,
  estadoInicial,
  onCargarSuscripciones,
  onCargarPagina,
  usuario,
  onLogout,
  resumenGlobal: propResumenGlobal,
  onCargarResumen,
  orden: propOrden,
}: (HomeScreenProps<'HomeScreen'> & HomeScreenPropsContainer) | HomeScreenPropsContainer) {
  let authUsuario: Usuario | null = null;
  let authCerrarSesion: (() => Promise<void>) | undefined;
  try {
    const auth = useAuth();
    authUsuario = auth.usuario;
    authCerrarSesion = auth.cerrarSesion;
  } catch {
    // Entorno de prueba aislado sin AuthProvider
  }

  const usuarioActivo = usuario !== undefined ? usuario : authUsuario;
  const ejecutarLogout = onLogout !== undefined ? onLogout : authCerrarSesion;

  const [estado, setEstado] = useState<EstadoCarga<Suscripcion[]>>(
    estadoInicial ?? { tipo: 'cargando' }
  );

  // Estados de filtros (SE-27)
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todas');
  const [filtroFecha, setFiltroFecha] = useState<string>('');

  // Estado de ordenamiento (SE-29)
  const [orden, setOrden] = useState<OrdenSuscripciones>(propOrden ?? ORDEN_PREDETERMINADO);

  // Estados de paginación (SE-19)
  const [paginaActual, setPaginaActual] = useState(1);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [totalGeneral, setTotalGeneral] = useState<number | undefined>(undefined);
  const [resumenGlobal, setResumenGlobal] = useState<
    { moneda: Moneda; total: number }[] | undefined
  >(propResumenGlobal);

  const generacionRef = useRef(0);

  const hayFiltrosActivos =
    filtroEstado !== 'todas' ||
    (filtroFecha.trim() !== '' && esFechaReal(filtroFecha.trim())) ||
    orden !== ORDEN_PREDETERMINADO;

  const construirConsulta = useCallback((): ConsultaSuscripciones => {
    const consulta: ConsultaSuscripciones = {};
    if (filtroEstado !== 'todas') {
      consulta.estado = filtroEstado;
    }
    const fechaTrim = filtroFecha.trim();
    if (fechaTrim && esFechaReal(fechaTrim)) {
      consulta.fecha_cobro = fechaTrim;
    }
    consulta.orden = orden ?? ORDEN_PREDETERMINADO;
    return consulta;
  }, [filtroEstado, filtroFecha, orden]);

  const cargarPaginaInicial = useCallback(async () => {
    generacionRef.current += 1;
    const generacion = generacionRef.current;
    const sigueVigente = () => generacionRef.current === generacion;

    setCargandoMas(false);
    setEstado({ tipo: 'cargando' });
    setPaginaActual(1);

    const consulta = construirConsulta();

    if (onCargarResumen) {
      onCargarResumen(consulta)
        .then((res) => {
          if (sigueVigente()) setResumenGlobal(res);
        })
        .catch(() => {});
    } else if (propResumenGlobal) {
      setResumenGlobal(propResumenGlobal);
    } else {
      setResumenGlobal(undefined);
    }

    try {
      let resultadoSuscripciones: Suscripcion[] = [];
      let existeSiguiente = false;
      let total: number | undefined;
      let totalesPagina: { moneda: Moneda; total: number }[] | undefined;

      if (onCargarPagina) {
        const pag = await onCargarPagina(consulta, 1);
        if (!sigueVigente()) return;
        resultadoSuscripciones = pag.results;
        existeSiguiente = Boolean(pag.next);
        total = pag.count;
        totalesPagina = pag.totales;
      } else if (onCargarSuscripciones) {
        const subs = await onCargarSuscripciones(consulta);
        if (!sigueVigente()) return;
        resultadoSuscripciones = subs;
        existeSiguiente = false;
        total = subs.length;
      } else {
        const pag = await getSuscripcionesPaginadas(consulta, 1);
        if (!sigueVigente()) return;
        resultadoSuscripciones = pag.results;
        existeSiguiente = Boolean(pag.next);
        total = pag.count;
        totalesPagina = pag.totales;
      }

      if (totalesPagina && !propResumenGlobal && !onCargarResumen) {
        setResumenGlobal(totalesPagina);
      }
      setHayMas(existeSiguiente);
      setTotalGeneral(total);
      setEstado({ tipo: 'listo', datos: resultadoSuscripciones });
    } catch {
      if (!sigueVigente()) return;
      setEstado({ tipo: 'error' });
    }
  }, [construirConsulta, onCargarPagina, onCargarSuscripciones, onCargarResumen, propResumenGlobal]);

  const manejarCargarMas = useCallback(async () => {
    if (cargandoMas || !hayMas) return;
    setCargandoMas(true);
    const siguientePagina = paginaActual + 1;
    const generacion = generacionRef.current;
    const sigueVigente = () => generacionRef.current === generacion;

    const consulta = construirConsulta();

    try {
      let nuevas: Suscripcion[] = [];
      let existeSiguiente = false;

      if (onCargarPagina) {
        const pag = await onCargarPagina(consulta, siguientePagina);
        if (!sigueVigente()) return;
        nuevas = pag.results;
        existeSiguiente = Boolean(pag.next);
      } else if (onCargarSuscripciones) {
        const subs = await onCargarSuscripciones(consulta);
        if (!sigueVigente()) return;
        nuevas = subs;
        existeSiguiente = false;
      } else {
        const pag = await getSuscripcionesPaginadas(consulta, siguientePagina);
        if (!sigueVigente()) return;
        nuevas = pag.results;
        existeSiguiente = Boolean(pag.next);
      }

      setPaginaActual(siguientePagina);
      setHayMas(existeSiguiente);
      setEstado((prev) => {
        if (prev.tipo !== 'listo' || !sigueVigente()) return prev;
        return {
          tipo: 'listo',
          datos: deduplicarSuscripciones(prev.datos, nuevas),
        };
      });
    } catch {
      // fallo al cargar más no corrompe la lista previa
    } finally {
      if (sigueVigente()) {
        setCargandoMas(false);
      }
    }
  }, [cargandoMas, hayMas, paginaActual, construirConsulta, onCargarPagina, onCargarSuscripciones]);

  const manejarRefresh = useCallback(async () => {
    setRefreshing(true);
    await cargarPaginaInicial();
    setRefreshing(false);
  }, [cargarPaginaInicial]);

  // Resetear filtros si cambia de usuario
  const usuarioPrevioRef = useRef(usuarioActivo?.id);
  useEffect(() => {
    if (usuarioPrevioRef.current !== usuarioActivo?.id) {
      usuarioPrevioRef.current = usuarioActivo?.id;
      setFiltroEstado('todas');
      setFiltroFecha('');
      setOrden(propOrden ?? ORDEN_PREDETERMINADO);
    }
  }, [usuarioActivo?.id, propOrden]);

  // Carga reactiva ante cambios de filtro (SE-27), orden (SE-29) y cambio de usuario
  useEffect(() => {
    if (estadoInicial) return;
    void cargarPaginaInicial();
  }, [filtroEstado, filtroFecha, orden, usuarioActivo?.id, cargarPaginaInicial, estadoInicial]);

  // Invalidación y recarga ante foco
  useEffect(() => {
    if (estadoInicial) return;

    const unsubscribe = navigation?.addListener?.('focus', () => {
      void cargarPaginaInicial();
    });

    return () => {
      generacionRef.current += 1;
      unsubscribe?.();
    };
  }, [navigation, cargarPaginaInicial, estadoInicial]);

  const manejarReintento = async () => {
    await cargarPaginaInicial();
  };

  const manejarSuscripcionPress = (suscripcion: Suscripcion) => {
    navigation?.navigate('SuscripcionDetalle', { id: suscripcion.id });
  };

  const manejarNuevaSuscripcion = () => {
    navigation?.navigate('SuscripcionNueva');
  };

  const manejarLogout = () => {
    void ejecutarLogout?.();
  };

  const manejarCambiarEstado = useCallback((nuevoEstado: FiltroEstado) => {
    setFiltroEstado(nuevoEstado);
  }, []);

  const manejarCambiarFecha = useCallback((nuevaFecha: string) => {
    setFiltroFecha(nuevaFecha);
  }, []);

  const manejarCambiarOrden = useCallback((nuevoOrden: OrdenSuscripciones) => {
    setOrden(nuevoOrden);
  }, []);

  const manejarLimpiarFiltros = useCallback(() => {
    setFiltroEstado('todas');
    setFiltroFecha('');
    setOrden(ORDEN_PREDETERMINADO);
  }, []);

  return (
    <HomeView
      estado={estado}
      usuario={usuarioActivo}
      onSuscripcionPress={manejarSuscripcionPress}
      onNuevaSuscripcion={manejarNuevaSuscripcion}
      onReintentar={manejarReintento}
      onLogout={manejarLogout}
      filtroEstado={filtroEstado}
      filtroFecha={filtroFecha}
      onCambiarEstado={manejarCambiarEstado}
      onCambiarFecha={manejarCambiarFecha}
      orden={orden}
      onCambiarOrden={manejarCambiarOrden}
      onLimpiarFiltros={manejarLimpiarFiltros}
      hayFiltrosActivos={hayFiltrosActivos}
      totalGeneral={totalGeneral}
      hayMas={hayMas}
      cargandoMas={cargandoMas}
      onCargarMas={manejarCargarMas}
      refreshing={refreshing}
      onRefresh={manejarRefresh}
      paginaActual={paginaActual}
      resumenGlobal={resumenGlobal}
    />
  );
}
