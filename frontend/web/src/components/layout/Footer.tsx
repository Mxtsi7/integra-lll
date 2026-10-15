import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <p className={styles.texto}>Ojo al Gasto, 2026</p>
      <p className={styles.texto}>Proyecto Integra III, Universidad Católica de Temuco</p>
    </footer>
  );
}
