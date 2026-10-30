import { ErrorDeApi, getAlertas, marcarAlertaLeida, marcarTodasLasAlertasLeidas, TAMANO_PAGINA_ALERTAS, type Alerta } from '@ojoalgasto/shared';
import { Bell, BellOff, CheckCheck, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiltrosAlertas, leerFiltroAlertas, type FiltroAlertas } from '../components/alertas/FiltrosAlertas';
import { ItemAlerta } from '../components/alertas/ItemAlerta';
import { PaginacionAlertas } from '../components/alertas/PaginacionAlertas';
import { AppLayout } from '../components/layout/AppLayout';
import EmptyState from '../components/subscriptions/EmptyState';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { useAuth } from '../context/AuthContext';
import { useContadorAlertas } from '../context/ContadorAlertasContext';
import { useToast } from '../context/ToastContext';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import styles from './AlertasPage.module.css';

/** `clave` dice de qué filtro y página es lo cargado (`pendiente|2`). */
type Carga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; clave: string; mensaje: string }
  | { tipo: 'listo'; clave: string; alertas: Alerta[]; total: number; hayAnterior: boolean; haySiguiente: boolean };

const MENSAJE_ERROR_CARGA = 'No pudimos cargar tus alertas. Intenta de nuevo.';
const MENSAJE_ERROR_RECARGA = 'No pudimos actualizar tus alertas: puede que la lista no esté al día. Intenta de nuevo.';
const MENSAJE_ERROR_LEER = 'No pudimos marcar la alerta como leída. Intenta de nuevo.';
const MENSAJE_ERROR_LEER_TODAS = 'No pudimos marcar tus alertas como leídas. Intenta de nuevo.';

const mensajeDe = (err: unknown, otro: string) => (err instanceof TypeError ? MENSAJE_SIN_RED : otro);

/** Una página de la URL que no es un entero positivo vale 1. */
function leerPagina(valor: string | null): number {
  const pagina = Number(valor);
  return Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
}

/** Si la alerta, tal como está ahora, sigue cabiendo en el filtro de la vista. */
function entraEn(filtro: FiltroAlertas, alerta: Alerta): boolean {
  return filtro === 'todas' || alerta.lectura === filtro;
}

/** Lo que dice el estado vacío de cada filtro. */
const VACIO: Record<FiltroAlertas, { titulo: string; descripcion: string }> = {
  todas: {
    titulo: 'No tienes alertas',
    descripcion: 'Te avisamos aquí cuando se acerque un cobro, termine una prueba gratis o suba un precio.',
  },
  pendiente: {
    titulo: 'Estás al día',
    descripcion: 'No tienes alertas sin leer.',
  },
  leida: {
    titulo: 'No tienes alertas leídas',
    descripcion: 'Las que marques como leídas van a quedar aquí.',
  },
};

/**
 * El Centro de alertas (SE-01 y CH-31): las alertas de la organización con
 * FE-19, filtradas por lectura y paginadas en el servidor, y la lectura de
 * FE-20, que baja el número de la campana.
 *
 * El filtro y la página viven en la URL (`/alertas?lectura=pendiente&pagina=2`),
 * como los de Inicio: se pueden recargar y compartir.
 */
export function AlertasPage() {
  const [parametros, setParametros] = useSearchParams();
  const filtro = leerFiltroAlertas(parametros.get('lectura'));
  const pagina = leerPagina(parametros.get('pagina'));
  const { pendientes, actualizar: actualizarContador, descontar } = useContadorAlertas();
  const toast = useToast();

  // La sesión con que se montó. Si cambia, <RutaPrivada> vuelve a montar la
  // página; una respuesta que llega a la desmontada no toca nada.
  const { capturarSesion } = useAuth();
  const [sesion] = useState(capturarSesion);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  const sigueVigente = () => montada.current && capturarSesion() === sesion;

  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' });
  // Una recarga que falló con la lista a la vista: la lista se queda y se avisa aparte.
  const [errorRecarga, setErrorRecarga] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const recargar = useCallback(() => setRecarga((n) => n + 1), []);
  // De qué filtro y página son las filas que se ven. Con la misma clave se
  // recarga sin borrar la lista; con otra, se muestra «Cargando».
  const claveActual = `${filtro}|${pagina}`;
  const claveMostrada = useRef<string | null>(null);

  // La vista actual, para lo que termina después de un await.
  const vista = useRef({ filtro, pagina });
  useEffect(() => {
    vista.current = { filtro, pagina };
  });

  const cambiarVista = useCallback(
    (cambios: { filtro?: FiltroAlertas; pagina?: number }) => {
      setParametros(
        (actuales) => {
          const nuevos = new URLSearchParams(actuales);
          if (cambios.filtro !== undefined) {
            if (cambios.filtro === 'todas') nuevos.delete('lectura');
            else nuevos.set('lectura', cambios.filtro);
            // Otro filtro empieza en su primera página.
            nuevos.delete('pagina');
          }
          if (cambios.pagina !== undefined) {
            if (cambios.pagina <= 1) nuevos.delete('pagina');
            else nuevos.set('pagina', String(cambios.pagina));
          }
          return nuevos;
        },
        { replace: true },
      );
    },
    [setParametros],
  );

  useEffect(() => {
    let cancelado = false;
    const clave = claveActual;
    const silenciosa = claveMostrada.current === clave;
    if (!silenciosa) {
      claveMostrada.current = null;
      setCarga({ tipo: 'cargando' });
      setErrorRecarga(null);
      // Cada vista nueva pone al día la campana y el chip: si nacieron alertas
      // desde la última vez, la lista no puede decir una cosa y la campana otra.
      actualizarContador();
    }
    getAlertas({ lectura: filtro === 'todas' ? undefined : filtro, pagina })
      .then((respuesta) => {
        if (cancelado) return;
        claveMostrada.current = clave;
        setCarga({
          tipo: 'listo',
          clave,
          alertas: respuesta.results,
          total: respuesta.count,
          hayAnterior: respuesta.previous !== null,
          haySiguiente: respuesta.next !== null,
        });
        setErrorRecarga(null);
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        // Una página que ya no existe. Si era la que se estaba viendo, se vació
        // al leer: a la de antes. Si llegó así por la URL, a la primera. Se
        // decide acá y no al vaciarse la lista, porque esta misma respuesta
        // llegaría después y pisaría esa navegación.
        if (err instanceof ErrorDeApi && err.status === 404 && pagina > 1) {
          cambiarVista({ pagina: silenciosa ? pagina - 1 : 1 });
          return;
        }
        if (silenciosa) {
          setErrorRecarga(mensajeDe(err, MENSAJE_ERROR_RECARGA));
        } else {
          setCarga({ tipo: 'error', clave, mensaje: mensajeDe(err, MENSAJE_ERROR_CARGA) });
        }
      });
    return () => {
      cancelado = true;
    };
  }, [claveActual, filtro, pagina, recarga, cambiarVista, actualizarContador]);

  /**
   * La fila que ya cambió en el servidor: se reemplaza si sigue en el filtro
   * de la vista actual, o sale si ya no cabe (o si no existe, con null).
   * Después se vuelve a pedir la página, que trae la que corrió a su lugar.
   */
  const aplicarCambio = (id: string, actualizada: Alerta | null) => {
    const { filtro: filtroAhora } = vista.current;
    setCarga((c) => {
      if (c.tipo !== 'listo') return c;
      const alertas = c.alertas.flatMap((a) =>
        a.id !== id ? [a] : actualizada && entraEn(filtroAhora, actualizada) ? [actualizada] : [],
      );
      return { ...c, alertas, total: c.total - (c.alertas.length - alertas.length) };
    });
    recargar();
  };

  // Una reserva por alerta: un doble clic manda un solo POST.
  const enCurso = useRef(new Set<string>());
  const [marcando, setMarcando] = useState<ReadonlySet<string>>(() => new Set());

  const marcarLeida = async (alerta: Alerta) => {
    if (enCurso.current.has(alerta.id) || !sigueVigente()) return;
    enCurso.current.add(alerta.id);
    setMarcando((actual) => new Set(actual).add(alerta.id));
    try {
      const leida = await marcarAlertaLeida(alerta.id);
      if (!sigueVigente()) return;
      // Se descuenta solo si esta llamada la sacó de las sin leer; si ya
      // estaba leída en otra pestaña, el servidor la devuelve igual y el
      // contador se corrige preguntando.
      if (alerta.pendiente && !leida.pendiente) descontar(1);
      else actualizarContador();
      aplicarCambio(alerta.id, leida);
    } catch (err: unknown) {
      if (!sigueVigente()) return;
      if (err instanceof ErrorDeApi && err.status === 404) {
        toast.error('Esa alerta ya no existe.');
        actualizarContador();
        aplicarCambio(alerta.id, null);
      } else {
        toast.error(mensajeDe(err, MENSAJE_ERROR_LEER));
      }
    } finally {
      enCurso.current.delete(alerta.id);
      if (montada.current) {
        setMarcando((actual) => {
          const siguiente = new Set(actual);
          siguiente.delete(alerta.id);
          return siguiente;
        });
      }
    }
  };

  const leyendoTodas = useRef(false);
  const [marcandoTodas, setMarcandoTodas] = useState(false);

  const marcarTodas = async () => {
    if (leyendoTodas.current || !sigueVigente()) return;
    leyendoTodas.current = true;
    setMarcandoTodas(true);
    try {
      const { leidas } = await marcarTodasLasAlertasLeidas();
      if (!sigueVigente()) return;
      descontar(leidas);
      toast.exito(leidas === 1 ? 'Marcamos 1 alerta como leída.' : `Marcamos ${leidas} alertas como leídas.`);
      // Las que se ven ya no están sin leer. La recarga trae la fecha de lectura
      // real; en «Sin leer» la página queda vacía y se pasa a la de antes.
      const { filtro: filtroAhora } = vista.current;
      setCarga((c) => {
        if (c.tipo !== 'listo') return c;
        const alertas = c.alertas.flatMap((a): Alerta[] => {
          if (!a.pendiente) return [a];
          const leida: Alerta = { ...a, lectura: 'leida', lectura_legible: 'Leída', pendiente: false };
          return entraEn(filtroAhora, leida) ? [leida] : [];
        });
        return { ...c, alertas, total: c.total - (c.alertas.length - alertas.length) };
      });
      recargar();
    } catch (err: unknown) {
      if (sigueVigente()) toast.error(mensajeDe(err, MENSAJE_ERROR_LEER_TODAS));
    } finally {
      leyendoTodas.current = false;
      if (montada.current) setMarcandoTodas(false);
    }
  };

  // Solo se muestra lo cargado para ESTE filtro y página. En el render que
  // sigue a cambiarlos (antes de que el efecto ponga «Cargando») seguiría a la
  // vista lo anterior: filas de otro filtro, o una página recién vaciada.
  const mostrada = carga.tipo !== 'cargando' && carga.clave === claveActual ? carga : null;
  // Una página después de la primera que quedó vacía al leer espera su
  // recarga, que la cambia por la anterior: no está «al día».
  const vaciada = mostrada?.tipo === 'listo' && mostrada.alertas.length === 0 && pagina > 1;
  const lista = mostrada?.tipo === 'listo' && !vaciada ? mostrada : null;

  const hayPendientesALaVista = lista !== null && lista.alertas.some((a) => a.pendiente);
  const acciones = (
    <>
      {((pendientes ?? 0) > 0 || hayPendientesALaVista) && (
        <Boton
          icono={<CheckCheck size={16} aria-hidden="true" />}
          cargando={marcandoTodas}
          onClick={marcarTodas}
        >
          Marcar todas como leídas
        </Boton>
      )}
      {/* Antes la campana llevaba acá (#134); ahora lleva al Centro y los ajustes quedan a un clic. */}
      <BotonEnlace to="/configuracion" variante="secundario" icono={<Settings size={16} aria-hidden="true" />}>
        Configurar avisos
      </BotonEnlace>
    </>
  );

  const totalPaginas = lista ? Math.ceil(lista.total / TAMANO_PAGINA_ALERTAS) : 0;

  return (
    <AppLayout
      headerTitulo="Alertas"
      headerSubtitulo="Cobros que se acercan, pruebas que terminan y precios que cambian."
      headerAccionDerecha={acciones}
      angosto
    >
      <div className={styles.barra}>
        <FiltrosAlertas valor={filtro} alCambiar={(f) => cambiarVista({ filtro: f })} pendientes={pendientes} />
      </div>

      {(mostrada === null || vaciada) && (
        <p className={styles.mensaje} role="status">
          Cargando tus alertas…
        </p>
      )}
      {mostrada?.tipo === 'error' && <ErrorConReintento mensaje={mostrada.mensaje} onReintentar={recargar} />}
      {lista && (
        <>
          {errorRecarga && <ErrorConReintento mensaje={errorRecarga} onReintentar={recargar} />}
          {lista.alertas.length === 0 ? (
            <EmptyState
              icon={filtro === 'pendiente' ? <BellOff size={48} aria-hidden="true" /> : <Bell size={48} aria-hidden="true" />}
              title={VACIO[filtro].titulo}
              description={VACIO[filtro].descripcion}
              actionLabel={filtro === 'todas' ? undefined : 'Ver todas'}
              onAction={filtro === 'todas' ? undefined : () => cambiarVista({ filtro: 'todas' })}
              actionIcon={<Bell size={16} aria-hidden="true" />}
            />
          ) : (
            <>
              <ul className={styles.lista} aria-label="Alertas">
                {lista.alertas.map((alerta) => (
                  <li key={alerta.id}>
                    <ItemAlerta alerta={alerta} marcando={marcando.has(alerta.id)} alMarcarLeida={marcarLeida} />
                  </li>
                ))}
              </ul>
              {(lista.hayAnterior || lista.haySiguiente) && (
                <PaginacionAlertas
                  pagina={pagina}
                  totalPaginas={totalPaginas}
                  hayAnterior={lista.hayAnterior}
                  haySiguiente={lista.haySiguiente}
                  alCambiar={(p) => cambiarVista({ pagina: p })}
                />
              )}
            </>
          )}
        </>
      )}
    </AppLayout>
  );
}
