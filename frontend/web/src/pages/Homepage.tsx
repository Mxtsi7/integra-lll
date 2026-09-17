import React from "react";

export interface Transaction {
  id: string;
  name: string;
  date: string;
  category: string;
  amount: string;
}

export interface Subscription {
  id: string;
  name: string;
  initial: string;
  nextCharge: string;
  price: string;
  alert: boolean;
}

export interface Stat {
  label: string;
  value: string;
  footnote: string;
  highlight?: boolean;
}

interface HomepageProps {
  userName?: string;
  currentMonth?: string;
  stats?: Stat[];
  transactions?: Transaction[];
  subscriptions?: Subscription[];
}

// --- Datos de ejemplo (placeholders) — reemplazar con datos de la API ---
const DEFAULT_STATS: Stat[] = [
  {
    label: "TOTAL GASTADO ESTE MES",
    value: "482,90 €",
    footnote: "Un 12% menos que el mes pasado",
  },
  {
    label: "PRÓXIMOS COBROS (7 DÍAS)",
    value: "89,20 €",
    footnote: "3 suscripciones pendientes de cobro",
    highlight: true,
  },
  {
    label: "AHORRO ESTIMADO",
    value: "120,00 €",
    footnote: "Vas camino a cumplir tu meta mensual",
  },
];

const DEFAULT_TRANSACTIONS: Transaction[] = [
  {
    id: "t1",
    name: "Suscripción Netflix",
    date: "Hoy, 10:45 AM",
    category: "Entretenimiento",
    amount: "-17,99 €",
  },
  {
    id: "t2",
    name: "Cafetería La Linda",
    date: "Ayer, 04:30 PM",
    category: "Alimentación",
    amount: "-3,50 €",
  },
  {
    id: "t3",
    name: "Spotify Premium",
    date: "24 Octubre",
    category: "Entretenimiento",
    amount: "-10,99 €",
  },
];

const DEFAULT_SUBSCRIPTIONS: Subscription[] = [
  {
    id: "s1",
    name: "Netflix",
    initial: "N",
    nextCharge: "Próximo cobro: 02 Nov",
    price: "17,99 €/mes",
    alert: true,
  },
  {
    id: "s2",
    name: "Spotify",
    initial: "S",
    nextCharge: "Próximo cobro: 05 Nov",
    price: "10,99 €/mes",
    alert: true,
  },
  {
    id: "s3",
    name: "Amazon Prime",
    initial: "A",
    nextCharge: "Próximo cobro: 12 Nov",
    price: "4,99 €/mes",
    alert: false,
  },
];
// -------------------------------------------------------------------

export default function Homepage({
  userName = "Usuario",
  currentMonth = "Octubre, 2026",
  stats = DEFAULT_STATS,
  transactions = DEFAULT_TRANSACTIONS,
  subscriptions = DEFAULT_SUBSCRIPTIONS,
}: HomepageProps) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="greeting">¡Hola de nuevo, {userName}!</h1>
          <div className="subtitle">
            Aquí tienes el estado de tus finanzas y cobros hoy.
          </div>
        </div>

        <div className="header-right">
          <div className="date-badge">
            {/* Placeholder del icono de calendario */}
            <div className="date-icon-placeholder" />
            <span>{currentMonth}</span>
          </div>
          {/* Placeholder del avatar */}
          <div className="avatar-placeholder" />
        </div>
      </header>

      <section className="stats-row">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`stat-card${stat.highlight ? " highlight" : ""}`}
          >
            <div className="stat-card-top">
              <span className="stat-label">{stat.label}</span>
              {/* Placeholder del icono de la métrica */}
              <div className={`stat-icon-placeholder${stat.highlight ? " dark" : ""}`} />
            </div>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-footnote">{stat.footnote}</div>
          </div>
        ))}
      </section>

      <section className="bottom-row">
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <span className="panel-title-bar" />
              Transacciones Recientes
            </h2>
            <a href="#" className="panel-link">
              Ver todas →
            </a>
          </div>

          <div>
            {transactions.map((tx) => (
              <div key={tx.id} className="transaction-row">
                {/* Placeholder del icono de la transacción */}
                <div className="transaction-icon-placeholder" />
                <div className="transaction-info">
                  <div className="transaction-name">{tx.name}</div>
                  <div className="transaction-meta">
                    {tx.date} · {tx.category}
                  </div>
                </div>
                <div className="transaction-amount">{tx.amount}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <span className="panel-title-bar" />
              Suscripciones Activas
            </h2>
            <span className="badge">{subscriptions.length} activas</span>
          </div>

          <div>
            {subscriptions.map((sub) => (
              <div key={sub.id} className="subscription-row">
                <div className="subscription-avatar">{sub.initial}</div>
                <div className="subscription-info">
                  <div className="subscription-name">{sub.name}</div>
                  <div className="subscription-meta">{sub.nextCharge}</div>
                </div>
                <div className="subscription-right">
                  <div className="subscription-price">{sub.price}</div>
                  <span className={`tag ${sub.alert ? "tag-alert" : "tag-neutral"}`}>
                    {sub.alert ? "⚠ ALERTA" : "SIN ALARMA"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
