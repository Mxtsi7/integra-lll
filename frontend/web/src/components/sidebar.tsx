import React from "react";

const styles: { [key: string]: React.CSSProperties } = {
  sidebar: {
    backgroundColor: "#1e2a4a",
    width: "260px",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    padding: "24px 16px",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "0 8px",
    marginBottom: "32px",
  },
  iconPlaceholderBrand: {
    width: "22px",
    height: "22px",
    borderRadius: "4px",
    backgroundColor: "#3b82f6",
    flexShrink: 0,
  },
  brandText: {
    color: "#e2e8f0",
    fontSize: "18px",
    fontWeight: "bold",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "12px 14px",
    borderRadius: "8px",
    color: "#94a3b8",
    fontSize: "14px",
    position: "relative",
    border: "none",
    background: "none",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    fontFamily: "inherit",
  },
  navItemActive: {
    backgroundColor: "#2d3d63",
    color: "#f1f5f9",
    fontWeight: "bold",
  },
  activeBar: {
    position: "absolute",
    left: "-16px",
    top: "6px",
    bottom: "6px",
    width: "3px",
    backgroundColor: "#3b82f6",
    borderRadius: "2px",
  },
  iconPlaceholder: {
    width: "18px",
    height: "18px",
    borderRadius: "4px",
    backgroundColor: "#475569",
    flexShrink: 0,
  },
  iconPlaceholderActive: {
    backgroundColor: "#60a5fa",
  },
  activeDot: {
    marginLeft: "auto",
    width: "4px",
    height: "16px",
    borderRadius: "2px",
    backgroundColor: "#60a5fa",
  },
  spacer: {
    flex: 1,
  },
  userCard: {
    backgroundColor: "#141d38",
    borderRadius: "10px",
    padding: "14px 16px",
  },
  userName: {
    color: "#e2e8f0",
    fontSize: "14px",
    fontWeight: "bold",
    marginBottom: "4px",
  },
  userPlan: {
    color: "#5b6c92",
    fontSize: "13px",
  },
};

export interface NavItem {
  key: string;
  label: string;
}

export interface SidebarProps {
  /** Key del item activo. Lo controla el componente padre (ej: App.tsx) */
  selected: string;
  /** Se llama con la key del item clickeado */
  onSelect: (key: string) => void;
  brandName?: string;
  items?: NavItem[];
  userName?: string;
  userPlan?: string;
}

export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { key: "panel", label: "Panel" },
  { key: "calendario", label: "Calendario de pagos" },
  { key: "recomendaciones", label: "Recomendaciones" },
  { key: "cuentas", label: "Cuentas conectadas" },
  { key: "informes", label: "Informes" },
  { key: "configuracion", label: "Configuración" },
];

export function Sidebar({
  selected,
  onSelect,
  brandName = "Ojo al Gasto",
  items = DEFAULT_NAV_ITEMS,
  userName = "Usuario",
  userPlan = "Plan Gratuito",
}: SidebarProps) {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>
        {/* Placeholder del icono (ej: un ojo) */}
        <div style={styles.iconPlaceholderBrand} />
        <span style={styles.brandText}>{brandName}</span>
      </div>

      <nav style={styles.nav}>
        {items.map((item) => {
          const isActive = item.key === selected;
          const itemStyle = isActive
            ? { ...styles.navItem, ...styles.navItemActive }
            : styles.navItem;
          const iconStyle = isActive
            ? { ...styles.iconPlaceholder, ...styles.iconPlaceholderActive }
            : styles.iconPlaceholder;

          return (
            <button
              key={item.key}
              type="button"
              style={itemStyle}
              onClick={() => onSelect(item.key)}
            >
              {isActive && <div style={styles.activeBar} />}
              {/* Placeholder del icono del item */}
              <div style={iconStyle} />
              <span>{item.label}</span>
              {isActive && <div style={styles.activeDot} />}
            </button>
          );
        })}
      </nav>

      <div style={styles.spacer} />

      <div style={styles.userCard}>
        <div style={styles.userName}>{userName}</div>
        <div style={styles.userPlan}>{userPlan}</div>
      </div>
    </aside>
  );
}

export default Sidebar;