import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ContenidoConEstado } from '../../../components/estados';
import { NavButton } from '../NavButton';
import { AlertaItem } from './AlertaItem';
import { COLORES_ALERTAS as C } from './estilos';
import { useAlertas, type ApiAlertas } from './useAlertas';

export interface CentroAlertasProps {
  /**
   * Avisa cuando la pantalla vuelve a estar a la vista. Así una alerta leída en otra pantalla no reaparece
   * como pendiente. Devuelve la función para dejar de escuchar.
   */
  alVolverAPantalla?: (recargar: () => void) => () => void;
  /** Solo en pruebas. */
  api?: ApiAlertas;
}

export function CentroAlertas({ api, alVolverAPantalla }: CentroAlertasProps) {
  const { estado, filtro, cambiarFiltro, idsMarcando, marcandoTodas, cargandoMas, mensajeError, cargar, cargarMas, marcarLeida, marcarTodasLeidas } =
    useAlertas(api);

  useEffect(() => {
    if (!alVolverAPantalla) return undefined;
    // En segundo plano: no se vacía la lista mientras se refresca.
    return alVolverAPantalla(() => void cargar({ enSegundoPlano: true }));
  }, [alVolverAPantalla, cargar]);

  return (
    <View testID="centro-alertas" style={styles.contenedor}>
      {/* Los filtros quedan fuera del estado de carga: si un filtro no tiene alertas, se puede volver a "Todas". */}
      <View style={styles.filtros}>
        <NavButton
          testID="filtro-todas"
          title="Todas"
          variant={filtro === 'todas' ? 'primary' : 'secondary'}
          onPress={() => cambiarFiltro('todas')}
          accessibilityHint="Muestra todas las alertas"
        />
        <NavButton
          testID="filtro-sin-leer"
          title="Sin leer"
          variant={filtro === 'sin_leer' ? 'primary' : 'secondary'}
          onPress={() => cambiarFiltro('sin_leer')}
          accessibilityHint="Muestra solo las alertas sin leer"
        />
      </View>
      {/* El badge queda fuera de la lista: se ve también cuando el filtro no trae alertas. El número lo calcula
          el backend para toda la organización. */}
      {estado.tipo === 'listo' ? (
        <Text testID="badge-pendientes" style={styles.badge}>{`${estado.datos.pendientes} sin leer`}</Text>
      ) : null}
      <ContenidoConEstado
        estado={estado}
        onReintentar={() => void cargar()}
        esVacio={(datos) => datos.alertas.length === 0}
        vacio={{
          titulo: filtro === 'sin_leer' ? 'No tienes alertas sin leer' : 'No tienes alertas',
          descripcion: 'Cuando haya un cobro próximo o un cambio en tus suscripciones, te avisamos aquí.',
        }}
      >
        {(datos) => (
          <>
            <View style={styles.cabecera}>
              {datos.pendientes > 0 ? (
                <NavButton
                  testID="marcar-todas-leidas"
                  title="Marcar todas como leídas"
                  variant="secondary"
                  loading={marcandoTodas}
                  onPress={() => void marcarTodasLeidas()}
                />
              ) : null}
            </View>
            {mensajeError ? (
              <Text testID="error-alertas" style={styles.error} accessibilityRole="alert">
                {mensajeError}
              </Text>
            ) : null}
            {datos.alertas.map((alerta) => (
              <AlertaItem
                key={alerta.id}
                alerta={alerta}
                estaMarcando={idsMarcando.includes(alerta.id)}
                onMarcarLeida={() => void marcarLeida(alerta.id)}
              />
            ))}
            {datos.hayMas ? (
              <NavButton
                testID="cargar-mas-alertas"
                title="Ver más alertas"
                variant="secondary"
                loading={cargandoMas}
                onPress={() => void cargarMas()}
              />
            ) : null}
          </>
        )}
      </ContenidoConEstado>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  filtros: { gap: 8 },
  cabecera: { gap: 8 },
  badge: { color: C.acento, fontSize: 15, fontWeight: '700' },
  error: { color: C.error, fontSize: 14 },
});
