import { getCuentasConectadas } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import type { EstadoCuentaDeImportacion } from '../components/importacion/reconexion';
import { useAuth } from '../context/AuthContext';

/**
 * La cuenta de una importación de correo (S3-CH-22), para saber si hay que pedir que la vuelvan a
 * autorizar. Lo que se consulta es la cuenta de este id: el resultado de otra cuenta no se muestra,
 * y tampoco el de otra sesión que llegue tarde.
 *
 * Sin `cuentaId` (un CSV, o una importación sin cuenta) no se pide nada.
 */
export function useCuentaDeImportacion(cuentaId: string | null): EstadoCuentaDeImportacion {
  const { capturarSesion } = useAuth();
  // La sesión con la que se montó la página. Si cambia, lo que llegue después es de otra sesión.
  const [sesion] = useState(capturarSesion);
  const [resultado, setResultado] = useState<{ cuentaId: string; estado: EstadoCuentaDeImportacion } | null>(null);

  useEffect(() => {
    if (cuentaId === null) return;
    let vigente = true;
    const sigueVigente = () => vigente && capturarSesion() === sesion;
    setResultado({ cuentaId, estado: { tipo: 'cargando' } });
    getCuentasConectadas()
      .then((cuentas) => {
        if (sigueVigente()) {
          setResultado({ cuentaId, estado: { tipo: 'listo', cuenta: cuentas.find((cuenta) => cuenta.id === cuentaId) ?? null } });
        }
      })
      .catch(() => {
        if (sigueVigente()) setResultado({ cuentaId, estado: { tipo: 'error' } });
      });
    return () => {
      vigente = false;
    };
  }, [cuentaId, capturarSesion, sesion]);

  if (cuentaId === null) return { tipo: 'sin-cuenta' };
  return resultado?.cuentaId === cuentaId ? resultado.estado : { tipo: 'cargando' };
}
