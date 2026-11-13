import { LIMITE_PREGUNTA_ASISTENTE } from '@ojoalgasto/shared';
import { Send } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Boton } from '../ui/Boton';
import { CampoArea } from '../ui/Campo';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import styles from './ChatAsistente.module.css';
import type { MensajeChat } from './mensajesChat';

const NOMBRE_DEL_AUTOR: Record<MensajeChat['autor'], string> = { persona: 'Tú', asistente: 'Asistente' };

const AVISO_DE_RESPALDO = 'Resumen automático con tus datos: el asistente con IA no estuvo disponible.';

interface ChatAsistenteProps {
  mensajes: MensajeChat[];
  estaEnviando: boolean;
  /** Qué pasó con el último envío si falló; null si no hay error. */
  errorDeEnvio: string | null;
  alEnviar: (pregunta: string) => void;
  alReintentar: () => void;
}

/**
 * S3-CH-14: la interfaz del chat. Solo dibuja y recoge la pregunta; no sabe de
 * dónde vienen las respuestas (eso lo hace useAsistente), así que se puede
 * probar con respuestas inventadas sin llamar a ningún servicio.
 *
 * Teclado: Tab llega al cuadro de la pregunta y luego a "Enviar". Enter envía y
 * Mayús + Enter baja de línea. Después de enviar o de reintentar, el foco vuelve
 * al cuadro.
 */
export function ChatAsistente({ mensajes, estaEnviando, errorDeEnvio, alEnviar, alReintentar }: ChatAsistenteProps) {
  const [borrador, setBorrador] = useState('');
  const idCuadro = useId();
  const idAyuda = useId();
  const historial = useRef<HTMLDivElement>(null);

  const pregunta = borrador.trim();
  const puedeEnviar = pregunta !== '' && !estaEnviando;

  // Lo último que llegó queda a la vista sin que haya que bajar a buscarlo.
  useEffect(() => {
    const zonaDeMensajes = historial.current;
    if (zonaDeMensajes) zonaDeMensajes.scrollTop = zonaDeMensajes.scrollHeight;
  }, [mensajes.length, estaEnviando, errorDeEnvio]);

  // "Enviar" se deshabilita al enviar y "Reintentar" desaparece mientras se espera:
  // en los dos casos el navegador deja el foco en la página, y quien usa teclado
  // tendría que recorrerla otra vez desde el inicio. Se devuelve al cuadro.
  const enfocarCuadro = () => document.getElementById(idCuadro)?.focus();

  const enviarBorrador = () => {
    if (!puedeEnviar) return;
    alEnviar(pregunta);
    setBorrador('');
    enfocarCuadro();
  };

  const reintentar = () => {
    alReintentar();
    enfocarCuadro();
  };

  const alEnviarFormulario = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    enviarBorrador();
  };

  const alPresionarTecla = (evento: KeyboardEvent<HTMLTextAreaElement>) => {
    // Con un método de entrada activo (IME), Enter confirma la palabra y no envía.
    if (evento.key !== 'Enter' || evento.shiftKey || evento.nativeEvent.isComposing) return;
    evento.preventDefault();
    enviarBorrador();
  };

  return (
    <section className={`tile ${styles.chat}`} aria-label="Chat con el asistente financiero">
      <div
        ref={historial}
        className={styles.historial}
        role="log"
        aria-label="Conversación"
        aria-live="polite"
        aria-relevant="additions"
      >
        {mensajes.length === 0 && (
          <p className={styles.vacio}>Todavía no hay mensajes. Escribe una pregunta sobre tus suscripciones y tus gastos.</p>
        )}
        <ol className={styles.mensajes}>
          {mensajes.map((mensaje) => (
            <li
              key={mensaje.id}
              className={`${styles.mensaje} ${mensaje.autor === 'persona' ? styles.dePersona : styles.delAsistente}`}
            >
              <span className={styles.autor}>{NOMBRE_DEL_AUTOR[mensaje.autor]}</span>
              <p className={styles.texto}>{mensaje.texto}</p>
              {mensaje.autor === 'asistente' && mensaje.esRespaldo && <p className={styles.aviso}>{AVISO_DE_RESPALDO}</p>}
            </li>
          ))}
        </ol>
      </div>

      {estaEnviando && (
        <p role="status" className={styles.espera}>
          El asistente está respondiendo…
        </p>
      )}
      {errorDeEnvio !== null && <ErrorConReintento mensaje={errorDeEnvio} onReintentar={reintentar} />}

      <form className={styles.formulario} onSubmit={alEnviarFormulario}>
        <CampoArea
          id={idCuadro}
          etiqueta="Tu pregunta"
          placeholder="Por ejemplo: ¿Qué suscripción me conviene revisar primero?"
          value={borrador}
          maxLength={LIMITE_PREGUNTA_ASISTENTE}
          aria-describedby={idAyuda}
          onChange={(evento) => setBorrador(evento.target.value)}
          onKeyDown={alPresionarTecla}
        />
        <div className={styles.pie}>
          <p id={idAyuda} className={styles.ayuda}>
            Enter envía; Mayús + Enter agrega una línea. {borrador.length}/{LIMITE_PREGUNTA_ASISTENTE}
          </p>
          <Boton type="submit" disabled={!puedeEnviar} cargando={estaEnviando} icono={<Send size={16} aria-hidden="true" />}>
            Enviar
          </Boton>
        </div>
      </form>
    </section>
  );
}
