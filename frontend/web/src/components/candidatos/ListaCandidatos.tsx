import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatearFecha, formatearMonto, TAMANO_PAGINA_CANDIDATOS, type CandidatoDetectado } from '@ojoalgasto/shared';
import { Boton } from '../ui/Boton';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import type { CargaCandidatos } from './cargaCandidatos';
import type { ConfirmacionDeCandidatos, ResultadoConfirmacion } from './confirmacionCandidatos';
import styles from './ListaCandidatos.module.css';
import { sePuedeDecidir, type SeleccionDeCandidatos } from './seleccionCandidatos';

interface ListaCandidatosProps {
  carga: CargaCandidatos;
  pagina: number;
  alCambiarPagina: (pagina: number) => void;
  alReintentar: () => void;
  /** Sin esto la lista no tiene casillas ni barra de selección (S3-CH-07). */
  seleccion?: SeleccionDeCandidatos;
  /** Sin esto la lista no confirma ni muestra resultados (S3-CH-08). Necesita la selección. */
  confirmacion?: ConfirmacionDeCandidatos;
}

/**
 * S3-CH-04: la lista de cobros detectados en un archivo o un correo. Solo dibuja
 * lo que le llega: no sabe de dónde vienen los datos (eso lo hace useCandidatos),
 * así que se prueba con datos inventados.
 */
export function ListaCandidatos({ carga, pagina, alCambiarPagina, alReintentar, seleccion, confirmacion }: ListaCandidatosProps) {
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

  // El botón se deshabilita mientras se confirma y «Cerrar» desaparece al usarse: el foco queda en la lista.
  const confirmar = () => {
    confirmacion?.alConfirmar();
    llevarElFocoALaLista();
  };
  const cerrarResultado = () => {
    confirmacion?.alCerrarResultado();
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
      {confirmacion?.resultado && <ResultadoDeConfirmacion resultado={confirmacion.resultado} alCerrar={cerrarResultado} />}
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
            <BarraDeSeleccion seleccion={seleccion} confirmacion={confirmacion} alConfirmar={confirmar} />
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

function ItemCandidato({ candidato, seleccion }: { candidato: CandidatoDetectado; seleccion?: SeleccionDeCandidatos }) {
  // Sin proveedor se muestra lo que decía el archivo o el correo: inventar un nombre sería peor.
  const sinProveedor = candidato.servicio === null;
  const nombre = candidato.servicio ?? (candidato.servicio_texto || 'Cobro sin descripción');
  const pendienteDeAplicar = candidato.aplicacion === 'pendiente';
  return (
    <li className={styles.item}>
      {seleccion &&
        (sePuedeDecidir(candidato) ? (
          <input
            type="checkbox"
            className={styles.casilla}
            checked={seleccion.seleccionados.has(candidato.id)}
            onChange={() => seleccion.alAlternar(candidato.id)}
            aria-label={`Seleccionar ${nombre}, ${importeLegible(candidato)}, ${formatearFecha(candidato.fecha)}`}
          />
        ) : (
          // Un cobro ya resuelto no tiene casilla; el hueco mantiene alineados a los demás.
          <div className={styles.sinCasilla} aria-hidden="true" />
        ))}
      <div className={styles.contenido}>
        <div className={styles.cabecera}>
          <span className={styles.nombre}>{nombre}</span>
          <span className={styles.importe}>{importeLegible(candidato)}</span>
        </div>
        {sinProveedor && (
          <p className={styles.detalle}>
            {AVISO_DE_PROVEEDOR.get(candidato.servicio_resultado) ?? AVISO_DE_PROVEEDOR_GENERAL}
          </p>
        )}
        <p className={styles.detalle}>
          {candidato.origen_legible} · {formatearFecha(candidato.fecha)} · {candidato.tipo_mensaje_legible}
        </p>
        <p className={styles.estado}>
          {candidato.estado_legible}
          {pendienteDeAplicar && ' · orden pendiente de aplicar: todavía no hay suscripción ni cobro creados'}
        </p>
      </div>
    </li>
  );
}

/** S3-CH-07: elegir todos los de la página, cuántos hay elegidos y cuántos de ellos no se pueden confirmar. */
function BarraDeSeleccion({
  seleccion,
  confirmacion,
  alConfirmar,
}: {
  seleccion: SeleccionDeCandidatos;
  confirmacion?: ConfirmacionDeCandidatos;
  alConfirmar: () => void;
}) {
  const casillaDePagina = useRef<HTMLInputElement>(null);
  const cuantos = seleccion.seleccionados.size;
  const estanTodos = cuantos === seleccion.cantidadSeleccionable;
  const hayAlgunos = cuantos > 0 && !estanTodos;
  const confirmables = seleccion.idsParaConfirmar.length;
  const sinProveedor = cuantos - confirmables;

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
        <Boton variante="sutil" tamano="s" onClick={limpiar} disabled={confirmacion?.enCurso}>
          Limpiar selección
        </Boton>
      )}
      {confirmacion && (
        <Boton tamano="s" onClick={alConfirmar} disabled={confirmables === 0} cargando={confirmacion.enCurso}>
          {textoDelBotonConfirmar(confirmacion.enCurso, confirmables)}
        </Boton>
      )}
    </div>
  );
}

function textoDelBotonConfirmar(enCurso: boolean, confirmables: number): string {
  if (enCurso) return 'Confirmando…';
  if (confirmables === 0) return 'Confirmar';
  return confirmables === 1 ? 'Confirmar 1 cobro' : `Confirmar ${confirmables} cobros`;
}

/**
 * S3-CH-08: qué pasó con cada cobro. Solo se dice «confirmado» de los que el servidor respondió 200, y se
 * aclara que la orden queda pendiente: confirmar todavía no crea la suscripción ni el cobro.
 */
function ResultadoDeConfirmacion({ resultado, alCerrar }: { resultado: ResultadoConfirmacion; alCerrar: () => void }) {
  const total = resultado.resultados.length;
  const confirmados = resultado.resultados.filter((cobro) => cobro.tipo === 'confirmado').length;
  const huboFallos = confirmados < total;
  return (
    // Con fallos se anuncia como alerta; sin ellos, como aviso que no interrumpe.
    <div role={huboFallos ? 'alert' : 'status'} aria-label="Resultado de la confirmación" className={styles.resultado}>
      <p className={styles.resumenResultado}>{resumenDelResultado(confirmados, total)}</p>
      <ul className={styles.resultados}>
        {resultado.resultados.map((cobro) => (
          <li key={cobro.id}>
            <strong>{cobro.nombre}:</strong> {cobro.tipo === 'confirmado' ? 'confirmado' : cobro.mensaje}
          </li>
        ))}
      </ul>
      <Boton variante="sutil" tamano="s" onClick={alCerrar}>
        Cerrar
      </Boton>
    </div>
  );
}

function resumenDelResultado(confirmados: number, total: number): string {
  if (confirmados === 0) return total === 1 ? 'No se pudo confirmar el cobro.' : 'No se pudo confirmar ningún cobro.';
  const pendiente = 'Quedaron pendientes de aplicar: todavía no hay suscripción ni cobro creados.';
  if (confirmados === total) return `${confirmados === 1 ? 'Confirmaste 1 cobro.' : `Confirmaste ${confirmados} cobros.`} ${pendiente}`;
  return `Confirmaste ${confirmados} de ${total} cobros; el resto no se pudo. ${pendiente}`;
}

function textoDelConteo(cuantos: number, sinProveedor: number): string {
  if (cuantos === 0) return 'Ninguno seleccionado';
  const elegidos = cuantos === 1 ? '1 seleccionado' : `${cuantos} seleccionados`;
  if (sinProveedor === 0) return elegidos;
  const aviso = sinProveedor === 1 ? '1 no se puede confirmar' : `${sinProveedor} no se pueden confirmar`;
  return `${elegidos} · ${aviso}: proveedor sin reconocer`;
}

/** Más dígitos que estos no caben en un número sin perder precisión. */
const MAXIMO_DIGITOS_EXACTOS = 15;

/**
 * El importe como texto que llega de la API. Con un número y una moneda válidos
 * se da formato ("$5.900"); si no, se muestra tal cual. Un importe con más dígitos
 * que un número exacto se muestra también tal cual: formatearlo como número
 * inventaría los dígitos que se perdieron.
 */
function importeLegible({ importe, moneda }: CandidatoDetectado): string {
  const monto = Number(importe);
  const crudo = `${importe} ${moneda}`.trim();
  const digitos = importe.replace(/\D/g, '').length;
  if (importe.trim() === '' || !Number.isFinite(monto) || digitos > MAXIMO_DIGITOS_EXACTOS) return crudo;
  try {
    return formatearMonto(monto, moneda);
  } catch {
    // Intl rechaza un código de moneda que no existe: en ese caso se muestra el dato crudo.
    return crudo;
  }
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
