import { AppLayout } from '../components/layout/AppLayout';
import { ChatAsistente } from '../components/asistente/ChatAsistente';
import { useAsistente } from '../hooks/useAsistente';

/** S3-CH-14 y S3-CH-15: el chat con el asistente financiero. La página solo une el hook con la interfaz. */
export function AsistentePage() {
  const { mensajes, envio, enviarPregunta, reintentar } = useAsistente();

  return (
    <AppLayout
      headerTitulo="Asistente financiero"
      headerSubtitulo="Pregunta sobre tus suscripciones y tus gastos."
      angosto
    >
      <ChatAsistente
        mensajes={mensajes}
        estaEnviando={envio.tipo === 'enviando'}
        errorDeEnvio={envio.tipo === 'error' ? envio.mensaje : null}
        alEnviar={enviarPregunta}
        alReintentar={reintentar}
      />
    </AppLayout>
  );
}
