import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, FilterX, Plus, SearchX } from "lucide-react";
import TarjetaSuscripcion from "../components/subscriptions/TarjetaSuscripcion";
import AddSubscriptionForm from "../components/subscriptions/NuevaSuscripcionForm";
import Pagination from "../components/subscriptions/pagination";
import EmptyState from "../components/subscriptions/EmptyState";
import EditarSuscripcionForm, {
  aFormulario,
  type EditarSuscripcionFormData,
} from "../components/subscriptions/EditarSuscripcionForm";
import EliminarSuscripcionDialog from "../components/subscriptions/EliminarSus";
import CancelarSuscripcionDialog from "../components/subscriptions/CancelarSus";
import AvisoCambiosSinGuardar from "../components/subscriptions/AvisoCambiosSinGuardar";
import { useAvisoAlSalir } from "../hooks/useAvisoAlSalir";
import { Modal } from "../components/ui/Modal";
import { Boton } from "../components/ui/Boton";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { contarAvisos } from "./DashboardPage";
import {
  actualizarSuscripcion,
  cancelarSuscripcion,
  crearSuscripcion,
  eliminarSuscripcion,
  equivalenteMensual,
  ErrorDeApi,
  esFechaReal,
  esOrdenSuscripciones,
  formatearFecha,
  formatearMonto,
  gastoProyectado,
  getSuscripciones,
  reactivarSuscripcion,
  type OrdenSuscripciones,
  type Suscripcion,
} from "@ojoalgasto/shared";

import styles from "./Homepage.module.css";
import { AppLayout } from "../components/layout/AppLayout";

const PAGE_SIZE = 9;

type Filtro = "todas" | Suscripcion["estado"];

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "activo", etiqueta: "Activas" },
  { valor: "fantasma", etiqueta: "Sin uso" },
  { valor: "prueba", etiqueta: "Pruebas" },
  { valor: "por_confirmar", etiqueta: "Por confirmar" },
  { valor: "cancelado", etiqueta: "Canceladas" },
];

// CH-12: el orden con que se abre Inicio y al que vuelve "Limpiar filtros"
// (CH-13): el cobro más cercano primero, que es lo primero que hay que mirar.
const ORDEN_PREDETERMINADO: OrdenSuscripciones = "fecha_proximo_cobro";

const ORDENES: { valor: OrdenSuscripciones; etiqueta: string }[] = [
  { valor: "fecha_proximo_cobro", etiqueta: "Próximo cobro: más cercano primero" },
  { valor: "-fecha_proximo_cobro", etiqueta: "Próximo cobro: más lejano primero" },
  { valor: "nombre", etiqueta: "Nombre: de la A a la Z" },
  { valor: "-nombre", etiqueta: "Nombre: de la Z a la A" },
  { valor: "monto", etiqueta: "Monto: de menor a mayor" },
  { valor: "-monto", etiqueta: "Monto: de mayor a menor" },
];

/**
 * Filtros, orden y búsqueda de Inicio. Viven en la URL (?estado=,
 * ?fecha_cobro=, ?orden=, ?q=): así se conservan al ir a un detalle y volver,
 * o al recargar (CH-11).
 */
interface Vista {
  filtro: Filtro;
  /** YYYY-MM-DD, o "" sin filtro de fecha. */
  fecha: string;
  orden: OrdenSuscripciones;
  busqueda: string;
}

/**
 * Lee la vista de la URL. La URL la puede escribir cualquiera: un estado,
 * una fecha o un orden que no existen vuelven al valor predeterminado en vez
 * de viajar a la API (CH-12: nada fuera de la lista llega a la consulta).
 */
function leerVista(parametros: URLSearchParams): Vista {
  const estado = parametros.get("estado");
  const fecha = parametros.get("fecha_cobro") ?? "";
  const orden = parametros.get("orden") ?? "";
  return {
    filtro: FILTROS.find((f) => f.valor !== "todas" && f.valor === estado)?.valor ?? "todas",
    fecha: esFechaReal(fecha) ? fecha : "",
    orden: esOrdenSuscripciones(orden) ? orden : ORDEN_PREDETERMINADO,
    busqueda: parametros.get("q") ?? "",
  };
}

/** "en Canceladas, con «net» en el nombre y con cobro el 10 nov 2026", para el mensaje sin coincidencias (CH-13). */
function describirVista({ filtro, fecha, busqueda }: Vista): string {
  const partes: string[] = [];
  if (filtro !== "todas") partes.push(`en ${FILTROS.find((f) => f.valor === filtro)?.etiqueta ?? filtro}`);
  if (busqueda.trim()) partes.push(`con «${busqueda.trim()}» en el nombre`);
  if (fecha) partes.push(`con cobro el ${formatearFecha(fecha)}`);
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** Saca un mensaje legible de cualquier error que puedan tirar las llamadas a la API. */
function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof ErrorDeApi) return e.message;
  return fallback;
}

/** Qué decir si el interruptor no pudo cancelar o reactivar. La suscripción no cambió. */
function mensajeErrorSeguimiento(e: unknown, accion: "cancelar" | "reactivar"): string {
  if (e instanceof TypeError) return "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
  if (e instanceof ErrorDeApi) {
    if (e.status === 403) return `No tienes permiso para ${accion} esta suscripción.`;
    if (e.status === 404) return "Esta suscripción ya no existe. Actualizamos tu lista.";
    if (e.status < 500 && e.message) return e.message;
  }
  return `No pudimos ${accion} la suscripción. Intenta de nuevo.`;
}

/** Si `s` sigue entrando en la consulta de esa clave (su estado y su fecha de cobro). */
function entraEnLaClave(s: Suscripcion, clave: string): boolean {
  const [filtro, fecha] = clave.split("|");
  return (filtro === "todas" || s.estado === filtro) && (fecha === "" || s.fecha_proximo_cobro === fecha);
}

const MENSAJE_ERROR_LISTADO = "No pudimos cargar tus suscripciones con estos filtros. Intenta de nuevo.";
const MENSAJE_CAMBIO_SIN_LISTADO = "Guardamos el cambio, pero no pudimos actualizar la lista. Intenta de nuevo.";

/** "Netflíx" y "netflix" se encuentran igual. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export const Homepage: React.FC = () => {
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const vista = leerVista(parametros);
  const { filtro, fecha, orden, busqueda } = vista;
  // Identifica la consulta a la API: la grilla solo muestra resultados de la clave actual.
  const clave = `${filtro}|${fecha}|${orden}`;
  const idFecha = useId();
  const idOrden = useId();

  // Todas las suscripciones, sin filtros: el resumen, los conteos de cada
  // estado y saber si la cuenta está vacía salen de acá (CH-13).
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // CH-11/CH-12: la grilla muestra lo que devuelve la API con estos filtros y
  // este orden, guardado junto a su clave. Mientras llega la respuesta de una
  // clave nueva no se muestra la de la anterior (serían resultados inválidos).
  const [listado, setListado] = useState<{ clave: string; recarga: number; items: Suscripcion[] } | null>(null);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [recargaListado, setRecargaListado] = useState(0);
  const recargarListado = useCallback(() => setRecargaListado((n) => n + 1), []);
  // Al crear: la suscripción nueva y la recarga que la trae, para mostrar su página.
  const mostrarAlCargar = useRef<{ id: string; recarga: number } | null>(null);

  // error propio de cada acción (no pisa el error de carga de la lista)
  const [addError, setAddError] = useState<string | null>(null);
  // Errores por campo del backend al crear (CH-09): el formulario los
  // muestra junto a cada campo en vez de un solo mensaje.
  const [addErroresCampos, setAddErroresCampos] = useState<Record<string, string[]> | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // se deshabilitan los botones de los formularios mientras la llamada está en vuelo
  const [isSavingAdd, setIsSavingAdd] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // qué suscripción se está editando (null = modal cerrado)
  const [editando, setEditando] = useState<Suscripcion | null>(null);

  // qué suscripción se está por eliminar (null = diálogo cerrado)
  const [eliminando, setEliminando] = useState<Suscripcion | null>(null);
  // id de la suscripción que está haciendo fade-out ahora mismo
  const [removingId, setRemovingId] = useState<string | null>(null);

  // La sesión con que se montó Inicio. Si cambia, <RutaPrivada> la vuelve a
  // montar; esto cubre el instante antes de ese montaje: un resultado de la
  // cuenta anterior no se aplica, y no se cancela ni reactiva con el token
  // de la nueva.
  const toast = useToast();
  const { capturarSesion } = useAuth();
  const [sesion] = useState(capturarSesion);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  const sigueVigente = useCallback(() => montada.current && capturarSesion() === sesion, [capturarSesion, sesion]);

  // Interruptor de seguimiento: una operación por suscripción a la vez. La
  // ref decide en el mismo instante (doble clic); el estado bloquea la tarjeta.
  const cambiosEnCurso = useRef(new Set<string>());
  const [cambiando, setCambiando] = useState<ReadonlySet<string>>(() => new Set());
  // Qué suscripción se está por cancelar (null = confirmación cerrada).
  const [cancelando, setCancelando] = useState<Suscripcion | null>(null);
  const idCancelando = useRef<string | null>(null);
  const [errorCancelacion, setErrorCancelacion] = useState<string | null>(null);
  // Sube con cada cancelación o reactivación confirmada. Una lectura que
  // salió antes puede traer el estado anterior: no pisa el nuevo.
  const generacion = useRef(0);
  // La generación de la lista que se ve: si es más vieja y la recarga falla,
  // el cambio ya está guardado y lo que falta es actualizar la lista.
  const generacionListado = useRef(0);
  const [recargaTodas, setRecargaTodas] = useState(0);

  // CH-16: si el formulario abierto (crear o editar; nunca hay dos a la vez)
  // tiene cambios sin guardar. Es una ref y no estado a propósito: el Modal
  // re-enfoca su primer campo cada vez que cambia su `alCerrar`, y si este
  // dependiera de un estado, la primera tecla movería el cursor.
  const hayCambiosSinGuardar = useRef(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const marcarCambios = useCallback((hayCambios: boolean) => {
    hayCambiosSinGuardar.current = hayCambios;
  }, []);
  // Cerrar o recargar la pestaña con cambios pide confirmación al navegador.
  useAvisoAlSalir(hayCambiosSinGuardar);

  // Navegar dentro de la app (Atrás/Adelante, un enlace, navigate()) con
  // cambios sin guardar: el router RETIENE la navegación hasta que se elige
  // en el aviso. "Seguir editando" la cancela y "Descartar" la deja seguir.
  // Antes solo se cubría cerrar/recargar la pestaña (revisión PR #80).
  const navegacion = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hayCambiosSinGuardar.current &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  // Los handlers async (guardar) terminan varios renders después: leen el
  // estado del bloqueo desde acá para no usar uno viejo.
  const navegacionActual = useRef(navegacion);
  useEffect(() => {
    navegacionActual.current = navegacion;
  });
  const mostrarAviso = confirmandoDescarte || navegacion.state === "blocked";

  const seguirEditando = () => {
    setConfirmandoDescarte(false);
    if (navegacion.state === "blocked") navegacion.reset(); // cancela la navegación retenida
  };
  // Se usa al descartar y al guardar: si había una navegación retenida, ya
  // no hay nada que perder y se completa.
  const continuarNavegacionPendiente = () => {
    const actual = navegacionActual.current;
    if (actual.state === "blocked") actual.proceed();
  };

  useEffect(() => {
    let cancelado = false;
    const generacionAlPedir = generacion.current;

    getSuscripciones()
      .then((lista) => {
        if (cancelado) return;
        // Salió antes de cancelar o reactivar: puede traer el estado anterior. Se pide de nuevo.
        if (generacion.current !== generacionAlPedir) {
          setRecargaTodas((n) => n + 1);
          return;
        }
        setSuscripciones(lista);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelado) return;
        setError("No pudimos cargar tus suscripciones. Intenta de nuevo en unos segundos.");
        setIsLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [recargaTodas]);

  // Estado, fecha y orden se mandan a la API, que filtra y ordena ANTES de
  // paginar (CH-11, CH-12). Una respuesta de una consulta anterior se descarta,
  // y también una que salió antes de cancelar o reactivar: esas operaciones
  // piden la lista de nuevo.
  useEffect(() => {
    let cancelado = false;
    const generacionAlPedir = generacion.current;
    const vigente = () => !cancelado && generacion.current === generacionAlPedir;
    setErrorListado(null);

    getSuscripciones({
      ...(filtro !== "todas" ? { estado: filtro } : {}),
      ...(fecha ? { fecha_cobro: fecha } : {}),
      orden,
    })
      .then((items) => {
        if (!vigente()) return;
        generacionListado.current = generacionAlPedir;
        setListado({ clave, recarga: recargaListado, items });
      })
      .catch(() => {
        if (!vigente()) return;
        setErrorListado(generacionListado.current < generacionAlPedir ? MENSAJE_CAMBIO_SIN_LISTADO : MENSAJE_ERROR_LISTADO);
      });

    return () => {
      cancelado = true;
    };
  }, [clave, filtro, fecha, orden, recargaListado]);

  // Cambiar un filtro, el orden o la búsqueda (también con Atrás/Adelante)
  // vuelve a la primera página.
  useEffect(() => {
    setCurrentPage(1);
  }, [busqueda, clave]);

  const itemsVigentes = listado?.clave === clave ? listado.items : null;
  const cargandoGrilla = isLoading || (itemsVigentes === null && errorListado === null);

  // La búsqueda se aplica acá, sobre lo que mandó la API: así "Netflíx" y
  // "netflix" se encuentran igual, cosa que el filtro del backend no hace.
  // Filtrar no cambia el orden.
  const visibles = useMemo(() => {
    if (!itemsVigentes) return [];
    const q = normalizar(busqueda.trim());
    return q === "" ? itemsVigentes : itemsVigentes.filter((s) => normalizar(s.nombre).includes(q));
  }, [itemsVigentes, busqueda]);

  const paginadas = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return visibles.slice(start, start + PAGE_SIZE);
  }, [visibles, currentPage]);

  // si al eliminar (o filtrar) la página actual queda fuera de rango, vuelve
  // a la última página válida en vez de dejar la lista vacía.
  useEffect(() => {
    if (cargandoGrilla) return;
    const totalPages = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [visibles, currentPage, cargandoGrilla]);

  // Después de crear: cuando llega la lista que la incluye, se va a la página
  // donde quedó según el orden elegido.
  useEffect(() => {
    const pendiente = mostrarAlCargar.current;
    if (!pendiente || !listado || listado.clave !== clave || listado.recarga < pendiente.recarga) return;
    mostrarAlCargar.current = null;
    const indice = visibles.findIndex((s) => s.id === pendiente.id);
    if (indice >= 0) setCurrentPage(Math.floor(indice / PAGE_SIZE) + 1);
  }, [listado, clave, visibles]);

  /** Cambia filtros, orden o búsqueda en la URL, sin sumar entradas al historial. */
  const cambiarVista = useCallback(
    (cambios: Partial<Vista>) => {
      setParametros(
        (actuales) => {
          const nuevos = new URLSearchParams(actuales);
          const fijar = (nombre: string, valor: string | undefined, predeterminado: string) => {
            if (valor === undefined) return;
            if (valor === predeterminado) nuevos.delete(nombre);
            else nuevos.set(nombre, valor);
          };
          fijar("estado", cambios.filtro, "todas");
          fijar("fecha_cobro", cambios.fecha, "");
          fijar("orden", cambios.orden, ORDEN_PREDETERMINADO);
          fijar("q", cambios.busqueda, "");
          return nuevos;
        },
        { replace: true },
      );
    },
    [setParametros],
  );

  // CH-13: vuelve a los valores acordados: todas, sin fecha, el orden
  // predeterminado, sin búsqueda y (por el efecto de arriba) la página 1.
  const hayFiltros = filtro !== "todas" || fecha !== "" || orden !== ORDEN_PREDETERMINADO || busqueda !== "";
  const limpiarFiltros = () => cambiarVista({ filtro: "todas", fecha: "", orden: ORDEN_PREDETERMINADO, busqueda: "" });

  const conteoPorFiltro = useMemo(() => {
    const conteo: Record<Filtro, number> = {
      todas: suscripciones.length,
      activo: 0,
      fantasma: 0,
      prueba: 0,
      por_confirmar: 0,
      cancelado: 0,
    };
    for (const s of suscripciones) conteo[s.estado] += 1;
    return conteo;
  }, [suscripciones]);

  const handleClick = (s: Suscripcion) => {
    navigate(`/suscripciones/${s.id}`);
  };

  const handleAdd = async (nueva: Omit<Suscripcion, "id">): Promise<boolean> => {
    setAddError(null);
    setAddErroresCampos(null);
    setIsSavingAdd(true);
    try {
      const creada = await crearSuscripcion(nueva);
      setSuscripciones((prev) => [...prev, creada]);
      // Guardado: ya no hay nada que perder. También se quita el aviso, por si
      // se guardó con él visible (antes quedaba pendiente al reabrir).
      hayCambiosSinGuardar.current = false;
      setConfirmandoDescarte(false);
      if (navegacionActual.current.state === "blocked") {
        // Se estaba yendo de Inicio: se completa esa navegación.
        continuarNavegacionPendiente();
      } else {
        // La nueva podría no cumplir el estado o la fecha elegidos: se quitan
        // esos filtros, se vuelve a pedir la lista (su lugar depende del
        // orden) y se muestra la página donde quedó.
        mostrarAlCargar.current = { id: creada.id, recarga: recargaListado + 1 };
        cambiarVista({ filtro: "todas", fecha: "" });
        recargarListado();
      }
      setIsAdding(false);
      return true;
    } catch (e) {
      if (e instanceof ErrorDeApi && e.campos) {
        setAddErroresCampos(e.campos);
      } else {
        setAddError(mensajeDeError(e, "No pudimos crear la suscripción. Intenta de nuevo."));
      }
      return false;
    } finally {
      setIsSavingAdd(false);
    }
  };

  const handleEditSubmit = async (data: EditarSuscripcionFormData) => {
    setEditError(null);

    // Sin esto, un monto vacío o no numérico manda `null` en el PATCH y el
    // backend responde 400 con un mensaje genérico.
    const monto = parseFloat(data.monto.replace(",", "."));
    if (!data.nombre.trim() || Number.isNaN(monto)) {
      setEditError("Revisa el nombre y el monto: no pueden quedar vacíos.");
      return;
    }

    setIsSavingEdit(true);
    try {
      const actualizada = await actualizarSuscripcion(data.id, {
        nombre: data.nombre.trim(),
        monto,
        moneda: data.moneda,
        frecuencia: data.frecuencia,
        categoria: data.categoria,
      });
      setSuscripciones((prev) => prev.map((s) => (s.id === data.id ? actualizada : s)));
      // Se ve el cambio de inmediato y se vuelve a pedir la lista: con otro
      // monto o nombre puede quedar en otro lugar del orden.
      setListado((l) => l && { ...l, items: l.items.map((s) => (s.id === data.id ? actualizada : s)) });
      recargarListado();
      hayCambiosSinGuardar.current = false;
      setConfirmandoDescarte(false);
      continuarNavegacionPendiente();
      setEditando(null);
    } catch (e) {
      setEditError(mensajeDeError(e, "No pudimos guardar los cambios. Intenta de nuevo."));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // debe coincidir con la duración de la animación en TarjetaSuscripcion.module.css
  const FADE_OUT_MS = 280;

  const handleConfirmDelete = async () => {
    if (!eliminando) return;
    const idToRemove = eliminando.id;

    setDeleteError(null);
    setIsDeleting(true);
    try {
      await eliminarSuscripcion(idToRemove);
      setEliminando(null);
      setRemovingId(idToRemove);

      setTimeout(() => {
        setSuscripciones((prev) => prev.filter((s) => s.id !== idToRemove));
        setListado((l) => l && { ...l, items: l.items.filter((s) => s.id !== idToRemove) });
        setRemovingId(null);
      }, FADE_OUT_MS);
    } catch (e) {
      // si falla el DELETE, no se dispara el fade-out y la suscripción se
      // queda en la lista tal como estaba
      setDeleteError(mensajeDeError(e, "No pudimos eliminar la suscripción. Intenta de nuevo."));
    } finally {
      setIsDeleting(false);
    }
  };

  const cerrarAgregar = useCallback(() => {
    setAddError(null);
    setAddErroresCampos(null);
    hayCambiosSinGuardar.current = false;
    setConfirmandoDescarte(false);
    setIsAdding(false);
  }, []);
  const cerrarEditar = useCallback(() => {
    setEditError(null);
    hayCambiosSinGuardar.current = false;
    setConfirmandoDescarte(false);
    setEditando(null);
  }, []);
  // Cancelar, la X, Escape o el fondo pasan por acá: con cambios sin guardar
  // se pregunta antes; con el formulario limpio se cierra sin aviso.
  const intentarCerrarAgregar = useCallback(() => {
    if (hayCambiosSinGuardar.current) setConfirmandoDescarte(true);
    else cerrarAgregar();
  }, [cerrarAgregar]);
  const intentarCerrarEditar = useCallback(() => {
    if (hayCambiosSinGuardar.current) setConfirmandoDescarte(true);
    else cerrarEditar();
  }, [cerrarEditar]);
  const cerrarEliminar = useCallback(() => {
    setDeleteError(null);
    setEliminando(null);
  }, []);

  /** Reserva la suscripción para cancelar o reactivar; false si ya hay una operación en vuelo sobre ella. */
  const reservarCambio = (id: string): boolean => {
    if (!sigueVigente() || cambiosEnCurso.current.has(id)) return false;
    cambiosEnCurso.current.add(id);
    setCambiando(new Set(cambiosEnCurso.current));
    return true;
  };

  const liberarCambio = (id: string) => {
    cambiosEnCurso.current.delete(id);
    if (sigueVigente()) setCambiando(new Set(cambiosEnCurso.current));
  };

  // El interruptor de la tarjeta. Usa las transiciones del backend (VI-03 y
  // VI-09), nunca un PATCH al estado ni el campo `activo` (que es eliminar).
  // Lo que se ve después es la suscripción que devuelve el servidor.
  const aplicarSeguimiento = async (s: Suscripcion, accion: "cancelar" | "reactivar") => {
    if (!reservarCambio(s.id)) return; // doble clic, o ya hay otra en vuelo sobre ella
    if (accion === "cancelar") setErrorCancelacion(null);
    try {
      const actualizada = accion === "cancelar" ? await cancelarSuscripcion(s.id) : await reactivarSuscripcion(s.id);
      if (!sigueVigente()) return;
      generacion.current += 1;
      // Conteos, resumen y campana salen de la lista completa.
      setSuscripciones((prev) => prev.map((x) => (x.id === actualizada.id ? actualizada : x)));
      // En la grilla se ve enseguida con los filtros actuales (una cancelada no
      // se queda en Activas) y se vuelve a pedir: su lugar puede cambiar.
      setListado(
        (l) =>
          l && {
            ...l,
            items: l.items.flatMap((x) => (x.id !== actualizada.id ? [x] : entraEnLaClave(actualizada, l.clave) ? [actualizada] : [])),
          },
      );
      recargarListado();
      if (accion === "cancelar") {
        idCancelando.current = null;
        setCancelando(null);
        toast.exito(`Cancelaste ${s.nombre}. Ya no contamos sus próximos cobros.`);
      } else {
        toast.exito(`Reactivaste ${s.nombre}. Volvemos a contar sus cobros.`);
      }
    } catch (e) {
      if (!sigueVigente()) return;
      const mensaje = mensajeErrorSeguimiento(e, accion);
      if (e instanceof ErrorDeApi && e.status === 404) {
        // Ya no existe (p. ej. la eliminaron en otro dispositivo): se cierra y se recarga la lista.
        idCancelando.current = null;
        setCancelando(null);
        toast.error(mensaje);
        setRecargaTodas((n) => n + 1);
        recargarListado();
      } else if (accion === "cancelar") {
        // Se ve dentro de la confirmación, que sigue abierta para reintentar.
        setErrorCancelacion(mensaje);
      } else {
        toast.error(mensaje);
      }
    } finally {
      liberarCambio(s.id);
    }
  };

  // Apagar pide confirmar (cancelar); prender reactiva enseguida.
  const cambiarSeguimiento = (s: Suscripcion) => {
    if (!sigueVigente()) return;
    if (s.estado === "cancelado") {
      void aplicarSeguimiento(s, "reactivar");
      return;
    }
    setErrorCancelacion(null);
    idCancelando.current = s.id;
    setCancelando(s);
  };

  // "Volver", la X y Escape: no se llama a la API. Mientras la cancelación
  // viaja no se cierra: el resultado decide qué se muestra.
  const cerrarCancelacion = useCallback(() => {
    if (!sigueVigente()) return;
    if (idCancelando.current && cambiosEnCurso.current.has(idCancelando.current)) return;
    idCancelando.current = null;
    setErrorCancelacion(null);
    setCancelando(null);
  }, [sigueVigente]);

  const isEmpty = !isLoading && !error && suscripciones.length === 0;
  const totalMensual = gastoProyectado(suscripciones);
  const fantasmasMensual = suscripciones
    .filter((s) => s.estado === "fantasma")
    .reduce((suma, s) => suma + equivalenteMensual(s.monto, s.frecuencia), 0);

  const botonAgregar = !isEmpty ? (
    <Boton
      icono={<Plus size={16} aria-hidden="true" />}
      onClick={() => {
        setAddError(null);
        setIsAdding(true);
      }}
    >
      Agregar suscripción
    </Boton>
  ) : undefined;

  return (
    <AppLayout
      headerTitulo="Inicio"
      headerSubtitulo="Tus suscripciones, una por una."
      headerAccionDerecha={botonAgregar}
      avisos={isLoading ? undefined : contarAvisos(suscripciones)}
    >
      {error ? (
        <p className={styles.mensaje}>{error}</p>
      ) : isEmpty ? (
        <EmptyState
          title="Todavía no registras suscripciones"
          description="Agrega la primera y empieza a ver cuánto gastas al mes, qué cobros vienen y cuáles pagas sin usar."
          actionLabel="Agregar suscripción"
          onAction={() => {
            setAddError(null);
            setIsAdding(true);
          }}
        />
      ) : (
        <>
          <section className={`tile ${styles.resumen}`} aria-label="Resumen">
            <div className={styles.dato}>
              <p className={styles.datoEtiqueta}>Al mes</p>
              <p className={styles.datoValor}>{isLoading ? "···" : formatearMonto(totalMensual)}</p>
            </div>
            <div className={styles.dato}>
              <p className={styles.datoEtiqueta}>Suscripciones</p>
              <p className={styles.datoValor}>{isLoading ? "··" : suscripciones.length}</p>
            </div>
            <div className={`${styles.dato} ${fantasmasMensual > 0 ? styles.datoCoral : ""}`}>
              <p className={styles.datoEtiqueta}>Pagas sin usar</p>
              <p className={styles.datoValor}>{isLoading ? "···" : formatearMonto(fantasmasMensual)}</p>
            </div>
          </section>

          <div className={styles.filtros} role="group" aria-label="Filtrar por estado">
            {/* El filtro elegido se ve aunque hoy no tenga ninguna (p. ej. llegó por la URL). */}
            {FILTROS.filter((f) => f.valor === "todas" || f.valor === filtro || conteoPorFiltro[f.valor] > 0).map((f) => (
              <button
                key={f.valor}
                type="button"
                className={filtro === f.valor ? `${styles.filtro} ${styles.filtroActivo}` : styles.filtro}
                aria-pressed={filtro === f.valor}
                onClick={() => cambiarVista({ filtro: f.valor })}
              >
                {f.etiqueta}
                <span className={styles.filtroConteo}>{conteoPorFiltro[f.valor]}</span>
              </button>
            ))}
            {busqueda && (
              <span className={styles.busquedaActiva}>
                Buscando «{busqueda}»
              </span>
            )}
          </div>

          <div className={styles.controles}>
            <div className={styles.control}>
              <label htmlFor={idFecha} className={styles.controlEtiqueta}>
                Fecha de cobro
              </label>
              <input
                id={idFecha}
                type="date"
                className={styles.controlCampo}
                value={fecha}
                onChange={(e) => cambiarVista({ fecha: e.target.value })}
              />
            </div>
            <div className={styles.control}>
              <label htmlFor={idOrden} className={styles.controlEtiqueta}>
                Ordenar por
              </label>
              <span className={styles.campoOrden}>
                {/* Indicador de la dirección; el texto de la opción dice el criterio. */}
                {orden.startsWith("-") ? (
                  <ArrowDownWideNarrow size={15} aria-hidden="true" />
                ) : (
                  <ArrowUpNarrowWide size={15} aria-hidden="true" />
                )}
                <select
                  id={idOrden}
                  className={styles.controlCampo}
                  value={orden}
                  // Las opciones salen de ORDENES; leerVista() igual lo vuelve a validar.
                  onChange={(e) => cambiarVista({ orden: e.target.value as OrdenSuscripciones })}
                >
                  {ORDENES.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.etiqueta}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {hayFiltros && (
              <Boton
                variante="sutil"
                tamano="s"
                className={styles.limpiar}
                icono={<FilterX size={15} aria-hidden="true" />}
                onClick={limpiarFiltros}
              >
                Limpiar filtros
              </Boton>
            )}
          </div>

          {errorListado && (
            <div className={styles.errorListado} role="alert">
              <p>{errorListado}</p>
              <Boton variante="secundario" tamano="s" onClick={recargarListado}>
                Reintentar
              </Boton>
            </div>
          )}

          <ul className={styles.grilla}>
            {cargandoGrilla
              ? Array.from({ length: 6 }).map((_, i) => <TarjetaSuscripcion key={`placeholder-${i}`} isLoading />)
              : paginadas.map((s) => (
                  <TarjetaSuscripcion
                    key={s.id}
                    suscripcion={s}
                    onClick={handleClick}
                    onEdit={(s) => {
                      setEditError(null);
                      setEditando(s);
                    }}
                    onDelete={(s) => {
                      setDeleteError(null);
                      setEliminando(s);
                    }}
                    onCambiarSeguimiento={cambiarSeguimiento}
                    isChangingState={cambiando.has(s.id)}
                    isRemoving={s.id === removingId}
                  />
                ))}
          </ul>

          {/* CH-13: la cuenta tiene suscripciones, pero ninguna cumple los
              filtros. No es la cuenta vacía: no invita a crear la primera. */}
          {!cargandoGrilla && itemsVigentes !== null && visibles.length === 0 && (
            <EmptyState
              icon={<SearchX size={44} aria-hidden="true" />}
              title="Ninguna suscripción coincide"
              description={
                hayFiltros
                  ? `No hay suscripciones ${describirVista(vista) || "con estos filtros"}.`
                  : "No encontramos suscripciones para mostrar."
              }
              actionLabel={hayFiltros ? "Limpiar filtros" : undefined}
              onAction={hayFiltros ? limpiarFiltros : undefined}
              actionIcon={<FilterX size={16} aria-hidden="true" />}
            />
          )}

          {!cargandoGrilla && (
            <Pagination
              currentPage={currentPage}
              totalItems={visibles.length}
              pageSize={PAGE_SIZE}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      {isAdding && (
        <Modal titulo="Nueva suscripción" descripcion="Lo que pagas y cuándo." alCerrar={intentarCerrarAgregar}>
          {mostrarAviso && (
            <AvisoCambiosSinGuardar
              onSeguirEditando={seguirEditando}
              onDescartar={() => {
                cerrarAgregar();
                continuarNavegacionPendiente();
              }}
            />
          )}
          <AddSubscriptionForm
            onAdd={handleAdd}
            onCancel={intentarCerrarAgregar}
            onCambiosSinGuardar={marcarCambios}
            isSaving={isSavingAdd}
            error={addError}
            erroresCampos={addErroresCampos}
          />
        </Modal>
      )}

      {editando && (
        <Modal titulo="Editar suscripción" descripcion={editando.nombre} alCerrar={intentarCerrarEditar}>
          {mostrarAviso && (
            <AvisoCambiosSinGuardar
              onSeguirEditando={seguirEditando}
              onDescartar={() => {
                cerrarEditar();
                continuarNavegacionPendiente();
              }}
            />
          )}
          <EditarSuscripcionForm
            suscripcion={aFormulario(editando)}
            onSubmit={handleEditSubmit}
            onCancel={intentarCerrarEditar}
            onCambiosSinGuardar={marcarCambios}
            isSaving={isSavingEdit}
            error={editError}
          />
        </Modal>
      )}

      {eliminando && (
        <Modal titulo="¿Eliminar suscripción?" alCerrar={cerrarEliminar} tipo="alerta">
          <EliminarSuscripcionDialog
            nombreSuscripcion={eliminando.nombre}
            onConfirm={handleConfirmDelete}
            onCancel={cerrarEliminar}
            isDeleting={isDeleting}
            error={deleteError}
          />
        </Modal>
      )}

      {cancelando && (
        <Modal titulo={`¿Cancelar ${cancelando.nombre}?`} alCerrar={cerrarCancelacion} tipo="alerta">
          <CancelarSuscripcionDialog
            nombreSuscripcion={cancelando.nombre}
            onConfirm={() => void aplicarSeguimiento(cancelando, "cancelar")}
            onVolver={cerrarCancelacion}
            isCancelling={cambiando.has(cancelando.id)}
            error={errorCancelacion}
          />
        </Modal>
      )}
    </AppLayout>
  );
};

export default Homepage;
