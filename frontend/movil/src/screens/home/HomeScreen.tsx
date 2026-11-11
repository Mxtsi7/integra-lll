import React, { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import {
  formatearTotales,
  gastosPorMoneda,
  type EstadoCarga,
  type Suscripcion,
  type Usuario,
} from '@ojoalgasto/shared';
import { useAuth } from '../../../context/AuthContext';
import { ContenidoConEstado } from '../../components/estados/ContenidoConEstado';
import { NavButton } from '../components/NavButton';
import type { HomeScreenProps } from '../../navigation/types';
import { styles } from './HomeScreen.styles';
import { TarjetaSuscripcionMovil } from './TarjetaSuscripcionMovil';

export const SUSCRIPCIONES_HOME_DEFAULT: Suscripcion[] = [
  {
    id: '1',
    nombre: 'Netflix',
    monto: 9990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-05',
    categoria: 'streaming',
    estado: 'activo',
    horas_uso_mes: 18,
  },
  {
    id: '2',
    nombre: 'Spotify',
    monto: 4990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-09-28',
    categoria: 'musica',
    estado: 'activo',
    horas_uso_mes: 40,
  },
  {
    id: '3',
    nombre: 'Gimnasio',
    monto: 25000,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-01',
    categoria: 'salud',
    estado: 'fantasma',
    horas_uso_mes: 0,
  },
  {
    id: '4',
    nombre: 'iCloud',
    monto: 1290,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-12',
    categoria: 'nube',
    estado: 'activo',
    horas_uso_mes: 5,
  },
];

export interface HomeViewProps {
  estado: EstadoCarga<Suscripcion[]>;
  usuario?: Usuario | null;
  onSuscripcionPress: (suscripcion: Suscripcion) => void;
  onNuevaSuscripcion: () => void;
  onReintentar: () => void;
  onLogout?: () => void;
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
}: HomeViewProps) {
  return (
    <View style={styles.safeArea} testID="screen-home">
      <View style={styles.contenedor}>
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

        <ContenidoConEstado<Suscripcion[]>
          estado={estado}
          onReintentar={onReintentar}
          esVacio={(datos) => datos.length === 0}
          vacio={{
            titulo: 'No tienes suscripciones todavía',
            descripcion:
              'Agrega tu primera suscripción para comenzar a controlar tus cobros y gastos.',
            accion: {
              etiqueta: 'Crear suscripción',
              onPress: onNuevaSuscripcion,
            },
          }}
        >
          {(suscripciones) => {
            const totales = gastosPorMoneda(suscripciones);
            const totalTexto = formatearTotales(totales);

            return (
              <>
                <View style={styles.resumenCaja} testID="resumen-gastos">
                  <Text style={styles.resumenEtiqueta}>
                    Gasto mensual proyectado
                  </Text>
                  <Text style={styles.resumenTotal}>{totalTexto}</Text>
                  <Text style={styles.resumenSubtitulo}>
                    {suscripciones.length}{' '}
                    {suscripciones.length === 1
                      ? 'suscripción activa'
                      : 'suscripciones en total'}
                  </Text>
                </View>

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
                  contentContainerStyle={styles.listaContainer}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  accessibilityRole="list"
                />
              </>
            );
          }}
        </ContenidoConEstado>
      </View>
    </View>
  );
}

export interface HomeScreenPropsContainer {
  navigation?: {
    navigate: (pantalla: any, params?: any) => void;
    goBack?: () => void;
  };
  route?: any;
  estadoInicial?: EstadoCarga<Suscripcion[]>;
  onCargarSuscripciones?: () => Promise<Suscripcion[]>;
  usuario?: Usuario | null;
  onLogout?: () => void;
}

/**
 * Contenedor principal de HomeScreen.
 * Conecta autenticación, navegación y estados de carga.
 */
export default function HomeScreen({
  navigation,
  estadoInicial,
  onCargarSuscripciones,
  usuario,
  onLogout,
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
    estadoInicial ?? { tipo: 'listo', datos: SUSCRIPCIONES_HOME_DEFAULT }
  );

  const manejarReintento = async () => {
    if (onCargarSuscripciones) {
      setEstado({ tipo: 'cargando' });
      try {
        const datos = await onCargarSuscripciones();
        setEstado({ tipo: 'listo', datos });
      } catch {
        setEstado({ tipo: 'error' });
      }
    } else {
      setEstado({ tipo: 'listo', datos: SUSCRIPCIONES_HOME_DEFAULT });
    }
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

  return (
    <HomeView
      estado={estado}
      usuario={usuarioActivo}
      onSuscripcionPress={manejarSuscripcionPress}
      onNuevaSuscripcion={manejarNuevaSuscripcion}
      onReintentar={() => void manejarReintento()}
      onLogout={manejarLogout}
    />
  );
}
