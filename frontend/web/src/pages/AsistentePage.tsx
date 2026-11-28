import { AppLayout } from '../components/layout/AppLayout';
import { ChatAsistente } from '../components/asistente/ChatAsistente';
import { BloqueoPremium } from '../components/planes/BloqueoPremium';
import { useAsistente } from '../hooks/useAsistente';
import { usePermisosPlan } from '../hooks/usePermisosPlan';

/**
 * S3-CH-14, S3-CH-15 y S3-CH-16: el chat con el asistente financiero, solo si el plan que dice el
 * servidor lo incluye. Consume la política y restricción universal de SE-02.
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
      <BloqueoPremium
        feature="asistente_financiero"
        permisos={permisos}
        onReintentar={reintentarPermisos}
      >
        <ChatAsistente
          mensajes={mensajes}
          estaEnviando={envio.tipo === 'enviando'}
          errorDeEnvio={envio.tipo === 'error' ? envio.mensaje : null}
          alEnviar={enviarPregunta}
          alReintentar={reintentar}
        />
      </BloqueoPremium>
    </AppLayout>
  );
}
