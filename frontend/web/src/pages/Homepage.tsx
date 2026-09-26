import React, { useEffect, useMemo, useState } from "react";
import SubscriptionItem, { Subscription } from "../components/subcriptions/Subcriptionitem";
import AddSubscriptionForm from "../components/subcriptions/NuevaSuscripcionForm";
import Pagination from "../components//subcriptions/pagination";

//eliminar esta linea a futuro
import subscriptionsData from "../components/subcriptions/sustest.json"

import styles from "./Homepage.module.css";
import { AppLayout  } from "../components/layout/AppLayout";
 
const PAGE_SIZE = 5;
 
const formatTotal = (subscriptions: Subscription[]) => {
  const total = subscriptions.reduce((sum, s) => sum + s.price, 0);
  return total.toFixed(2).replace(".", ",");
};
 
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
 
  useEffect(() => {
    const timer = setTimeout(() => {
      setSubscriptions(subscriptionsData as Subscription[]);
      setIsLoading(false);
    }, 900);
    return () => clearTimeout(timer);
  }, []);
 
  const paginatedSubscriptions = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return subscriptions.slice(start, start + PAGE_SIZE);
  }, [subscriptions, currentPage]);
 
  const handleSubscriptionClick = (subscription: Subscription) => {
    // Aquí se podría navegar al detalle de la suscripción
    console.log("Suscripción seleccionada:", subscription.name);
  };
 
  const handleAddSubscription = (newSubscription: Omit<Subscription, "id">) => {
    const id = `${newSubscription.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    setSubscriptions((prev) => [...prev, { ...newSubscription, id }]);
    setIsAdding(false);
    // Llevar al usuario a la página donde queda el nuevo elemento
    const newTotal = subscriptions.length + 1;
    setCurrentPage(Math.ceil(newTotal / PAGE_SIZE));
  };
 
  return (
    <AppLayout>
    <div className={styles.dashboardPage}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>¡Hola de nuevo, {userName}!</h1>
          <p className={styles.subtitle}>
            Aquí tienes el estado de tus finanzas y cobros hoy.
          </p>
        </div>
 
        <div className={styles.headerActions}>
          <button type="button" className={styles.datePill}>
            <svg className={styles.dateIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {currentMonth}
          </button>
 
          <div className={styles.avatar} aria-hidden="true" />
        </div>
      </header>
 
      <section className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Total mensual</span>
        <p className={styles.summaryValue}>
          {isLoading ? "···" : formatTotal(subscriptions)} €{" "}
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
          <AddSubscriptionForm
            onAdd={handleAddSubscription}
            onCancel={() => setIsAdding(false)}
          />
        )}
 
        <ul className={styles.list}>
          {isLoading
            ? // Placeholders mientras se cargan los datos reales
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
    </div>
    </AppLayout>
  );
};
 
export default DashboardPage;
 
