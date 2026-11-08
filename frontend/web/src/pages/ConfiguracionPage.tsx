import { Database, Link2, Moon, Palette, Sun, Wallet } from 'lucide-react';
import { PreferenciasAvisos } from '../components/Configuracion/PreferenciasAvisos';
import { AppLayout } from '../components/layout/AppLayout';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import { Fila, Seccion } from '../components/ui/Seccion';
import { useTema } from '../hooks/useTema';
import styles from './ConfiguracionPage.module.css';
import { EliminarCuenta } from '../components/Perfil/EliminarCuenta';

export function ConfiguracionPage() {
  // Apariencia (persistente y aplicada a toda la app)
  const [tema, setTema] = useTema();

  return (
    <AppLayout headerTitulo="Ajustes" headerSubtitulo="Avisos, apariencia y tus datos.">
      <div className={styles.grid}>
        <div className={styles.columna}>
          {/* CH-30: los avisos se leen y se guardan en FE-21. Antes eran
              estados locales que se perdían al recargar. */}
          <PreferenciasAvisos />

          <Seccion titulo="Apariencia" icono={<Palette size={19} aria-hidden="true" />} tinte="morado">
            <Fila etiqueta="Tema" detalle="Se guarda en este navegador.">
              <div className={styles.selectorTema} role="group" aria-label="Tema de la aplicación">
                <button
                  type="button"
                  aria-pressed={tema === 'oscuro'}
                  className={tema === 'oscuro' ? `${styles.temaBoton} ${styles.temaBotonActivo}` : styles.temaBoton}
                  onClick={() => setTema('oscuro')}
                >
                  <Moon size={15} aria-hidden="true" />
                  Oscuro
                </button>
                <button
                  type="button"
                  aria-pressed={tema === 'claro'}
                  className={tema === 'claro' ? `${styles.temaBoton} ${styles.temaBotonActivo}` : styles.temaBoton}
                  onClick={() => setTema('claro')}
                >
                  <Sun size={15} aria-hidden="true" />
                  Claro
                </button>
              </div>
            </Fila>
          </Seccion>
        </div>

        <div className={styles.columna}>
          {/* CH-23: las cuentas viven en una sola página (/cuentas). Antes acá
              había estados escritos a mano ("No conectado") que no salían
              de ningún dato real. */}
          <Seccion
            titulo="Cuentas conectadas"
            descripcion="Conecta tu correo y los cobros nuevos se registran solos."
            icono={<Link2 size={19} aria-hidden="true" />}
            tinte="turquesa"
          >
            <div className={styles.pieSeccion}>
              <BotonEnlace to="/cuentas" variante="secundario">
                Ver cuentas conectadas
              </BotonEnlace>
            </div>
          </Seccion>

          <Seccion titulo="Tus datos" icono={<Database size={19} aria-hidden="true" />} tinte="azul">
            {/* TODO: habilitar cuando existan los endpoints correspondientes */}
            <Fila etiqueta="Exportar mis datos">
              <Boton variante="sutil" tamano="s" disabled title="Próximamente">
                Descargar
              </Boton>
            </Fila>
            <Fila etiqueta="Historial de accesos">
              <Boton variante="sutil" tamano="s" disabled title="Próximamente">
                Ver
              </Boton>
            </Fila>
            <Fila etiqueta="Eliminar cuenta" detalle="Borra tu cuenta y tus suscripciones.">
              <EliminarCuenta className={styles.peligro} />
            </Fila>
          </Seccion>

          <Seccion titulo="Plan" icono={<Wallet size={19} aria-hidden="true" />} tinte="verde">
            <Fila etiqueta="Plan Gratuito" detalle="Alertas de cobro y de prueba gratis incluidas." />
            <div className={styles.pieSeccion}>
              {/* TODO: habilitar cuando exista el flujo de pago */}
              <Boton variante="secundario" disabled title="Próximamente">
                Mejorar a Premium
              </Boton>
            </div>
          </Seccion>
        </div>
      </div>
    </AppLayout>
  );
}
