import { ErrorDeApi, getContratacion, getPermisosPlan, type ContratacionPlan, type PermisosPlan } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MENSAJE_PLAN_ACTIVANDO, TEXTO_PRECIO_DEMO, TEXTOS_CONTRATACION } from '../components/Planes/reglasContratacion';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import { Seccion } from '../components/ui/Seccion';
import { useAuth } from '../context/AuthContext';

type EstadoRetorno =
  | { tipo: 'cargando' }
  | { tipo: 'sin_contratacion' }
  | { tipo: 'no_encontrada' }
  | { tipo: 'error' }
  | { tipo: 'listo'; contrato: ContratacionPlan; plan: PermisosPlan };

/**
 * Adonde vuelve el pago (PAGOS_URL_RETORNO con `contratacion_id`). Muestra lo que dice el servidor:
 * Premium aparece solo cuando `/usuarios/me/permisos/` lo confirma.
 */
export function PlanesRetornoPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { capturarSesion } = useAuth();
  // El id se toma una vez: después la URL se limpia y no debe perderse.
  const [idContratacion] = useState(() => searchParams.get('contratacion_id') ?? '');
  const [sesion] = useState(capturarSesion);
  const [estado, setEstado] = useState<EstadoRetorno>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (searchParams.toString().length > 0) navigate('/planes/retorno', { replace: true });
  }, [navigate, searchParams]);

  useEffect(() => {
    if (!idContratacion) {
      setEstado({ tipo: 'sin_contratacion' });
      return;
    }
    let vigente = true;
    const sigueVigente = () => vigente && capturarSesion() === sesion;
    setEstado({ tipo: 'cargando' });
    Promise.all([getContratacion(idContratacion), getPermisosPlan()])
      .then(([contrato, plan]) => {
        if (sigueVigente()) setEstado({ tipo: 'listo', contrato, plan });
      })
      .catch((error: unknown) => {
        if (!sigueVigente()) return;
        const noExiste = error instanceof ErrorDeApi && error.status === 404;
        setEstado({ tipo: noExiste ? 'no_encontrada' : 'error' });
      });
    return () => {
      vigente = false;
    };
  }, [capturarSesion, idContratacion, intento, sesion]);

  return (
    <AppLayout headerTitulo="Plan Premium" headerSubtitulo="Resultado de tu contratación.">
      <Seccion titulo="Estado del pago" tinte="verde">
        {estado.tipo === 'cargando' && <Spinner size={22} etiqueta="Comprobando tu contratación" />}

        {estado.tipo === 'sin_contratacion' && (
          <p role="status">No encontramos la contratación en este enlace. Revisa tu plan en Ajustes.</p>
        )}

        {estado.tipo === 'no_encontrada' && (
          <p role="alert">No encontramos esa contratación en tu organización.</p>
        )}

        {estado.tipo === 'error' && (
          <div role="alert">
            <p>No pudimos consultar tu contratación. Intenta de nuevo.</p>
            <Boton variante="secundario" onClick={() => setIntento((anterior) => anterior + 1)}>
              Verificar estado
            </Boton>
          </div>
        )}

        {estado.tipo === 'listo' && <ResultadoContratacion contrato={estado.contrato} plan={estado.plan} onVerificar={() => setIntento((anterior) => anterior + 1)} />}

        <div>
          <BotonEnlace to="/configuracion" variante="sutil">
            Volver a Ajustes
          </BotonEnlace>
        </div>
      </Seccion>
    </AppLayout>
  );
}

function ResultadoContratacion({
  contrato,
  plan,
  onVerificar,
}: {
  contrato: ContratacionPlan;
  plan: PermisosPlan;
  onVerificar: () => void;
}) {
  const texto = TEXTOS_CONTRATACION[contrato.estado];
  const premiumActivo = plan.plan === 'premium';

  return (
    <div>
      <p>{texto.titulo}</p>
      <p>{texto.detalle}</p>
      {contrato.precio_demo && <p>{TEXTO_PRECIO_DEMO}</p>}
      {premiumActivo && <p role="status">Tu plan Premium está activo.</p>}
      {!premiumActivo && contrato.estado === 'exitosa' && <p role="status">{MENSAJE_PLAN_ACTIVANDO}</p>}
      {(contrato.estado === 'pendiente' || (contrato.estado === 'exitosa' && !premiumActivo)) && (
        <Boton variante="secundario" onClick={onVerificar}>
          Verificar estado
        </Boton>
      )}
    </div>
  );
}
