import React from "react";

const NAV_LINKS = ["Panel", "Calendario", "Cuentas", "Informes", "Configuración"];

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
    <footer className="footer">
      <div className="footer-top-row">
        <div className="footer-brand">
          {/* Placeholder del icono (ej: un ojo) */}
          <div className="footer-icon-placeholder">ico</div>
          <span className="footer-brand-text">{brandName}</span>
        </div>

        <nav className="footer-nav">
          {links.map((link) => (
            <a key={link} href="#" className="footer-nav-link">
              {link}
            </a>
          ))}
        </nav>
      </div>

      <div className="footer-copyright">
        © {year} {companyName}
      </div>
    </footer>
  );
}
