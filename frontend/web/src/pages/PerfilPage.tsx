import { getUsuarioActual, type Usuario } from '@ojoalgasto/shared';
import { Database, Home, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import { CambiarContrasena } from '../components/perfil/CambiarContrasena';
import { EditarNombre } from '../components/perfil/EditarNombre';
import { Avatar } from '../components/ui/Avatar';
import { Boton } from '../components/ui/Boton';
import { Fila, Seccion } from '../components/ui/Seccion';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import styles from './PerfilPage.module.css';

const MENSAJE_NOMBRE_GUARDADO = 'Guardamos tu nombre.';
const MENSAJE_CONTRASENA_CAMBIADA = 'Cambiaste tu contraseña. Inicia sesión con la nueva.';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; usuario: Usuario };

export function PerfilPage() {
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'cargando' });
  const { actualizarUsuario, cerrarSesionLocal } = useAuth();
  const toast = useToast();

  // CH-08: lo que devolvió el PATCH es el dato confirmado. Se combina con lo
  // que ya había (la API de /me no trae todos los campos del tipo, p. ej.
  // `plan`) y se comparte con el contexto para que la barra superior
  // muestre el nombre nuevo sin recargar.
  const alGuardarNombre = (guardado: Usuario) => {
    if (estado.tipo !== 'listo') return;
    const usuario = { ...estado.usuario, ...guardado };
    setEstado({ tipo: 'listo', usuario });
    actualizarUsuario(usuario);
    toast.exito(MENSAJE_NOMBRE_GUARDADO);
  };

  // CH-29: el backend ya invalidó todas las sesiones, también esta. Se borra
  // la local sin llamar al backend (igual que al restablecer, CH-07) y
  // <RutaPrivada> lleva al Login, que después vuelve a Perfil.
  const alCambiarContrasena = useCallback(() => {
    cerrarSesionLocal();
    toast.exito(MENSAJE_CONTRASENA_CAMBIADA);
  }, [cerrarSesionLocal, toast]);

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
      {estado.tipo === 'listo' && (
        <ContenidoPerfil
          usuario={estado.usuario}
          onNombreGuardado={alGuardarNombre}
          onContrasenaCambiada={alCambiarContrasena}
        />
      )}
    </AppLayout>
  );
}

interface ContenidoPerfilProps {
  usuario: Usuario;
  onNombreGuardado: (usuario: Usuario) => void;
  onContrasenaCambiada: () => void;
}

function ContenidoPerfil({ usuario, onNombreGuardado, onContrasenaCambiada }: ContenidoPerfilProps) {
  const [cambiandoContrasena, setCambiandoContrasena] = useState(false);
  const cerrarCambioContrasena = useCallback(() => setCambiandoContrasena(false), []);
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
          <EditarNombre nombre={usuario.nombre} onGuardado={onNombreGuardado} />
          <Fila etiqueta="Correo electrónico" detalle={usuario.correo}>
            <Boton variante="sutil" tamano="s" disabled title="Próximamente">
              Editar
            </Boton>
          </Fila>
          <Fila etiqueta="Contraseña" detalle="••••••••••">
            <Boton
              variante="sutil"
              tamano="s"
              onClick={() => setCambiandoContrasena(true)}
              aria-label="Cambiar contraseña"
            >
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

      {cambiandoContrasena && (
        <CambiarContrasena alCerrar={cerrarCambioContrasena} onCambiada={onContrasenaCambiada} />
      )}
    </>
  );
}
