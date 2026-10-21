import { actualizarNombre, ErrorDeApi, validarNombre, type Usuario } from '@ojoalgasto/shared';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Boton } from '../ui/Boton';
import { CampoTexto } from '../ui/Campo';
import { Fila } from '../ui/Seccion';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import styles from './Perfil.module.css';

const MENSAJE_GENERICO = 'No pudimos guardar tu nombre. Intenta de nuevo.';

interface EditarNombreProps {
  /** El último nombre que confirmó el backend. Es lo que se muestra fuera de la edición. */
  nombre: string;
  /** Se llama con el usuario que devolvió el PATCH, ya guardado. */
  onGuardado: (usuario: Usuario) => void;
}

/**
 * Fila "Nombre" de Perfil con edición en el lugar (CH-08).
 *
 * - "Editar" abre el campo con el nombre actual; "Cancelar" (o Escape)
 *   cierra sin enviar nada.
 * - Guardar valida igual que el backend (shared/validarNombre) y manda
 *   PATCH /api/usuarios/me/. Solo con la respuesta se cambia el nombre
 *   mostrado: si falla, se sigue viendo el último dato confirmado y el campo
 *   queda abierto con lo escrito, para corregir o reintentar.
 * - Al terminar (guardar o cancelar) el foco vuelve a "Editar".
 */
export function EditarNombre({ nombre, onGuardado }: EditarNombreProps) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(nombre);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Ref y no solo estado: dos envíos en el mismo instante (doble clic,
  // Enter repetido) verían el estado viejo y mandarían dos PATCH.
  const enviandoRef = useRef(false);
  const yaEdito = useRef(false);
  // Boton y CampoTexto no reenvían refs: se ubican por id para mover el foco.
  const idBotonEditar = useId();
  const idCampo = useId();

  // Al volver de la edición, el foco regresa al botón que la abrió (y no se
  // pierde en el <body> cuando el formulario desaparece).
  useEffect(() => {
    if (editando) yaEdito.current = true;
    else if (yaEdito.current) document.getElementById(idBotonEditar)?.focus();
  }, [editando, idBotonEditar]);

  // Con un error, el foco vuelve al campo: el lector de pantalla lee el
  // mensaje (va en aria-describedby) y se puede corregir de inmediato.
  useEffect(() => {
    if (error) document.getElementById(idCampo)?.focus();
  }, [error, idCampo]);

  function abrir() {
    setValor(nombre);
    setError(null);
    setEditando(true);
  }

  function cancelar() {
    if (enviandoRef.current) return; // la respuesta decide qué queda
    setError(null);
    setEditando(false);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (enviandoRef.current) return;

    const errorLocal = validarNombre(valor);
    if (errorLocal) {
      setError(errorLocal);
      return;
    }
    // Sin cambios no hay nada que guardar: se cierra sin llamar a la API.
    if (valor.trim() === nombre) {
      setError(null);
      setEditando(false);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      const usuario = await actualizarNombre(valor);
      onGuardado(usuario);
      setEditando(false);
    } catch (err: unknown) {
      if (err instanceof ErrorDeApi && err.campos?.nombre) setError(err.campos.nombre.join(' '));
      else if (err instanceof TypeError) setError(MENSAJE_SIN_RED);
      else if (err instanceof ErrorDeApi) setError(err.message || MENSAJE_GENERICO);
      else setError(MENSAJE_GENERICO);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelar();
    }
  }

  if (!editando) {
    return (
      <Fila etiqueta="Nombre" detalle={nombre}>
        {/* "Editar" a secas se repite en la fila del correo: el nombre
            accesible dice qué se edita, para el lector de pantalla. */}
        <Boton id={idBotonEditar} variante="sutil" tamano="s" onClick={abrir} aria-label="Editar nombre">
          Editar
        </Boton>
      </Fila>
    );
  }

  return (
    <form className={styles.formNombre} onSubmit={guardar} noValidate aria-label="Editar nombre">
      <CampoTexto
        id={idCampo}
        etiqueta="Nombre"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={alTeclear}
        error={error ?? undefined}
        autoComplete="name"
        autoFocus
      />
      <div className={styles.acciones}>
        <Boton variante="secundario" tamano="s" onClick={cancelar} disabled={enviando}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="s" cargando={enviando}>
          {enviando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </form>
  );
}
