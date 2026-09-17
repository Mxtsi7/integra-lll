import React from "react";

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    backgroundColor: "#eef1f8",
    flex: 1,
    width: "100%",
    height: "100%",
    padding: "40px 48px",
    fontFamily: "'Courier New', Courier, monospace",
    boxSizing: "border-box",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "32px",
    flexWrap: "wrap",
    gap: "16px",
  },
  greeting: {
    color: "#1e2a4a",
    fontSize: "32px",
    fontWeight: "bold",
    margin: 0,
  },
  subtitle: {
    color: "#7b88a8",
    fontSize: "15px",
    marginTop: "6px",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  dateBadge: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    backgroundColor: "#ffffff",
    border: "1px solid #dbe1ef",
    borderRadius: "10px",
    padding: "10px 18px",
    color: "#1e2a4a",
    fontWeight: "bold",
    fontSize: "15px",
  },
  dateIconPlaceholder: {
    width: "18px",
    height: "18px",
    borderRadius: "4px",
    backgroundColor: "#1e2a4a",
    flexShrink: 0,
  },
  avatarPlaceholder: {
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    backgroundColor: "#1e2a4a",
    flexShrink: 0,
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "20px",
    marginBottom: "24px",
  },
  statCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #dbe1ef",
    borderRadius: "14px",
    padding: "24px",
    boxSizing: "border-box",
  },
  statCardHighlight: {
    border: "2px solid #1e2a4a",
  },
  statCardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "24px",
  },
  statLabel: {
    color: "#8a95b3",
    fontSize: "12px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
  },
  statIconPlaceholder: {
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    backgroundColor: "#eef1f8",
    flexShrink: 0,
  },
  statIconPlaceholderDark: {
    backgroundColor: "#1e2a4a",
  },
  statValue: {
    color: "#1e2a4a",
    fontSize: "34px",
    fontWeight: "bold",
    marginBottom: "8px",
  },
  statFootnote: {
    color: "#8a95b3",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  bottomRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr",
    gap: "20px",
  },
  panel: {
    backgroundColor: "#ffffff",
    border: "1px solid #dbe1ef",
    borderRadius: "14px",
    padding: "24px",
    boxSizing: "border-box",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  panelTitle: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    color: "#1e2a4a",
    fontSize: "18px",
    fontWeight: "bold",
    margin: 0,
  },
  panelTitleBar: {
    width: "4px",
    height: "18px",
    backgroundColor: "#1e2a4a",
    borderRadius: "2px",
  },
  panelLink: {
    color: "#3b82f6",
    fontSize: "14px",
    fontWeight: "bold",
    textDecoration: "none",
  },
  badge: {
    backgroundColor: "#1e2a4a",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: "bold",
    padding: "6px 12px",
    borderRadius: "8px",
  },
  transactionRow: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "14px 0",
    borderBottom: "1px solid #eef1f8",
  },
  transactionIconPlaceholder: {
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    backgroundColor: "#eef1f8",
    border: "1px solid #dbe1ef",
    flexShrink: 0,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionName: {
    color: "#1e2a4a",
    fontSize: "15px",
    fontWeight: "bold",
    marginBottom: "2px",
  },
  transactionMeta: {
    color: "#8a95b3",
    fontSize: "13px",
  },
  transactionAmount: {
    color: "#1e2a4a",
    fontSize: "16px",
    fontWeight: "bold",
  },
  subscriptionRow: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "14px",
    border: "1px solid #dbe1ef",
    borderRadius: "12px",
    marginBottom: "12px",
  },
  subscriptionAvatar: {
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    backgroundColor: "#1e2a4a",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: "16px",
    flexShrink: 0,
  },
  subscriptionInfo: {
    flex: 1,
  },
  subscriptionName: {
    color: "#1e2a4a",
    fontSize: "15px",
    fontWeight: "bold",
    marginBottom: "2px",
  },
  subscriptionMeta: {
    color: "#8a95b3",
    fontSize: "13px",
  },
  subscriptionRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "6px",
  },
  subscriptionPrice: {
    color: "#1e2a4a",
    fontSize: "15px",
    fontWeight: "bold",
  },
  tagAlert: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    backgroundColor: "#1e2a4a",
    color: "#facc15",
    fontSize: "11px",
    fontWeight: "bold",
    padding: "4px 8px",
    borderRadius: "6px",
  },
  tagNeutral: {
    backgroundColor: "#c7cede",
    color: "#4b5a80",
    fontSize: "11px",
    fontWeight: "bold",
    padding: "4px 8px",
    borderRadius: "6px",
  },
};

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
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.greeting}>¡Hola de nuevo, {userName}!</h1>
          <div style={styles.subtitle}>
            Aquí tienes el estado de tus finanzas y cobros hoy.
          </div>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.dateBadge}>
            {/* Placeholder del icono de calendario */}
            <div style={styles.dateIconPlaceholder} />
            <span>{currentMonth}</span>
          </div>
          {/* Placeholder del avatar */}
          <div style={styles.avatarPlaceholder} />
        </div>
      </header>

      <section style={styles.statsRow}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            style={
              stat.highlight
                ? { ...styles.statCard, ...styles.statCardHighlight }
                : styles.statCard
            }
          >
            <div style={styles.statCardTop}>
              <span style={styles.statLabel}>{stat.label}</span>
              {/* Placeholder del icono de la métrica */}
              <div
                style={
                  stat.highlight
                    ? { ...styles.statIconPlaceholder, ...styles.statIconPlaceholderDark }
                    : styles.statIconPlaceholder
                }
              />
            </div>
            <div style={styles.statValue}>{stat.value}</div>
            <div style={styles.statFootnote}>{stat.footnote}</div>
          </div>
        ))}
      </section>

      <section style={styles.bottomRow}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>
              <span style={styles.panelTitleBar} />
              Transacciones Recientes
            </h2>
            <a href="#" style={styles.panelLink}>
              Ver todas →
            </a>
          </div>

          <div>
            {transactions.map((tx) => (
              <div key={tx.id} style={styles.transactionRow}>
                {/* Placeholder del icono de la transacción */}
                <div style={styles.transactionIconPlaceholder} />
                <div style={styles.transactionInfo}>
                  <div style={styles.transactionName}>{tx.name}</div>
                  <div style={styles.transactionMeta}>
                    {tx.date} · {tx.category}
                  </div>
                </div>
                <div style={styles.transactionAmount}>{tx.amount}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>
              <span style={styles.panelTitleBar} />
              Suscripciones Activas
            </h2>
            <span style={styles.badge}>{subscriptions.length} activas</span>
          </div>

          <div>
            {subscriptions.map((sub) => (
              <div key={sub.id} style={styles.subscriptionRow}>
                <div style={styles.subscriptionAvatar}>{sub.initial}</div>
                <div style={styles.subscriptionInfo}>
                  <div style={styles.subscriptionName}>{sub.name}</div>
                  <div style={styles.subscriptionMeta}>{sub.nextCharge}</div>
                </div>
                <div style={styles.subscriptionRight}>
                  <div style={styles.subscriptionPrice}>{sub.price}</div>
                  <span style={sub.alert ? styles.tagAlert : styles.tagNeutral}>
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