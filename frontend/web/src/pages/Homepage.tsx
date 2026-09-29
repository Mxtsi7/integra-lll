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
  formatearMonto,
  gastoProyectado,
  getSuscripciones,
  type Suscripcion,
} from "@ojoalgasto/shared";

import styles from "./Homepage.module.css";
import { AppLayout } from "../components/layout/AppLayout";

const PAGE_SIZE = 5;

export const Homepage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

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

  // TODO (backend): falta el POST. `crearSuscripcion()` todavía no existe en
  // shared; mientras tanto el alta solo vive en el estado local y se pierde
  // al recargar.
  const handleAdd = (nueva: Omit<Suscripcion, "id">) => {
    const id = `local-${Date.now()}`;
    setSuscripciones((prev) => [...prev, { ...nueva, id }]);
    setIsAdding(false);
    setCurrentPage(Math.ceil((suscripciones.length + 1) / PAGE_SIZE));
  };

  // TODO (backend): falta el PATCH.
  const handleEditSubmit = (data: EditarSuscripcionFormData) => {
    setSuscripciones((prev) =>
      prev.map((s) =>
        s.id === data.id
          ? {
              ...s,
              nombre: data.nombre,
              monto: parseFloat(data.monto) || s.monto,
              moneda: data.moneda,
              frecuencia: data.frecuencia,
              categoria: data.categoria,
            }
          : s
      )
    );
    setEditando(null);
  };

  // debe coincidir con la duración de la animación en suscard.module.css
  const FADE_OUT_MS = 280;

  // TODO (backend): falta el DELETE. Cuando exista, conviene dispararlo en
  // paralelo al fade-out y revertir la animación si el servidor falla.
  const handleConfirmDelete = () => {
    if (!eliminando) return;
    const idToRemove = eliminando.id;

    setEliminando(null);
    setRemovingId(idToRemove);

    setTimeout(() => {
      setSuscripciones((prev) => prev.filter((s) => s.id !== idToRemove));
      setRemovingId(null);
    }, FADE_OUT_MS);
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
            <AddSubscriptionForm
              onAdd={handleAdd}
              onCancel={() => setIsAdding(false)}
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
            <EditarSuscripcionForm
              suscripcion={aFormulario(editando)}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditando(null)}
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
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Homepage;
