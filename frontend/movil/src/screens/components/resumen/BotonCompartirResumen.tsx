import React, { useRef, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { textoDelResumen, type ResumenDelPeriodo } from '@ojoalgasto/shared';
import { NavButton } from '../NavButton';
import { COLORES_RESUMEN as C } from './estilos';

export const MENSAJE_ERROR_COMPARTIR = 'No pudimos abrir el menú para compartir. Inténtalo de nuevo.';

export interface BotonCompartirResumenProps {
  /** El resumen del periodo que se está viendo. Lo que se comparte es de ESE periodo. */
  resumen: ResumenDelPeriodo;
  /** Solo en pruebas. Por defecto se usa el menú de compartir del teléfono. */
  compartir?: (mensaje: string) => Promise<unknown>;
}

/** El menú de compartir del teléfono (WhatsApp, correo, copiar…). La persona elige a dónde va. */
function compartirConElTelefono(mensaje: string) {
  return Share.share({ message: mensaje });
}

/**
 * Compartir el resumen del periodo (AN-26). Se comparte TEXTO que arma la app con las cifras que ya
 * están en pantalla:
 * - No se crea ningún archivo ni enlace: no queda nada privado abandonado en el teléfono y no hay
 *   una URL abierta que otra persona pueda abrir.
 * - Cancelar el menú no cambia nada ni muestra un error.
 * - La app no puede saber si la persona terminó de compartir, así que nunca dice "compartido".
 */
export function BotonCompartirResumen({ resumen, compartir = compartirConElTelefono }: BotonCompartirResumenProps) {
  const [compartiendo, setCompartiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false); // candado contra doble toque

  async function alPulsar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setCompartiendo(true);
    setError(null);
    try {
      await compartir(textoDelResumen(resumen));
    } catch {
      setError(MENSAJE_ERROR_COMPARTIR);
    } finally {
      enCurso.current = false;
      setCompartiendo(false);
    }
  }

  return (
    <View style={styles.contenedor}>
      <NavButton
        testID="compartir-resumen"
        title="Compartir resumen"
        variant="secondary"
        loading={compartiendo}
        onPress={() => void alPulsar()}
      />
      {error ? (
        <Text testID="error-compartir" style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 8 },
  error: { color: C.error, fontSize: 14 },
});
