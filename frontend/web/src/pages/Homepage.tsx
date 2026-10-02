import React, { useEffect, useMemo, useState } from "react";
import SubscriptionItem from "../components/subscriptions/Subscriptionitem";
import AddSubscriptionForm from "../components/subscriptions/NuevaSuscripcionForm";
import Pagination from "../components/subscriptions/pagination";
import EmptyState from "../components/subscriptions/EmptyState";
import EditarSuscripcionForm, {
  aFormulario,
  type EditarSuscripcionFormData,
} from "../components/subscriptions/EditarSuscripcionForm";
import EliminarSuscripcionDialog from "../components/subscriptions/EliminarSus";
import {
  actualizarSuscripcion,
  crearSuscripcion,
  eliminarSuscripcion,
  ErrorDeApi,
  formatearMonto,
  gastoProyectado,
  getSuscripciones,
  type Suscripcion,
} from "@ojoalgasto/shared";

import styles from "./Homepage.module.css";
import { AppLayout } from "../components/layout/AppLayout";

const PAGE_SIZE = 5;

/** Saca un mensaje legible de cualquier error que puedan tirar las llamadas a la API. */
function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof ErrorDeApi) return e.message;
  return fallback;
}

export const Homepage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // error propio de cada acción (no pisa el error de carga de la lista)
  const [addError, setAddError] = useState<string | null>(null);
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

  const paginadas = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return suscripciones.slice(start, start + PAGE_SIZE);
  }, [suscripciones, currentPage]);

  // si al eliminar (o filtrar) la página actual queda fuera de rango —ej.
  // estabas en la página 2 y solo quedaba 1 item ahí—, vuelve a la última
  // página válida en vez de dejar la lista vacía sin forma de navegar atrás.
  useEffect(() => {
    if (isLoading) return;
    const totalPages = Math.max(1, Math.ceil(suscripciones.length / PAGE_SIZE));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [suscripciones, currentPage, isLoading]);

  const handleClick = (s: Suscripcion) => {
    // TODO: navegar a /suscripciones/:id, que ya existe como ruta.
    console.log("Suscripción seleccionada:", s.nombre);
  };

  const handleAdd = async (nueva: Omit<Suscripcion, "id">) => {
    setAddError(null);
    setIsSavingAdd(true);
    try {
      const creada = await crearSuscripcion(nueva);
      setSuscripciones((prev) => [...prev, creada]);
      setIsAdding(false);
      setCurrentPage(Math.ceil((suscripciones.length + 1) / PAGE_SIZE));
    } catch (e) {
      setAddError(mensajeDeError(e, "No pudimos crear la suscripción. Intenta de nuevo."));
    } finally {
      setIsSavingAdd(false);
    }
  };

  const handleEditSubmit = async (data: EditarSuscripcionFormData) => {
    setEditError(null);
    setIsSavingEdit(true);
    try {
      const actualizada = await actualizarSuscripcion(data.id, {
        nombre: data.nombre,
        monto: parseFloat(data.monto),
        moneda: data.moneda,
        frecuencia: data.frecuencia,
        categoria: data.categoria,
      });
      setSuscripciones((prev) =>
        prev.map((s) => (s.id === data.id ? actualizada : s))
      );
      setEditando(null);
    } catch (e) {
      setEditError(mensajeDeError(e, "No pudimos guardar los cambios. Intenta de nuevo."));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // debe coincidir con la duración de la animación en suscard.module.css
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

  const isEmpty = !isLoading && !error && suscripciones.length === 0;

  return (
    <AppLayout
      headerTitulo="Inicio"
      headerSubtitulo=" Aquí tienes el estado de tus finanzas y cobros hoy."
      headerEtiquetaFecha="Octubre, 2026"
    >
      <div className={styles.dashboardPage}>
        {error ? (
          <p className={styles.summaryLabel}>{error}</p>
        ) : isEmpty ? (
          <EmptyState
            className={styles.emptyState}
            title="No tienes suscripciones registradas"
            description="Agrega suscripciones para controlar tus gastos recurrentes, recibir alertas de cobro y obtener recomendaciones personalizadas de ahorro."
            actionLabel="Agregar suscripción"
            onAction={() => setIsAdding(true)}
          />
        ) : (
          <>
            <section className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Total mensual</span>
              <p className={styles.summaryValue}>
                {isLoading ? "···" : formatearMonto(gastoProyectado(suscripciones))}{" "}
                <span className={styles.summaryPeriod}>/mes</span>
              </p>
            </section>

            <section className={styles.listSection}>
              <div className={styles.listHeader}>
                <h2 className={styles.listTitle}>Tus suscripciones</h2>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={() => setIsAdding((v) => !v)}
                >
                  {isAdding ? "Cerrar" : "+ Agregar suscripción"}
                </button>
              </div>

              {deleteError && <p className={styles.summaryLabel}>{deleteError}</p>}

              <ul className={styles.list}>
                {isLoading
                  ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                      <SubscriptionItem key={`placeholder-${i}`} isLoading />
                    ))
                  : paginadas.map((s) => (
                      <SubscriptionItem
                        key={s.id}
                        suscripcion={s}
                        onClick={handleClick}
                        onEdit={setEditando}
                        onDelete={setEliminando}
                        isRemoving={s.id === removingId}
                      />
                    ))}
              </ul>

              {!isLoading && (
                <Pagination
                  currentPage={currentPage}
                  totalItems={suscripciones.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setCurrentPage}
                />
              )}
            </section>
          </>
        )}

        {/* Overlay de nueva suscripción (fuera de la lista para que también
            funcione desde el estado vacío) */}
        {isAdding && (
          <div
            className={styles.formOverlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsAdding(false);
            }}
          >
            {addError && <p className={styles.summaryLabel}>{addError}</p>}
            <AddSubscriptionForm
              onAdd={handleAdd}
              onCancel={() => setIsAdding(false)}
              isSaving={isSavingAdd}
            />
          </div>
        )}

        {/* Overlay del formulario de edición */}
        {editando && (
          <div
            className={styles.formOverlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditando(null);
            }}
          >
            {editError && <p className={styles.summaryLabel}>{editError}</p>}
            <EditarSuscripcionForm
              suscripcion={aFormulario(editando)}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditando(null)}
              isSaving={isSavingEdit}
            />
          </div>
        )}

        {/* Overlay del diálogo de confirmación de eliminar */}
        {eliminando && (
          <div
            className={styles.formOverlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) setEliminando(null);
            }}
          >
            <EliminarSuscripcionDialog
              nombreSuscripcion={eliminando.nombre}
              onConfirm={handleConfirmDelete}
              onCancel={() => setEliminando(null)}
              isDeleting={isDeleting}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Homepage;