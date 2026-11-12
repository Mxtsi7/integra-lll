import React from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ELIMINAR_CUENTA_DISPONIBLE, type DatosEliminacion, type ResultadoEliminacion } from '@ojoalgasto/shared';
import { NavButton } from '../NavButton';
import { COLORES_ELIMINAR_CUENTA as C } from './estilos';
import { PALABRA_CONFIRMACION } from './reglasEliminacion';
import { useEliminarCuenta } from './useEliminarCuenta';

export const URL_MICROSOFT_PERSONAL = 'https://account.live.com/consent/Manage';
export const URL_MICROSOFT_TRABAJO = 'https://myapplications.microsoft.com/';

export interface EliminarCuentaContenidoProps {
  /** Se llama solo cuando el backend aceptó la eliminación. */
  onEliminada: (resultado: ResultadoEliminacion) => void;
  /** Cancelar: vuelve atrás sin tocar nada. */
  onCancelar: () => void;
  /** Solo en pruebas. */
  onEliminar?: (datos: DatosEliminacion) => Promise<ResultadoEliminacion>;
  /** Solo en pruebas. Mientras el backend no esté activo, el formulario no se muestra. */
  disponible?: boolean;
}

export function EliminarCuentaContenido({
  onEliminada,
  onCancelar,
  onEliminar,
  disponible = ELIMINAR_CUENTA_DISPONIBLE,
}: EliminarCuentaContenidoProps) {
  const formulario = useEliminarCuenta({ onEliminar, onEliminada });

  if (!disponible) {
    return (
      <View testID="eliminar-no-disponible" style={styles.contenedor}>
        <Text style={styles.texto}>Eliminar tu cuenta estará disponible próximamente.</Text>
        <NavButton testID="cancelar-eliminacion" title="Volver" variant="secondary" onPress={onCancelar} />
      </View>
    );
  }

  return (
    <View testID="eliminar-formulario" style={styles.contenedor}>
      <Text style={styles.advertencia}>Esta acción es permanente y no se puede deshacer.</Text>
      <Text style={styles.texto}>Antes de confirmar, esto es lo que va a pasar:</Text>
      <Text style={styles.texto}>• Tu sesión se cierra de inmediato.</Text>
      <Text style={styles.texto}>
        • Se elimina tu cuenta. Si quedan otras personas titulares, la organización y sus datos se conservan. Si eres la
        última persona titular, también se elimina la organización con sus suscripciones, cobros y cuentas conectadas.
      </Text>
      <Text testID="aviso-outlook" style={styles.texto}>
        • Si también se elimina tu organización y tiene cuentas Outlook conectadas, se destruyen sus credenciales
        guardadas aquí. Microsoft no revoca automáticamente ese acceso: debes retirarlo desde tu cuenta Microsoft.{' '}
        <Text
          accessibilityRole="link"
          style={styles.enlace}
          onPress={() => void Linking.openURL(URL_MICROSOFT_PERSONAL)}
        >
          Retirar el acceso en tu cuenta Microsoft personal
        </Text>
        . Para una cuenta personal, selecciona esta aplicación y retira su acceso.
      </Text>
      <Text style={styles.texto}>
        Para una cuenta de trabajo o escuela, abre{' '}
        <Text
          accessibilityRole="link"
          style={styles.enlace}
          onPress={() => void Linking.openURL(URL_MICROSOFT_TRABAJO)}
        >
          Retirar permisos en tu cuenta de trabajo o escuela
        </Text>
        , busca esta aplicación y elige administrar la aplicación y revocar permisos. Si no puedes retirarlos o si el
        permiso lo concedió tu organización, contacta a su administrador. Puedes completar el borrado aquí aunque
        todavía no hayas retirado ese permiso en Microsoft.
      </Text>

      <Text style={styles.etiqueta}>Tu contraseña actual</Text>
      <TextInput
        testID="input-contrasena"
        value={formulario.contrasena}
        onChangeText={formulario.setContrasena}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!formulario.estaEnviando}
        style={styles.entrada}
      />
      {formulario.errorContrasena ? (
        <Text testID="error-contrasena" style={styles.error} accessibilityRole="alert">
          {formulario.errorContrasena}
        </Text>
      ) : null}

      <Text style={styles.etiqueta}>Escribe {PALABRA_CONFIRMACION} para confirmar</Text>
      <TextInput
        testID="input-confirmacion"
        value={formulario.textoConfirmacion}
        onChangeText={formulario.setTextoConfirmacion}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!formulario.estaEnviando}
        style={styles.entrada}
      />

      {formulario.pideOrganizacion ? (
        <Pressable
          testID="confirmar-organizacion"
          onPress={formulario.alternarOrganizacion}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: formulario.organizacionConfirmada }}
          style={styles.casilla}
        >
          <Text style={styles.texto}>
            {formulario.organizacionConfirmada ? '☑' : '☐'} Entiendo que también se elimina mi organización
          </Text>
        </Pressable>
      ) : null}

      {formulario.errorGeneral ? (
        <Text testID="error-general" style={styles.error} accessibilityRole="alert">
          {formulario.errorGeneral}
        </Text>
      ) : null}

      <NavButton
        testID="confirmar-eliminacion"
        title="Eliminar mi cuenta"
        variant="danger"
        loading={formulario.estaEnviando}
        disabled={!formulario.puedeConfirmar}
        onPress={() => void formulario.confirmar()}
      />
      <NavButton
        testID="cancelar-eliminacion"
        title="Cancelar"
        variant="secondary"
        disabled={formulario.estaEnviando}
        onPress={onCancelar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 10 },
  advertencia: { color: C.error, fontSize: 15, fontWeight: '700' },
  texto: { color: C.tinta2, fontSize: 14 },
  enlace: { color: C.tinta, fontWeight: '600', textDecorationLine: 'underline' },
  etiqueta: { color: C.tinta, fontSize: 14, fontWeight: '600', marginTop: 6 },
  entrada: { backgroundColor: C.superficie, color: C.tinta, borderWidth: 1, borderColor: C.borde, borderRadius: 10, padding: 12, fontSize: 16 },
  casilla: { paddingVertical: 6 },
  error: { color: C.error, fontSize: 14 },
});
