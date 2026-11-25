import { AppLayout } from '../components/layout/AppLayout';
import { ChatAsistente } from '../components/asistente/ChatAsistente';
import { RestriccionPremium } from '../components/asistente/RestriccionPremium';
import { Spinner } from '../components/Spinner';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { useAsistente } from '../hooks/useAsistente';
import { usePermisosPlan } from '../hooks/usePermisosPlan';

/**
 * S3-CH-14, S3-CH-15 y S3-CH-16: el chat con el asistente financiero, solo si el plan que dice el
 * servidor lo incluye. La página solo une los hooks con la interfaz.
 */
export function AsistentePage() {
  const { mensajes, envio, enviarPregunta, reintentar } = useAsistente();
  const { estado: permisos, reintentar: reintentarPermisos } = usePermisosPlan();

  return (
    <AppLayout
      headerTitulo="Asistente financiero"
      headerSubtitulo="Pregunta sobre tus suscripciones y tus gastos."
      angosto
    >
      {permisos.tipo === 'cargando' && <Spinner size={18} etiqueta="Comprobando tu plan" />}
      {permisos.tipo === 'error' && <ErrorConReintento mensaje={permisos.mensaje} onReintentar={reintentarPermisos} />}
      {permisos.tipo === 'listo' && !permisos.permisos.features.asistente_financiero && <RestriccionPremium />}
      {permisos.tipo === 'listo' && permisos.permisos.features.asistente_financiero && (
        <ChatAsistente
          mensajes={mensajes}
          estaEnviando={envio.tipo === 'enviando'}
          errorDeEnvio={envio.tipo === 'error' ? envio.mensaje : null}
          alEnviar={enviarPregunta}
          alReintentar={reintentar}
        />
      )}
    </AppLayout>
  );
}
