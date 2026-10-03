import type { ReactNode } from 'react';
import { useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
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

  function handleEliminarCuenta() {
    // TODO: llamar al endpoint de eliminación cuando exista
    if (window.confirm('¿Seguro que quieres eliminar tu cuenta? Esta acción no se puede deshacer.')) {
      console.log('Eliminar cuenta');
    }
  }

  return (
    <AppLayout
      headerTitulo="Configuración"
      headerSubtitulo="Gestiona tus notificaciones, apariencia y privacidad."
    >
      <div className={styles.grid}>
        {/* ───────── Columna izquierda ───────── */}
        <div className={styles.columna}>
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
            <FilaToggle
              etiqueta="Consejos de ahorro (budget)"
              descripcion="Sugerencias para reducir tus gastos recurrentes"
              activo={consejosAhorro}
              onChange={setConsejosAhorro}
            />
          </Seccion>

          <Seccion titulo="Apariencia">
            <div className={styles.filaTema}>
              <span className={styles.filaEtiqueta}>Tema</span>
              <div className={styles.selectorTema} role="group" aria-label="Tema de la aplicación">
                <button
                  type="button"
                  aria-pressed={tema === 'claro'}
                  className={tema === 'claro' ? styles.temaBotonActivo : styles.temaBoton}
                  onClick={() => setTema('claro')}
                >
                  Claro
                </button>
                <button
                  type="button"
                  aria-pressed={tema === 'oscuro'}
                  className={tema === 'oscuro' ? styles.temaBotonActivo : styles.temaBoton}
                  onClick={() => setTema('oscuro')}
                >
                  Oscuro
                </button>
              </div>
            </div>
          </Seccion>
        </div>

        {/* ───────── Columna derecha ───────── */}
        <div className={styles.columna}>
          <Seccion titulo="Cuentas conectadas">
            <FilaEstado etiqueta="Correo electrónico" estado="conectado" textoEstado="Conectado" />
            <FilaEstado etiqueta="Cuenta bancaria (OAuth)" estado="pendiente" textoEstado="En trámite" />
            {/* TODO: habilitar cuando el servicio de conectores esté listo */}
            <button type="button" className={styles.botonPrimario}>
              Conectar cuenta
            </button>
          </Seccion>

          <Seccion titulo="Privacidad y datos">
            {/* TODO: conectar la exportación cuando exista el endpoint */}
            <FilaAccion etiqueta="Exportar mis datos" accion="Descargar" />
            <FilaAccion etiqueta="Historial de accesos" accion="Ver" />
            <button type="button" className={styles.botonPeligro} onClick={handleEliminarCuenta}>
              Eliminar cuenta
            </button>
          </Seccion>

          <Seccion titulo="Plan y facturación">
            <div className={styles.fila}>
              <span className={styles.filaEtiqueta}>Plan gratuito</span>
              <span className={styles.filaDescripcion}>Meses consecutivos sin costo</span>
            </div>
            <button type="button" className={styles.botonPrimario}>
              Mejorar a premium
            </button>
          </Seccion>

          <Seccion titulo="Ayuda">
            <FilaEnlace etiqueta="Centro de ayuda" />
            <FilaEnlace etiqueta="Contactar soporte" />
          </Seccion>
        </div>
      </div>
    </AppLayout>
  );
}

/* ───────── Componentes auxiliares ───────── */

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
  estado,
  textoEstado,
}: {
  etiqueta: string;
  estado: 'conectado' | 'pendiente';
  textoEstado: string;
}) {
  return (
    <div className={styles.fila}>
      <span className={styles.filaEtiqueta}>{etiqueta}</span>
      <span className={estado === 'conectado' ? styles.badgeConectado : styles.badgePendiente}>
        {textoEstado}
      </span>
    </div>
  );
}

function FilaAccion({ etiqueta, accion }: { etiqueta: string; accion: string }) {
  return (
    <div className={styles.fila}>
      <span className={styles.filaEtiqueta}>{etiqueta}</span>
      <button type="button" className={styles.accionTexto}>
        {accion}
      </button>
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