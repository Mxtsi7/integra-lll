import React, { useEffect, useMemo, useState } from "react";
import SubscriptionItem, { Subscription } from "../components/subscriptions/Subscriptionitem";
import AddSubscriptionForm from "../components/subscriptions/NuevaSuscripcionForm";
import Pagination from "../components/subscriptions/pagination";
import EditarSuscripcionForm, {
  EditarSuscripcionFormData,
} from "../components/subscriptions/EditarSuscripcionForm";
import EliminarSuscripcionDialog from "../components/subscriptions/EliminarSus";
import { formatearMonto } from '@ojoalgasto/shared';

// SOLO TESTEO — este import trae los datos mock desde un JSON local.
// Se eliminara todo lo relacionado a esto cuando ya este conectado al backend en el siguiente PR
import subscriptionsData from "../components/subscriptions/sustest.json"
 
import styles from "./Homepage.module.css";
import { AppLayout } from "../components/layout/AppLayout";
 
const PAGE_SIZE = 5;
 
const totalMensual = (subscriptions: Subscription[]) =>
  subscriptions.reduce((sum, s) => sum + s.price, 0);
 
const DashboardPage: React.FC = () => {
  const userName = "Usuario";
  const currentMonth = "Octubre, 2026";
 
  // Datos base vienen del JSON; el estado permite agregar nuevos sin
  // tocar el archivo. En una app real, este initial state vendría de
  // un fetch a una API que devuelva el mismo shape que el JSON.
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
 
  // qué suscripción se está editando (null = modal cerrado)
  const [editingSubscription, setEditingSubscription] =
    useState<Subscription | null>(null);
 
  //  qué suscripción se está por eliminar (null = diálogo cerrado)
  const [deletingSubscription, setDeletingSubscription] =
    useState<Subscription | null>(null);
  // id de la suscripción que está haciendo fade-out ahora mismo
  const [removingId, setRemovingId] = useState<string | null>(null);
 
  useEffect(() => {
    // carga los datos mock con un setTimeout para simular
    // la latencia de red y poder ver el estado de "isLoading" (skeletons).
    // Eliminar este bloque completo al conectar el backend real.
    const timer = setTimeout(() => {
      setSubscriptions(subscriptionsData as Subscription[]);
      setIsLoading(false);
    }, 900);
    return () => clearTimeout(timer);
 
    // reemplazar el bloque de arriba por algo así:
    //
    // const controller = new AbortController();
    //
    // fetch("/api/subscriptions/", { signal: controller.signal })
    //   .then((res) => {
    //     if (!res.ok) throw new Error("No se pudo cargar la lista de suscripciones");
    //     return res.json();
    //   })
    //   .then((data: Subscription[]) => {
    //     setSubscriptions(data);
    //   })
    //   .catch((err) => {
    //     if (err.name !== "AbortError") console.error(err);
    //     // TODO: mostrar un estado de error en la UI
    //   })
    //   .finally(() => setIsLoading(false));
    //
    // return () => controller.abort();
  }, []);
 
  const paginatedSubscriptions = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return subscriptions.slice(start, start + PAGE_SIZE);
  }, [subscriptions, currentPage]);
 
  // si al eliminar (o filtrar) la página actual queda fuera de
  // rango —ej. estabas en la página 2 y solo quedaba 1 item ahí—, vuelve
  // a la última página válida en vez de dejar la lista vacía sin forma
  // de navegar hacia atrás.
  useEffect(() => {
    if (isLoading) return;
    const totalPages = Math.max(1, Math.ceil(subscriptions.length / PAGE_SIZE));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [subscriptions, currentPage, isLoading]);
 
  const handleSubscriptionClick = (subscription: Subscription) => {
    // Aquí se podría navegar al detalle de la suscripción
    console.log("Suscripción seleccionada:", subscription.name);
  };
 
  const handleAddSubscription = (newSubscription: Omit<Subscription, "id">) => {
    // 🧪 SOLO TESTEO — genera un id "falso" en el cliente (nombre + timestamp).
    // Con Django, el id real lo devuelve el backend al crear el registro.
    const id = `${newSubscription.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    setSubscriptions((prev) => [...prev, { ...newSubscription, id }]);
    setIsAdding(false);
    // Llevar al usuario a la página donde queda el nuevo elemento
    const newTotal = subscriptions.length + 1;
    setCurrentPage(Math.ceil(newTotal / PAGE_SIZE));
 
    // reemplazar el bloque de arriba por algo así:
    //
    // fetch("/api/subscriptions/", {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify(newSubscription),
    // })
    //   .then((res) => {
    //     if (!res.ok) throw new Error("No se pudo crear la suscripción");
    //     return res.json();
    //   })
    //   .then((created: Subscription) => {
    //     setSubscriptions((prev) => [...prev, created]); // created.id viene del backend
    //     setIsAdding(false);
    //     const newTotal = subscriptions.length + 1;
    //     setCurrentPage(Math.ceil(newTotal / PAGE_SIZE));
    //   })
    //   .catch((err) => {
    //     console.error(err);
    //     // TODO: mostrar error en el formulario
    //   });
  };
 
  // abre el modal con la suscripción seleccionada
  const handleEditSubscription = (subscription: Subscription) => {
    setEditingSubscription(subscription);
  };
 
  //  aplica los cambios del formulario a la lista y cierra el modal
  const handleEditSubmit = (data: EditarSuscripcionFormData) => {
    //TEST — actualiza el arreglo local con .map(), sin tocar backend.
    setSubscriptions((prev) =>
      prev.map((s) =>
        s.id === data.id
          ? {
              ...s,
              name: data.nombre,
              price: parseFloat(data.monto) || s.price,
              cycle: (data.cicloDeCobro as Subscription["cycle"]) ?? s.cycle,
            }
          : s
      )
    );
    setEditingSubscription(null);
 
    //reemplazar el bloque de arriba por algo así:
    //
    // fetch(`/api/subscriptions/${data.id}/`, {
    //   method: "PATCH",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify(data),
    // })
    //   .then((res) => {
    //     if (!res.ok) throw new Error("No se pudo actualizar la suscripción");
    //     return res.json();
    //   })
    //   .then((updated: Subscription) => {
    //     setSubscriptions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    //     setEditingSubscription(null);
    //   })
    //   .catch((err) => {
    //     console.error(err);
    //     // TODO: mostrar error en el formulario, no cerrar el modal
    //   });
  };
 
  // abre el diálogo de confirmación
  const handleDeleteSubscription = (subscription: Subscription) => {
    setDeletingSubscription(subscription);
  };
 
  // 👇 nuevo: al confirmar, dispara el fade-out y luego quita el item del estado
  const FADE_OUT_MS = 280; // debe coincidir con la duración de la animación en suscard.module.css
 
  const handleConfirmDelete = () => {
    if (!deletingSubscription) return;
    const idToRemove = deletingSubscription.id;
 
    setDeletingSubscription(null); // cierra el diálogo
    setRemovingId(idToRemove); // dispara la animación en esa card
 
    // 🧪 SOLO TESTEO — espera a que termine el fade-out y recién ahí
    // filtra el item del arreglo local. No hay backend involucrado.
    setTimeout(() => {
      setSubscriptions((prev) => prev.filter((s) => s.id !== idToRemove));
      setRemovingId(null);
    }, FADE_OUT_MS);
 
    // conexion con backend, se dispara el DELETE en paralelo al fade-out
    // (no hace falta esperar la respuesta del server para animar), y solo
    // saca el item del estado si el backend confirma que se borró. Si falla,
    // se revierte la animación (quita removingId sin filtrar el arreglo).
    //
    // fetch(`/api/subscriptions/${idToRemove}/`, { method: "DELETE" })
    //   .then((res) => {
    //     if (!res.ok) throw new Error("No se pudo eliminar la suscripción");
    //   })
    //   .catch((err) => {
    //     console.error(err);
    //     setRemovingId(null); // cancela el fade-out, el item se queda
    //     // TODO: mostrar un toast/error indicando que no se pudo eliminar
    //   });
    //
    // setTimeout(() => {
    //   setSubscriptions((prev) => prev.filter((s) => s.id !== idToRemove));
    //   setRemovingId(null);
    // }, FADE_OUT_MS);
  };
 
  return (
    <AppLayout
      headerTitulo="Inicio"
      headerSubtitulo=" Aquí tienes el estado de tus finanzas y cobros hoy."
      headerEtiquetaFecha="Octubre, 2026"
    >
      <div className={styles.dashboardPage}>
        <section className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Total mensual</span>
          <p className={styles.summaryValue}>
            {isLoading ? "···" : formatearMonto(totalMensual(subscriptions))}{" "}
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
 
          {isAdding && (
            <div
              className={styles.formOverlay}
              onClick={(e) => {
                if (e.target === e.currentTarget) setIsAdding(false);
              }}
            >
              <AddSubscriptionForm
                onAdd={handleAddSubscription}
                onCancel={() => setIsAdding(false)}
              />
            </div>
          )}
 
          <ul className={styles.list}>
            {isLoading
              ? // subscriptionsData[0] es solo para tener ALGO
                // que mostrar en el skeleton antes de cargar. SubscriptionItem
                // con isLoading ignora estos datos igual, pero si se elimina
                // sustest.json, reemplazar por un objeto vacío/dummy cualquiera.
                Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <SubscriptionItem
                    key={`placeholder-${i}`}
                    subscription={subscriptionsData[0] as Subscription}
                    isLoading
                  />
                ))
              : paginatedSubscriptions.map((subscription) => (
                  <SubscriptionItem
                    key={subscription.id}
                    subscription={subscription}
                    onClick={handleSubscriptionClick}
                    onEdit={handleEditSubscription}
                    onDelete={handleDeleteSubscription} // 👈 nuevo
                    isRemoving={subscription.id === removingId} // 👈 nuevo
                  />
                ))}
          </ul>
 
          {!isLoading && (
            <Pagination
              currentPage={currentPage}
              totalItems={subscriptions.length}
              pageSize={PAGE_SIZE}
              onPageChange={setCurrentPage}
            />
          )}
        </section>
 
        {/* Overlay del formulario de edición */}
        {editingSubscription && (
          <div
            className={styles.formOverlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditingSubscription(null);
            }}
          >
            <EditarSuscripcionForm
              suscripcion={{
                id: editingSubscription.id,
                nombre: editingSubscription.name,
                monto: String(editingSubscription.price),
                moneda: "CLP",
                cicloDeCobro: editingSubscription.cycle,
                categoria: "Entretenimiento",
                notas: "",
              }}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingSubscription(null)}
            />
          </div>
        )}
 
        {/* Overlay del diálogo de confirmación de eliminar */}
        {deletingSubscription && (
          <div
            className={styles.formOverlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) setDeletingSubscription(null);
            }}
          >
            <EliminarSuscripcionDialog
              nombreSuscripcion={deletingSubscription.name}
              onConfirm={handleConfirmDelete}
              onCancel={() => setDeletingSubscription(null)}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
};
 
export default DashboardPage;
