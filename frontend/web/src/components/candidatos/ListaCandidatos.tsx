import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TAMANO_PAGINA_CANDIDATOS, type CandidatoDetectado } from '@ojoalgasto/shared';
import { Boton } from '../ui/Boton';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import { Modal } from '../ui/Modal';
import type { CargaCandidatos } from './cargaCandidatos';
import type { AccionDeCandidato, DecisionesDeCandidatos, ResultadoDecisiones } from './decisionesCandidatos';
import styles from './ListaCandidatos.module.css';
import { fechaParaLeer, fraseDeLaFecha, importeDelCandidato, importeParaLeer, procedenciaLegible } from './presentacionDeCandidato';
import { sePuedeDecidir, type SeleccionDeCandidatos } from './seleccionCandidatos';

interface ListaCandidatosProps {
  carga: CargaCandidatos;
  pagina: number;
  alCambiarPagina: (pagina: number) => void;
  alReintentar: () => void;
  /** Sin esto la lista no tiene casillas ni barra de selección (S3-CH-07). */
  seleccion?: SeleccionDeCandidatos;
  /** Sin esto la lista no confirma ni rechaza, ni muestra resultados (S3-CH-08 y S3-CH-09). Necesita la selección. */
  decisiones?: DecisionesDeCandidatos;
}

/**
 * S3-CH-04: la lista de cobros detectados en un archivo o un correo. Solo dibuja
 * lo que le llega: no sabe de dónde vienen los datos (eso lo hace useCandidatos),
 * así que se prueba con datos inventados.
 */
export function ListaCandidatos({ carga, pagina, alCambiarPagina, alReintentar, seleccion, decisiones }: ListaCandidatosProps) {
  // La sección queda montada en todos los estados. «Anterior», «Siguiente» y
  // «Reintentar» desaparecen mientras se carga: sin esto el foco caería al
  // inicio de la página y quien usa teclado tendría que recorrerla otra vez.
  const zona = useRef<HTMLElement>(null);
  const llevarElFocoALaLista = () => zona.current?.focus();

  const cambiarPagina = (numero: number) => {
    alCambiarPagina(numero);
    llevarElFocoALaLista();
  };
  const reintentar = () => {
    alReintentar();
    llevarElFocoALaLista();
  };

  // Los botones se deshabilitan mientras una tanda corre y «Cerrar» desaparece al usarse: el foco queda en la lista.
  const confirmar = () => {
    decisiones?.alConfirmar();
    llevarElFocoALaLista();
  };
  const rechazar = () => {
    decisiones?.alRechazar();
    llevarElFocoALaLista();
  };
  const cerrarResultado = () => {
    decisiones?.alCerrarResultado();
    llevarElFocoALaLista();
  };

  return (
    <section
      ref={zona}
      tabIndex={-1}
      aria-label="Cobros encontrados"
      aria-busy={carga.tipo === 'cargando'}
      className={styles.lista}
    >
      {decisiones?.resultado && <ResultadoDeDecisiones resultado={decisiones.resultado} alCerrar={cerrarResultado} />}
      {carga.tipo === 'cargando' && (
        <p role="status" className={styles.espera}>
          Cargando los cobros encontrados…
        </p>
      )}
      {carga.tipo === 'error' && <ErrorConReintento mensaje={carga.mensaje} onReintentar={reintentar} />}
      {carga.tipo === 'listo' && carga.datos.count === 0 && (
        <p className={styles.vacio}>Todavía no hay cobros encontrados. Sube una cartola o conecta tu correo para buscarlos.</p>
      )}
      {carga.tipo === 'listo' && carga.datos.count > 0 && (
        <>
          {seleccion && seleccion.cantidadSeleccionable > 0 && (
            <BarraDeSeleccion seleccion={seleccion} decisiones={decisiones} alConfirmar={confirmar} alRechazar={rechazar} />
          )}
          <ol className={styles.items}>
            {carga.datos.results.map((candidato) => (
              <ItemCandidato key={candidato.id} candidato={candidato} seleccion={seleccion} />
            ))}
          </ol>
          <PaginacionCandidatos
            pagina={pagina}
            total={carga.datos.count}
            hayAnterior={carga.datos.previous !== null}
            haySiguiente={carga.datos.next !== null}
            alCambiar={cambiarPagina}
          />
        </>
      )}
    </section>
  );
}

// Por qué no hay proveedor (normalizacion.py). Un Map y no un objeto: un valor
// como "constructor" no debe encontrar nada.
const AVISO_DE_PROVEEDOR = new Map<string, string>([
  ['ambiguo', 'Proveedor sin confirmar: el texto calza con más de uno.'],
  ['desconocido', 'Proveedor sin reconocer.'],
]);
const AVISO_DE_PROVEEDOR_GENERAL = 'Proveedor sin reconocer.';
/**
 * Lo que pasó con la orden. `aplicada` y `fallida` las contesta Suscripciones;
 * mientras no contesta, `enviada` solo dice que salió.
 */
const TEXTO_DE_LA_ORDEN: Record<NonNullable<CandidatoDetectado['aplicacion']> | 'ninguna', string> = {
  ninguna: '',
  por_enviar: ' · orden por enviar a Suscripciones',
  enviada: ' · orden enviada, esperando respuesta de Suscripciones',
  aplicada: ' · aplicada en Suscripciones',
  fallida: ' · Suscripciones no pudo aplicar la orden',
};

function ItemCandidato({ candidato, seleccion }: { candidato: CandidatoDetectado; seleccion?: SeleccionDeCandidatos }) {
  // Sin proveedor se muestra lo que decía el archivo o el correo: inventar un nombre sería peor.
  const sinProveedor = candidato.servicio === null;
  const nombre = candidato.servicio ?? (candidato.servicio_texto || 'Cobro sin descripción');
  const estadoDeLaOrden = TEXTO_DE_LA_ORDEN[candidato.aplicacion ?? 'ninguna'];
  const importe = importeDelCandidato(candidato);
  return (
    <li className={styles.item}>
      {seleccion &&
        (sePuedeDecidir(candidato) ? (
          <input
            type="checkbox"
            className={styles.casilla}
            checked={seleccion.seleccionados.has(candidato.id)}
            onChange={() => seleccion.alAlternar(candidato.id)}
            aria-label={`Seleccionar ${nombre}, ${importeParaLeer(importe)}, ${fechaParaLeer(candidato.fecha)}`}
          />
        ) : (
          // Un cobro ya resuelto no tiene casilla; el hueco mantiene alineados a los demás.
          <div className={styles.sinCasilla} aria-hidden="true" />
        ))}
      <div className={styles.contenido}>
        <div className={styles.cabecera}>
          <span className={styles.nombre}>{nombre}</span>
          <span className={styles.monto}>
            <span className={styles.importe}>{importe.texto}</span>
            {importe.moneda !== null && (
              <>
                {' '}
                <span className={styles.moneda}>{importe.moneda}</span>
              </>
            )}
          </span>
        </div>
        {sinProveedor && (
          <p className={styles.detalle}>
            {AVISO_DE_PROVEEDOR.get(candidato.servicio_resultado) ?? AVISO_DE_PROVEEDOR_GENERAL}
          </p>
        )}
        <p className={styles.detalle}>{procedenciaLegible(candidato)}</p>
        <p className={styles.detalle}>
          {[candidato.tipo_mensaje_legible, fraseDeLaFecha(candidato)].filter((parte) => parte !== '').join(' · ')}
        </p>
        <p className={styles.estado}>
          {candidato.estado_legible}
          {estadoDeLaOrden}
        </p>
      </div>
    </li>
  );
}

/**
 * S3-CH-07: elegir todos los de la página, cuántos hay elegidos y cuántos de ellos no se pueden confirmar.
 * S3-CH-08 y S3-CH-09: los botones de confirmar y rechazar.
 */
function BarraDeSeleccion({
  seleccion,
  decisiones,
  alConfirmar,
  alRechazar,
}: {
  seleccion: SeleccionDeCandidatos;
  decisiones?: DecisionesDeCandidatos;
  alConfirmar: () => void;
  alRechazar: () => void;
}) {
  const casillaDePagina = useRef<HTMLInputElement>(null);
  const cuantos = seleccion.seleccionados.size;
  const estanTodos = cuantos === seleccion.cantidadSeleccionable;
  const hayAlgunos = cuantos > 0 && !estanTodos;
  const confirmables = seleccion.idsParaConfirmar.length;
  const sinProveedor = cuantos - confirmables;
  const accionEnCurso = decisiones?.accionEnCurso ?? null;
  const hayTandaEnCurso = accionEnCurso !== null;
  // Rechazar es definitivo y no tiene vuelta: primero se pregunta, y solo Rechazar dentro de la pregunta lo manda.
  const [preguntandoRechazo, setPreguntandoRechazo] = useState(false);

  // `indeterminate` no es un atributo de HTML: solo se puede poner por la propiedad.
  useEffect(() => {
    if (casillaDePagina.current) casillaDePagina.current.indeterminate = hayAlgunos;
  }, [hayAlgunos]);

  // «Limpiar selección» desaparece al usarse: el foco vuelve a la casilla de la página.
  const limpiar = () => {
    seleccion.alLimpiar();
    casillaDePagina.current?.focus();
  };

  return (
    <div className={styles.barraSeleccion}>
      <label className={styles.etiquetaCasilla}>
        <input ref={casillaDePagina} type="checkbox" checked={estanTodos} onChange={seleccion.alAlternarPagina} />
        Seleccionar todos los de esta página
      </label>
      <span role="status" className={styles.conteo}>
        {textoDelConteo(cuantos, sinProveedor)}
      </span>
      {cuantos > 0 && (
        <Boton variante="sutil" tamano="s" onClick={limpiar} disabled={hayTandaEnCurso}>
          Limpiar selección
        </Boton>
      )}
      {decisiones && (
        <>
          <Boton
            tamano="s"
            onClick={alConfirmar}
            disabled={confirmables === 0 || hayTandaEnCurso}
            cargando={accionEnCurso === 'confirmar'}
          >
            {textoDelBoton('confirmar', accionEnCurso === 'confirmar', confirmables)}
          </Boton>
          <Boton
            variante="secundario"
            tamano="s"
            onClick={() => setPreguntandoRechazo(true)}
            disabled={cuantos === 0 || hayTandaEnCurso}
            cargando={accionEnCurso === 'rechazar'}
          >
            {textoDelBoton('rechazar', accionEnCurso === 'rechazar', cuantos)}
          </Boton>
        </>
      )}
      {preguntandoRechazo && (
        <Modal
          titulo={`¿${textoDelBoton('rechazar', false, cuantos)}?`}
          descripcion="No se puede deshacer."
          tipo="alerta"
          alCerrar={() => setPreguntandoRechazo(false)}
        >
          <div className={styles.confirmacion}>
            <Boton variante="secundario" tamano="s" data-autofocus onClick={() => setPreguntandoRechazo(false)}>
              Cancelar
            </Boton>
            <Boton
              variante="peligro"
              tamano="s"
              onClick={() => {
                setPreguntandoRechazo(false);
                alRechazar();
              }}
            >
              Rechazar
            </Boton>
          </div>
        </Modal>
      )}
    </div>
  );
}

const VERBO_DEL_BOTON: Record<AccionDeCandidato, { infinitivo: string; gerundio: string }> = {
  confirmar: { infinitivo: 'Confirmar', gerundio: 'Confirmando…' },
  rechazar: { infinitivo: 'Rechazar', gerundio: 'Rechazando…' },
};

function textoDelBoton(accion: AccionDeCandidato, esLaQueCorre: boolean, cuantos: number): string {
  const { infinitivo, gerundio } = VERBO_DEL_BOTON[accion];
  if (esLaQueCorre) return gerundio;
  if (cuantos === 0) return infinitivo;
  return cuantos === 1 ? `${infinitivo} 1 cobro` : `${infinitivo} ${cuantos} cobros`;
}

interface TextosDelResultado {
  etiqueta: string;
  /** Cómo se nombra un cobro que quedó hecho. */
  hecho: string;
  /** El verbo en infinitivo, para «No se pudo confirmar…». */
  verbo: string;
  /** El verbo en pasado, para «Confirmaste 2 cobros.». */
  dichoEnPasado: string;
  /** Lo que queda pendiente después de la acción; null si no queda nada pendiente. */
  pendiente: string | null;
}

const TEXTOS_DEL_RESULTADO: Record<AccionDeCandidato, TextosDelResultado> = {
  confirmar: {
    etiqueta: 'Resultado de la confirmación',
    hecho: 'confirmado',
    verbo: 'confirmar',
    dichoEnPasado: 'Confirmaste',
    pendiente: 'Las órdenes se envían a Suscripciones; revisa ahí la suscripción y el cobro.',
  },
  rechazar: {
    etiqueta: 'Resultado del rechazo',
    hecho: 'rechazado',
    verbo: 'rechazar',
    dichoEnPasado: 'Rechazaste',
    pendiente: null,
  },
};

/**
 * Qué pasó con cada cobro. Solo se dice «confirmado» o «rechazado» de los que el servidor
 * respondió 200; con fallos se anuncia como alerta, y sin ellos como aviso que no interrumpe.
 */
function ResultadoDeDecisiones({ resultado, alCerrar }: { resultado: ResultadoDecisiones; alCerrar: () => void }) {
  const textos = TEXTOS_DEL_RESULTADO[resultado.accion];
  const total = resultado.resultados.length;
  const hechos = resultado.resultados.filter((cobro) => cobro.tipo === 'hecho').length;
  const huboFallos = hechos < total;
  return (
    <div role={huboFallos ? 'alert' : 'status'} aria-label={textos.etiqueta} className={styles.resultado}>
      <p className={styles.resumenResultado}>{resumenDelResultado(textos, hechos, total)}</p>
      <ul className={styles.resultados}>
        {resultado.resultados.map((cobro) => (
          <li key={cobro.id}>
            <strong>{cobro.nombre}:</strong> {cobro.tipo === 'hecho' ? textos.hecho : cobro.mensaje}
          </li>
        ))}
      </ul>
      <Boton variante="sutil" tamano="s" onClick={alCerrar}>
        Cerrar
      </Boton>
    </div>
  );
}

function resumenDelResultado(textos: TextosDelResultado, hechos: number, total: number): string {
  if (hechos === 0) return total === 1 ? `No se pudo ${textos.verbo} el cobro.` : `No se pudo ${textos.verbo} ningún cobro.`;
  const pendiente = textos.pendiente ? ` ${textos.pendiente}` : '';
  if (hechos === total) {
    const cuantos = hechos === 1 ? `${textos.dichoEnPasado} 1 cobro` : `${textos.dichoEnPasado} ${hechos} cobros`;
    return `${cuantos}.${pendiente}`;
  }
  return `${textos.dichoEnPasado} ${hechos} de ${total} cobros; el resto no se pudo.${pendiente}`;
}

function textoDelConteo(cuantos: number, sinProveedor: number): string {
  if (cuantos === 0) return 'Ninguno seleccionado';
  const elegidos = cuantos === 1 ? '1 seleccionado' : `${cuantos} seleccionados`;
  if (sinProveedor === 0) return elegidos;
  const aviso = sinProveedor === 1 ? '1 no se puede confirmar' : `${sinProveedor} no se pueden confirmar`;
  return `${elegidos} · ${aviso}: proveedor sin reconocer`;
}

interface PaginacionCandidatosProps {
  pagina: number;
  total: number;
  /** Lo dicen `previous` y `next` del servidor, no la cuenta: son lo que de verdad existe. */
  hayAnterior: boolean;
  haySiguiente: boolean;
  alCambiar: (pagina: number) => void;
}

function PaginacionCandidatos({ pagina, total, hayAnterior, haySiguiente, alCambiar }: PaginacionCandidatosProps) {
  const totalPaginas = Math.max(pagina, Math.ceil(total / TAMANO_PAGINA_CANDIDATOS));
  return (
    <nav className={styles.paginacion} aria-label="Páginas de cobros encontrados">
      <Boton
        variante="secundario"
        tamano="s"
        icono={<ChevronLeft size={15} aria-hidden="true" />}
        disabled={!hayAnterior}
        onClick={() => alCambiar(pagina - 1)}
      >
        Anterior
      </Boton>
      <span className={styles.textoPagina} aria-live="polite">
        Página {pagina} de {totalPaginas}
      </span>
      <Boton variante="secundario" tamano="s" disabled={!haySiguiente} onClick={() => alCambiar(pagina + 1)}>
        Siguiente
        <ChevronRight size={15} aria-hidden="true" />
      </Boton>
    </nav>
  );
}
