import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorDeApi, LARGO_MAXIMO_NOMBRE, validarNombre } from '@ojoalgasto/shared';
import { COLORES_PERFIL as C } from './estilos';

export interface EditarNombreProps {
  nombreActual: string;
  /** Guarda en el servidor y deja el perfil actualizado. Si falla, debe rechazar la promesa. */
  onGuardar: (nombre: string) => Promise<unknown>;
}

type Modo = 'viendo' | 'editando' | 'guardando';

function mensajeDeError(err: unknown): string {
  if (err instanceof ErrorDeApi) {
    if (err.status === 400) return 'Revisa el nombre e inténtalo de nuevo.';
    if (err.status === 403 || err.status === 404) {
      return 'Tu sesión ya no es válida. Vuelve a iniciar sesión.';
    }
  }
  if (err instanceof TypeError) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'No pudimos guardar tu nombre. Inténtalo de nuevo.';
}

export function EditarNombre({ nombreActual, onGuardar }: EditarNombreProps) {
  const [modo, setModo] = useState<Modo>('viendo');
  const [texto, setTexto] = useState(nombreActual);
  const [error, setError] = useState<string | null>(null);
  // Evita guardar dos veces con un doble toque.
  const guardandoRef = useRef(false);

  function empezar() {
    setTexto(nombreActual);
    setError(null);
    setModo('editando');
  }

  function cancelar() {
    if (guardandoRef.current) return;
    setError(null);
    setModo('viendo');
  }

  async function guardar() {
    if (guardandoRef.current) return;
    const errorDeValidacion = validarNombre(texto);
    if (errorDeValidacion) {
      setError(errorDeValidacion);
      return;
    }
    const nuevo = texto.trim();
    if (nuevo === nombreActual) {
      setError(null);
      setModo('viendo');
      return;
    }
    guardandoRef.current = true;
    setModo('guardando');
    setError(null);
    try {
      await onGuardar(nuevo);
      setModo('viendo');
    } catch (err: unknown) {
      setError(mensajeDeError(err));
      setModo('editando');
    } finally {
      guardandoRef.current = false;
    }
  }

  if (modo === 'viendo') {
    return (
      <View style={styles.fila}>
        <Text style={styles.etiqueta}>Nombre</Text>
        <View style={styles.encabezado}>
          <Text testID="nombre-actual" style={styles.valor}>
            {nombreActual}
          </Text>
          <Pressable testID="editar-nombre" accessibilityRole="button" onPress={empezar}>
            <Text style={styles.enlace}>Editar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const guardando = modo === 'guardando';
  return (
    <View style={styles.fila}>
      <Text style={styles.etiqueta}>Nombre</Text>
      <TextInput
        testID="input-nombre"
        value={texto}
        onChangeText={(t: string) => {
          if (!guardando) setTexto(t);
        }}
        maxLength={LARGO_MAXIMO_NOMBRE}
        autoCapitalize="words"
        style={styles.entrada}
      />
      {error ? (
        <Text testID="error-nombre" accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.acciones}>
        <Pressable
          testID="cancelar-nombre"
          accessibilityRole="button"
          disabled={guardando}
          onPress={cancelar}
          style={styles.botonSecundario}
        >
          <Text style={styles.textoSecundario}>Cancelar</Text>
        </Pressable>
        <Pressable
          testID="guardar-nombre"
          accessibilityRole="button"
          disabled={guardando}
          onPress={() => void guardar()}
          style={styles.botonPrimario}
        >
          <Text style={styles.textoPrimario}>{guardando ? 'Guardando…' : 'Guardar'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borde,
    gap: 6,
  },
  etiqueta: { color: C.tinta2, fontSize: 13 },
  valor: { color: C.tinta, fontSize: 16, flexShrink: 1 },
  encabezado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  enlace: { color: C.acento, fontSize: 15, fontWeight: '600' },
  entrada: {
    color: C.tinta,
    fontSize: 16,
    borderWidth: 1,
    borderColor: C.borde,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.fondo,
  },
  error: { color: C.error, fontSize: 13 },
  acciones: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  botonPrimario: {
    backgroundColor: C.acento,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  textoPrimario: { color: C.acentoTinta, fontSize: 15, fontWeight: '700' },
  botonSecundario: {
    borderWidth: 1,
    borderColor: C.borde,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  textoSecundario: { color: C.tinta, fontSize: 15 },
});
