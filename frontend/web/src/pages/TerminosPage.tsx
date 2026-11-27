import { Link } from 'react-router-dom';
import { Marca } from '../components/layout/Marca';
import { FECHA_TERMINOS, SECCIONES_TERMINOS, VERSION_TERMINOS } from '../contenido/terminos';
import styles from './TerminosPage.module.css';

/**
 * Términos y condiciones (S3-AN-08). Es pública (sin guarda de sesión) porque el registro la
 * enlaza antes de que exista la cuenta. El texto vive en contenido/terminos.ts.
 */
export function TerminosPage() {
  return (
    <div className={styles.pantalla}>
      <div className={styles.columna}>
        <div className={styles.marca}>
          <Marca a="/" tamano="l" />
        </div>
        <main className={`tile ${styles.tarjeta}`}>
          <h1 className={styles.titulo}>Términos y condiciones</h1>
          <p className={styles.version}>
            Versión {VERSION_TERMINOS} · Última actualización: {FECHA_TERMINOS}
          </p>
          {SECCIONES_TERMINOS.map((seccion) => (
            <section key={seccion.titulo} className={styles.seccion}>
              <h2 className={styles.subtitulo}>{seccion.titulo}</h2>
              {seccion.parrafos.map((parrafo) => (
                <p key={parrafo}>{parrafo}</p>
              ))}
            </section>
          ))}
          <p className={styles.pie}>
            <Link to="/">Volver a Ojo al Gasto</Link>
          </p>
        </main>
      </div>
    </div>
  );
}

export default TerminosPage;
