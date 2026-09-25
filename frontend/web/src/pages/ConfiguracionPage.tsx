import type { ReactNode } from 'react';
import { useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import styles from './ConfiguracionPage.module.css';

// TODO: cuando exista un endpoint de preferencias, estos estados se cargan
// con un GET al montar la página y se guardan con un PATCH al cambiar,
// igual que hicimos con getUsuarioActual() en Perfil.
export function ConfiguracionPage() {
  const [avisoCobros, setAvisoCobros] = useState(true);
  const [avisoPruebaGratis, setAvisoPruebaGratis] = useState(true);
  const [avisoAnomalias, setAvisoAnomalias] = useState(true);
  const [tema, setTema] = useState<'claro' | 'oscuro'>('claro');

  return (
    <AppLayout headerTitulo="Configuración" headerSubtitulo="Personaliza cómo funciona la app para ti.">
      <div className={styles.grid}>
        <Seccion titulo="Notificaciones">
          <FilaToggle
            etiqueta="Aviso antes de cada cobro"
            descripcion="3 días antes (mensual), 7 días y 24 h antes (anual)"
            activo={avisoCobros}
            onChange={setAvisoCobros}
          />
          <FilaToggle
            etiqueta="Aviso fin de prueba gratis"
            descripcion="48 horas y 24 horas antes del vencimiento"
            activo={avisoPruebaGratis}
            onChange={setAvisoPruebaGratis}
          />
          <FilaToggle
            etiqueta="Alza de tarifa / doble cobro"
            descripcion="Cuando el sistema detecta una anomalía"
            activo={avisoAnomalias}
            onChange={setAvisoAnomalias}
          />
        </Seccion>

        <Seccion titulo="Cuentas conectadas">
          <FilaEstado etiqueta="Correo electrónico" estado="pendiente" textoEstado="No conectado" />
          <FilaEstado etiqueta="Cuenta bancaria" estado="pendiente" textoEstado="No disponible" />
          <p className={styles.notaConectores}>
            La conexión de cuentas todavía no está disponible — el servicio de conectores está en
            desarrollo.
          </p>
        </Seccion>

        <Seccion titulo="Apariencia">
          <div className={styles.filaTema}>
            <span className={styles.filaEtiqueta}>Tema</span>
            <div className={styles.selectorTema}>
              <button
                type="button"
                className={tema === 'claro' ? styles.temaBotonActivo : styles.temaBoton}
                onClick={() => setTema('claro')}
              >
                Claro
              </button>
              <button
                type="button"
                className={tema === 'oscuro' ? styles.temaBotonActivo : styles.temaBoton}
                onClick={() => setTema('oscuro')}
              >
                Oscuro
              </button>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Ayuda">
          <FilaEnlace etiqueta="Centro de ayuda" />
          <FilaEnlace etiqueta="Contactar soporte" />
        </Seccion>
      </div>
    </AppLayout>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className={styles.seccion}>
      <h2 className={styles.seccionTitulo}>{titulo}</h2>
      <div className={styles.lista}>{children}</div>
    </section>
  );
}

function FilaToggle({
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
    <div className={styles.fila}>
      <div>
        <p className={styles.filaEtiqueta}>{etiqueta}</p>
        <p className={styles.filaDescripcion}>{descripcion}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        className={activo ? styles.toggleActivo : styles.toggle}
        onClick={() => onChange(!activo)}
      >
        <span className={styles.toggleBola} />
      </button>
    </div>
  );
}

function FilaEstado({
  etiqueta,
  textoEstado,
}: {
  etiqueta: string;
  estado: 'conectado' | 'pendiente';
  textoEstado: string;
}) {
  return (
    <div className={styles.fila}>
      <span className={styles.filaEtiqueta}>{etiqueta}</span>
      <span className={styles.badgePendiente}>{textoEstado}</span>
    </div>
  );
}

function FilaEnlace({ etiqueta }: { etiqueta: string }) {
  return (
    <div className={styles.fila}>
      <span className={styles.filaEtiqueta}>{etiqueta}</span>
      <span className={styles.flecha}>›</span>
    </div>
  );
}
