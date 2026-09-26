import { getUsuarioActual, type Usuario } from '@ojoalgasto/shared';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import styles from './PerfilPage.module.css';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; usuario: Usuario };

export function PerfilPage() {
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'cargando' });

  useEffect(() => {
    let cancelado = false;

    getUsuarioActual()
      .then((usuario) => {
        if (!cancelado) setEstado({ tipo: 'listo', usuario });
      })
      .catch(() => {
        if (!cancelado) {
          setEstado({
            tipo: 'error',
            mensaje: 'No pudimos cargar tu perfil. Intenta de nuevo en unos segundos.',
          });
        }
      });

    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <AppLayout headerTitulo="Perfil" headerSubtitulo="Gestiona tu cuenta y tus datos.">
      {estado.tipo === 'cargando' && <p className={styles.mensaje}>Cargando tu perfil…</p>}
      {estado.tipo === 'error' && <p className={styles.mensaje}>{estado.mensaje}</p>}
      {estado.tipo === 'listo' && <ContenidoPerfil usuario={estado.usuario} />}
    </AppLayout>
  );
}

function ContenidoPerfil({ usuario }: { usuario: Usuario }) {
  const etiquetaPlan = usuario.plan === 'premium' ? 'Plan Premium' : 'Plan Gratuito';
  const etiquetaRol = usuario.rol === 'titular' ? 'Titular de la cuenta' : 'Integrante';

  return (
    <>
      <div className={styles.tarjetaPlan}>
        <div>
          <p className={styles.planTitulo}>{etiquetaPlan}</p>
          <p className={styles.planDescripcion}>
            {usuario.plan === 'premium'
              ? 'Tienes acceso al asistente financiero y recomendaciones avanzadas.'
              : 'Alertas de cobro y de prueba gratuita incluidas.'}
          </p>
        </div>
        {usuario.plan === 'gratuito' && (
          <button type="button" className={styles.botonMejorar}>
            Mejorar a Premium
          </button>
        )}
      </div>

      <div className={styles.grid}>
        <Seccion titulo="Cuenta">
          <Fila etiqueta="Nombre" valor={usuario.nombre} accion="Editar" />
          <Fila etiqueta="Correo electrónico" valor={usuario.correo || (usuario as any).email} accion="Editar" />
          <Fila etiqueta="Contraseña" valor="••••••••" accion="Cambiar" />
        </Seccion>

        <Seccion titulo="Organización">
          <Fila etiqueta="Rol" valor={etiquetaRol} accion="" />
          <Fila etiqueta="Moneda" valor="CLP ($)" accion="Cambiar" />
        </Seccion>

        <Seccion titulo="Privacidad y datos">
          <Fila etiqueta="Exportar mis datos" accion="Descargar" />
          <Fila etiqueta="Eliminar cuenta" accion="Eliminar" peligro />
        </Seccion>
      </div>
    </>
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

function Fila({
  etiqueta,
  valor,
  accion,
  peligro,
}: {
  etiqueta: string;
  valor?: string;
  accion: string;
  peligro?: boolean;
}) {
  return (
    <div className={styles.fila}>
      <div>
        <p className={styles.filaEtiqueta}>{etiqueta}</p>
        {valor && <p className={styles.filaValor}>{valor}</p>}
      </div>
      {accion && (
        <button type="button" className={peligro ? styles.accionPeligro : styles.accion}>
          {accion}
        </button>
      )}
    </div>
  );
}
