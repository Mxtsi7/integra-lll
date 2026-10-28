import { esMesValido } from '@ojoalgasto/shared';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { mesDeFecha } from '../utils/calendario';

/**
 * El mes que se mira en el Calendario y la Agenda vive en la URL (?mes=YYYY-MM,
 * CH-19): Atrás/Adelante del navegador recorren los meses vistos, al recargar
 * se queda en el mismo y al pasar de Mes a Agenda se conserva.
 *
 * Sin ?mes= o con uno inválido (2026-13, texto) se muestra el mes de hoy:
 * nunca se pide a la API un mes mal escrito.
 */
export function useMesEnUrl(hoy: string): { mes: string; irAMes: (mes: string) => void } {
  const [parametros, setParametros] = useSearchParams();
  const pedido = parametros.get('mes');
  const mes = pedido !== null && esMesValido(pedido) ? pedido : mesDeFecha(hoy);

  const irAMes = useCallback(
    (nuevo: string) =>
      setParametros((actuales) => {
        const siguientes = new URLSearchParams(actuales);
        siguientes.set('mes', nuevo);
        return siguientes;
      }),
    [setParametros],
  );

  return { mes, irAMes };
}
