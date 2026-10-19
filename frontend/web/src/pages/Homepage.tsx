import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import TarjetaSuscripcion from "../components/subscriptions/TarjetaSuscripcion";
import AddSubscriptionForm from "../components/subscriptions/NuevaSuscripcionForm";
import Pagination from "../components/subscriptions/pagination";
import EmptyState from "../components/subscriptions/EmptyState";
import EditarSuscripcionForm, {
  aFormulario,
  type EditarSuscripcionFormData,
} from "../components/subscriptions/EditarSuscripcionForm";
import EliminarSuscripcionDialog from "../components/subscriptions/EliminarSus";
import AvisoCambiosSinGuardar from "../components/subscriptions/AvisoCambiosSinGuardar";
import { useAvisoAlSalir } from "../hooks/useAvisoAlSalir";
import { Modal } from "../components/ui/Modal";
import { Boton } from "../components/ui/Boton";
import { contarAvisos } from "./DashboardPage";
import {
  actualizarSuscripcion,
  crearSuscripcion,
  eliminarSuscripcion,
  equivalenteMensual,
  ErrorDeApi,
  formatearMonto,
  gastoProyectado,
  getSuscripciones,
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

/** Saca un mensaje legible de cualquier error que puedan tirar las llamadas a la API. */
function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof ErrorDeApi) return e.message;
  return fallback;
}

/** "Netflíx" y "netflix" se encuentran igual. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export const Homepage: React.FC = () => {
  const navigate = useNavigate();
  const [parametros] = useSearchParams();
  const busqueda = parametros.get("q") ?? "";

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [filtro, setFiltro] = useState<Filtro>("todas");

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

  useEffect(() => {
    let cancelado = false;

    getSuscripciones()
      .then((lista) => {
        if (cancelado) return;
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
  }, []);

  // Al cambiar la búsqueda se vuelve a la primera página.
  useEffect(() => {
    setCurrentPage(1);
  }, [busqueda]);

  const filtradas = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return suscripciones.filter(
      (s) => (filtro === "todas" || s.estado === filtro) && (q === "" || normalizar(s.nombre).includes(q)),
    );
  }, [suscripciones, filtro, busqueda]);

  const paginadas = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtradas.slice(start, start + PAGE_SIZE);
  }, [filtradas, currentPage]);

  // si al eliminar (o filtrar) la página actual queda fuera de rango, vuelve
  // a la última página válida en vez de dejar la lista vacía.
  useEffect(() => {
    if (isLoading) return;
    const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [filtradas, currentPage, isLoading]);

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
      setFiltro("todas");
      setCurrentPage(Math.ceil((suscripciones.length + 1) / PAGE_SIZE));
      // Guardado: ya no hay nada que perder.
      hayCambiosSinGuardar.current = false;
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
      hayCambiosSinGuardar.current = false;
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
            {FILTROS.filter((f) => f.valor === "todas" || conteoPorFiltro[f.valor] > 0).map((f) => (
              <button
                key={f.valor}
                type="button"
                className={filtro === f.valor ? `${styles.filtro} ${styles.filtroActivo}` : styles.filtro}
                aria-pressed={filtro === f.valor}
                onClick={() => {
                  setFiltro(f.valor);
                  setCurrentPage(1);
                }}
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

          <ul className={styles.grilla}>
            {isLoading
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
                    isRemoving={s.id === removingId}
                  />
                ))}
          </ul>

          {!isLoading && filtradas.length === 0 && (
            <p className={styles.sinResultados}>
              {busqueda ? `Nada se llama «${busqueda}».` : "No hay suscripciones en este estado por ahora."}
            </p>
          )}

          {!isLoading && (
            <Pagination
              currentPage={currentPage}
              totalItems={filtradas.length}
              pageSize={PAGE_SIZE}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      {isAdding && (
        <Modal titulo="Nueva suscripción" descripcion="Lo que pagas y cuándo." alCerrar={intentarCerrarAgregar}>
          {confirmandoDescarte && (
            <AvisoCambiosSinGuardar
              onSeguirEditando={() => setConfirmandoDescarte(false)}
              onDescartar={cerrarAgregar}
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
          {confirmandoDescarte && (
            <AvisoCambiosSinGuardar
              onSeguirEditando={() => setConfirmandoDescarte(false)}
              onDescartar={cerrarEditar}
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
    </AppLayout>
  );
};

export default Homepage;
