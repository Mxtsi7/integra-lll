import React, { useEffect, useState } from "react";
import SubscriptionItem, {
  Subscription,
} from "../components/Cards/Subcriptionitem";
import styles from "./Homepage.module.css";
import { AppLayout } from '../components/layout/AppLayout';

const SUBSCRIPTIONS: Subscription[] = [
  {
    id: "netflix",
    name: "Netflix",
    initial: "N",
    color: "#e50914",
    cycle: "Mensual",
    price: 17.99,
    nextChargeDate: "02 Nov",
    hasAlert: true,
  },
  {
    id: "spotify",
    name: "Spotify",
    initial: "S",
    color: "#1db954",
    cycle: "Mensual",
    price: 10.99,
    nextChargeDate: "05 Nov",
    hasAlert: true,
  },
  {
    id: "amazon-prime",
    name: "Amazon Prime",
    initial: "A",
    color: "#f5a623",
    cycle: "Anual",
    price: 4.99,
    nextChargeDate: "12 Nov",
  },
  {
    id: "disney-plus",
    name: "Disney+",
    initial: "D",
    color: "#6c3ce9",
    cycle: "Mensual",
    price: 11.9,
    nextChargeDate: "18 Nov",
  },
];

const formatTotal = (subscriptions: Subscription[]) => {
  const total = subscriptions.reduce((sum, s) => sum + s.price, 0);
  return total.toFixed(2).replace(".", ",");
};

const DashboardPage: React.FC = () => {
  const userName = "Usuario";
  const currentMonth = "Octubre, 2026";

  // Ejemplo de uso real del placeholder: mientras "llegan" los datos
  // (fetch a una API, por ejemplo), se muestran skeletons en vez de
  // contenido vacío o un spinner genérico.
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSubscriptions(SUBSCRIPTIONS);
      setIsLoading(false);
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  const handleSubscriptionClick = (subscription: Subscription) => {
    // Aquí se podría navegar al detalle de la suscripción
    console.log("Suscripción seleccionada:", subscription.name);
  };

  return (<AppLayout headerTitulo="Inicio" headerSubtitulo="Resumen de los cambios actuales.">
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
            <svg
              className={styles.dateIcon}
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="4"
                width="14"
                height="13"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M3 8h14M7 2.5v3M13 2.5v3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
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
          <button type="button" className={styles.addButton}>
            + Agregar suscripción
          </button>
        </div>

        <ul className={styles.list}>
          {isLoading
            ? // 4 placeholders mientras se cargan los datos reales
              Array.from({ length: 4 }).map((_, i) => (
                <SubscriptionItem
                  key={`placeholder-${i}`}
                  subscription={SUBSCRIPTIONS[0]}
                  isLoading
                />
              ))
            : subscriptions.map((subscription) => (
                <SubscriptionItem
                  key={subscription.id}
                  subscription={subscription}
                  onClick={handleSubscriptionClick}
                />
              ))}
        </ul>
      </section>
    </div>
  </AppLayout>
  );
};

export default DashboardPage;