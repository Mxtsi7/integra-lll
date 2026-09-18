import styles from './Footer.module.css';

const ENLACES = ['Inicio', 'Panel', 'Calendario', 'Cuentas', 'Informes', 'Configuración'];

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div>
        <div className={styles.logo}>
          <span aria-hidden="true">👁</span> Ojo al Gasto
        </div>
        <p className={styles.copyright}>© 2026 Ojo al Gasto</p>
      </div>
      <nav className={styles.enlaces}>
        {ENLACES.map((enlace) => (
          <span key={enlace}>{enlace}</span>
        ))}
      </nav>
    </footer>
  );
}
