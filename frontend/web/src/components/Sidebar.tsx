import React from "react";

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
  userName = "Carlos Díaz",
  userPlan = "Plan Gratuito",
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        {/* Placeholder del icono (ej: un ojo) */}
        <div className="icon-placeholder icon-placeholder--brand" />
        <span className="sidebar-brand-text">{brandName}</span>
      </div>

      <nav className="sidebar-nav">
        {items.map((item) => {
          const isActive = item.key === selected;
          return (
            <button
              key={item.key}
              type="button"
              className={`sidebar-nav-item${isActive ? " active" : ""}`}
              onClick={() => onSelect(item.key)}
            >
              {isActive && <div className="sidebar-active-bar" />}
              {/* Placeholder del icono del item */}
              <div className={`icon-placeholder${isActive ? " icon-placeholder--active" : ""}`} />
              <span>{item.label}</span>
              {isActive && <div className="sidebar-active-dot" />}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-user-card">
        <div className="sidebar-user-name">{userName}</div>
        <div className="sidebar-user-plan">{userPlan}</div>
      </div>
    </aside>
  );
}

export default Sidebar;
