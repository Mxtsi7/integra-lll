import React from "react";

const styles: { [key: string]: React.CSSProperties } = {
  footer: {
    backgroundColor: "#1e2a4a",
    borderTop: "1px solid #2a3a63",
    padding: "24px 32px",
    fontFamily: "'Courier New', Courier, monospace",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: "150px",
    width: "100%",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  iconPlaceholder: {
    width: "24px",
    height: "24px",
    borderRadius: "4px",
    backgroundColor: "#3b82f6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#1e2a4a",
    fontSize: "12px",
    fontWeight: "bold",
    flexShrink: 0,
  },
  brandText: {
    color: "#e2e8f0",
    fontSize: "20px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
  },
  nav: {
    display: "flex",
    gap: "28px",
    flexWrap: "wrap",
  },
  navLink: {
    color: "#cbd5e1",
    textDecoration: "none",
    fontSize: "14px",
    fontWeight: "bold",
  },
  copyright: {
    color: "#4b5a80",
    fontSize: "13px",
    marginTop: "24px",
  },
};

const NAV_LINKS: string[] = ["Panel", "Calendario", "Cuentas", "Informes", "Configuración"];

interface FooterProps {
  brandName?: string;
  year?: number;
  companyName?: string;
  links?: string[];
}

export default function Footer({
  brandName = "Ojo al Gasto",
  year = new Date().getFullYear(),
  companyName = "Ojo al Gasto S.L.",
  links = NAV_LINKS,
}: FooterProps) {
  return (
    <footer style={styles.footer}>
      <div style={styles.topRow}>
        <div style={styles.brand}>
          {/* Placeholder del icono (ej: un ojo) */}
          <div style={styles.iconPlaceholder}>ico</div>
          <span style={styles.brandText}>{brandName}</span>
        </div>

        <nav style={styles.nav}>
          {links.map((link) => (
            <a key={link} href="#" style={styles.navLink}>
              {link}
            </a>
          ))}
        </nav>
      </div>

      <div style={styles.copyright}>
        © {year} {companyName}
      </div>
    </footer>
  );
}