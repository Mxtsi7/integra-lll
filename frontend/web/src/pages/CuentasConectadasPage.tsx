import type { CuentaConectada } from '@ojoalgasto/shared';
import { Link2, Plug } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ListaCuentas, type EstadoListaCuentas } from '../components/Cuentas/ListaCuentas';
import styles from '../components/Cuentas/Cuentas.module.css';
import { AppLayout } from '../components/layout/AppLayout';
import { BotonEnlace } from '../components/ui/Boton';
import { Seccion } from '../components/ui/Seccion';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

const MENSAJE_ERROR = 'No pudimos cargar tus cuentas conectadas. Intenta de nuevo.';

export interface CuentasConectadasPageProps {
  /**
   * AN-17: trae TODAS las cuentas de la organización como un arreglo de
   * CuentaConectada (la forma de CuentaConectadaSerializer). Mientras no se
   * pase, el listado dice que todavía no está disponible: no se inventan
   * cuentas ni se dice que no hay ninguna.
   *
   * Ojo al cablearla con GET /api/conectores/ (FE-02, PR #82): esa ruta NO
   * devuelve el arreglo pelado sino el envoltorio paginado del resto de la API,
   * `{ count, next, previous, results }`, de a 10 cuentas por página
   * (`?page_size=` hasta 100). Hay que devolver `.results` y, si `next` no
   * es null, pedir también las páginas siguientes (como getSuscripciones en
   * shared). Si llega el envoltorio sin desenvolver, la página lo muestra
   * como error en vez de un listado vacío.
   *
   * Tiene que ser una función estable (p. ej. la de shared, no una flecha
   * nueva en cada render): si cambia, el listado se vuelve a pedir.
   */
  cargarCuentas?: () => Promise<CuentaConectada[]>;
  /**
   * AN-15: el bloque para conectar Gmail u Outlook (ConectarCorreo). Va en
   * esta página para que haya una sola ruta de Cuentas conectadas.
   */
  accionConectar?: ReactNode;
}

/**
 * Página de Cuentas conectadas (CH-23): ruta /cuentas, navegación y los
 * estados visuales. La integración del listado y del OAuth la hace Andrea
 * pasando las props de arriba desde App.tsx; esta página no llama a ninguna
 * API por su cuenta.
 */
export function CuentasConectadasPage({ cargarCuentas, accionConectar }: CuentasConectadasPageProps) {
  const [estado, setEstado] = useState<EstadoListaCuentas>(
    cargarCuentas ? { tipo: 'cargando' } : { tipo: 'no_disponible' },
  );
  // Cambiar el número vuelve a pedir el listado (botón Reintentar).
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!cargarCuentas) {
      setEstado({ tipo: 'no_disponible' });
      return;
    }
    // Si la página se desmonta o se reintenta antes de que llegue la
    // respuesta, esa respuesta vieja ya no se muestra.
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    cargarCuentas()
      .then((cuentas: unknown) => {
        if (!vigente) return;
        // Si llega otra cosa (p. ej. el envoltorio paginado sin .results),
        // es un error de integración: se avisa y se puede reintentar, en vez
        // de romper la página o decir "no tienes cuentas".
        if (Array.isArray(cuentas)) setEstado({ tipo: 'listo', cuentas: cuentas as CuentaConectada[] });
        else setEstado({ tipo: 'error', mensaje: MENSAJE_ERROR });
      })
      .catch((err: unknown) => {
        if (vigente) setEstado({ tipo: 'error', mensaje: err instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR });
      });
    return () => {
      vigente = false;
    };
  }, [cargarCuentas, intento]);

  return (
    <AppLayout
      headerTitulo="Cuentas conectadas"
      headerSubtitulo="Conecta tu correo y los cobros nuevos se registran solos."
    >
      <div className={styles.grid}>
        <Seccion
          titulo="Conectar una cuenta"
          descripcion="Solo leemos los mensajes de cobros y suscripciones."
          icono={<Plug size={19} aria-hidden="true" />}
          tinte="turquesa"
        >
          {accionConectar ?? (
            <p className={styles.mensaje}>La conexión con Gmail y Outlook todavía no está disponible.</p>
          )}
        </Seccion>

        <Seccion
          titulo="Tus cuentas"
          icono={<Link2 size={19} aria-hidden="true" />}
          tinte="azul"
          // CH-27: lo que trajo cada cuenta o archivo, y cómo va.
          accion={
            <BotonEnlace to="/importaciones" variante="sutil" tamano="s">
              Ver importaciones
            </BotonEnlace>
          }
        >
          <ListaCuentas estado={estado} onReintentar={() => setIntento((n) => n + 1)} />
        </Seccion>
      </div>
    </AppLayout>
  );
}
