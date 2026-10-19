import { useState } from 'react';
import { Bell, Database, Link2, Moon, Palette, Sun, Wallet } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { Boton } from '../components/ui/Boton';
import { Insignia } from '../components/ui/Insignia';
import { Fila, Seccion } from '../components/ui/Seccion';
import { useTema } from '../hooks/useTema';
import styles from './ConfiguracionPage.module.css';

// TODO: cuando exista un endpoint de preferencias, estos estados se cargan
// con un GET al montar la página y se guardan con un PATCH al cambiar,
// igual que hicimos con getUsuarioActual() en Perfil.
export function ConfiguracionPage() {
  // Notificaciones
  const [avisoCobros, setAvisoCobros] = useState(true);
  const [avisoPruebaGratis, setAvisoPruebaGratis] = useState(true);
  const [avisoAnomalias, setAvisoAnomalias] = useState(true);
  const [consejosAhorro, setConsejosAhorro] = useState(false);

  // Apariencia (persistente y aplicada a toda la app)
  const [tema, setTema] = useTema();

  return (
    <AppLayout headerTitulo="Ajustes" headerSubtitulo="Avisos, apariencia y tus datos.">
      <div className={styles.grid}>
        <div className={styles.columna}>
          <Seccion
            titulo="Avisos"
            descripcion="Te avisamos por correo antes de que pase."
            icono={<Bell size={19} aria-hidden="true" />}
            tinte="acento"
          >
            <FilaInterruptor
              etiqueta="Antes de cada cobro"
              descripcion="3 días antes si es mensual; 7 días y 24 horas antes si es anual."
              activo={avisoCobros}
              onChange={setAvisoCobros}
            />
            <FilaInterruptor
              etiqueta="Cuando termina una prueba gratis"
              descripcion="48 y 24 horas antes de que empiece a cobrar."
              activo={avisoPruebaGratis}
              onChange={setAvisoPruebaGratis}
            />
            <FilaInterruptor
              etiqueta="Alza de precio o cobro doble"
              descripcion="Cuando un cobro no calza con lo esperado."
              activo={avisoAnomalias}
              onChange={setAvisoAnomalias}
            />
            <FilaInterruptor
              etiqueta="Consejos para gastar menos"
              descripcion="Sugerencias según lo que usas y lo que no."
              activo={consejosAhorro}
              onChange={setConsejosAhorro}
            />
          </Seccion>

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
          <Seccion
            titulo="Cuentas conectadas"
            descripcion="Cuando esté lista, los cobros nuevos se registran solos desde tu correo."
            icono={<Link2 size={19} aria-hidden="true" />}
            tinte="turquesa"
          >
            <Fila etiqueta="Correo electrónico">
              <Insignia>No conectado</Insignia>
            </Fila>
            <Fila etiqueta="Cuenta bancaria">
              <Insignia>No disponible</Insignia>
            </Fila>
            <div className={styles.pieSeccion}>
              {/* TODO: habilitar cuando el servicio de conectores esté listo */}
              <Boton variante="secundario" disabled title="Próximamente">
                Conectar correo
              </Boton>
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
              <Boton variante="sutil" tamano="s" className={styles.peligro} disabled title="Próximamente">
                Eliminar
              </Boton>
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

function FilaInterruptor({
  etiqueta,
  descripcion,
  activo,
  onChange,
}: {
  etiqueta: string;
  descripcion: string;
  activo: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <Fila etiqueta={etiqueta} detalle={descripcion}>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        className={activo ? `${styles.interruptor} ${styles.interruptorActivo}` : styles.interruptor}
        onClick={() => onChange(!activo)}
      >
        <span className={styles.interruptorBola} />
      </button>
    </Fila>
  );
}
