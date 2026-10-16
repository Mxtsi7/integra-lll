import { getUsuarioActual, type Usuario } from '@ojoalgasto/shared';
import { Database, Home, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import { Avatar } from '../components/ui/Avatar';
import { Boton } from '../components/ui/Boton';
import { Fila, Seccion } from '../components/ui/Seccion';
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
    <AppLayout headerTitulo="Perfil" headerSubtitulo="Tu cuenta y tu hogar.">
      {estado.tipo === 'cargando' && <p className={styles.mensaje}>Cargando tu perfil…</p>}
      {estado.tipo === 'error' && <p className={styles.mensaje}>{estado.mensaje}</p>}
      {estado.tipo === 'listo' && <ContenidoPerfil usuario={estado.usuario} />}
    </AppLayout>
  );
}

function ContenidoPerfil({ usuario }: { usuario: Usuario }) {
  const plan = usuario.plan ?? 'gratuito';
  const esPremium = plan === 'premium';
  const etiquetaRol = usuario.rol === 'titular' ? 'Titular del hogar' : 'Integrante del hogar';

  return (
    <>
      <section className={`tile ${styles.tarjetaUsuario}`}>
        <Avatar nombre={usuario.nombre} forma="persona" tamano={64} />
        <div className={styles.usuarioTexto}>
          <h2 className={styles.usuarioNombre}>{usuario.nombre}</h2>
          <p className={styles.usuarioCorreo}>{usuario.correo}</p>
        </div>
        <div className={styles.plan}>
          <p className={styles.planNombre}>{esPremium ? 'Plan Premium' : 'Plan Gratuito'}</p>
          <p className={styles.planDetalle}>
            {esPremium
              ? 'Asistente financiero y recomendaciones avanzadas.'
              : 'Alertas de cobro y de prueba gratis incluidas.'}
          </p>
          {!esPremium && (
            <Boton variante="secundario" tamano="s" disabled title="Próximamente">
              Mejorar a Premium
            </Boton>
          )}
        </div>
      </section>

      <div className={styles.grid}>
        <Seccion titulo="Cuenta" icono={<UserRound size={19} aria-hidden="true" />} tinte="azul">
          <Fila etiqueta="Nombre" detalle={usuario.nombre}>
            <Boton variante="sutil" tamano="s" disabled title="Próximamente">
              Editar
            </Boton>
          </Fila>
          <Fila etiqueta="Correo electrónico" detalle={usuario.correo}>
            <Boton variante="sutil" tamano="s" disabled title="Próximamente">
              Editar
            </Boton>
          </Fila>
          <Fila etiqueta="Contraseña" detalle="••••••••••">
            <Boton variante="sutil" tamano="s" disabled title="Próximamente">
              Cambiar
            </Boton>
          </Fila>
        </Seccion>

        <Seccion
          titulo="Hogar"
          descripcion="Las suscripciones se comparten entre quienes están en el mismo hogar."
          icono={<Home size={19} aria-hidden="true" />}
          tinte="verde"
        >
          <Fila etiqueta="Tu rol" detalle={etiquetaRol} />
          <Fila etiqueta="Moneda principal" detalle="Peso chileno (CLP)">
            <Boton variante="sutil" tamano="s" disabled title="Próximamente">
              Cambiar
            </Boton>
          </Fila>
        </Seccion>

        <Seccion titulo="Tus datos" icono={<Database size={19} aria-hidden="true" />} tinte="morado">
          <Fila etiqueta="Exportar mis datos" detalle="Un archivo con todo lo que guardamos de ti.">
            <Boton variante="sutil" tamano="s" disabled title="Próximamente">
              Descargar
            </Boton>
          </Fila>
          <Fila etiqueta="Eliminar cuenta" detalle="Borra tu cuenta y tus suscripciones.">
            <Boton variante="sutil" tamano="s" className={styles.peligro} disabled title="Próximamente">
              Eliminar
            </Boton>
          </Fila>
        </Seccion>
      </div>
    </>
  );
}
