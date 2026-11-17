import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef } from 'react';
import { formatearFecha, formatearMonto, TAMANO_PAGINA_CANDIDATOS, type CandidatoDetectado } from '@ojoalgasto/shared';
import { Boton } from '../ui/Boton';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import type { CargaCandidatos } from './cargaCandidatos';
import styles from './ListaCandidatos.module.css';

interface ListaCandidatosProps {
  carga: CargaCandidatos;
  pagina: number;
  alCambiarPagina: (pagina: number) => void;
  alReintentar: () => void;
}

/**
 * S3-CH-04: la lista de cobros detectados en un archivo o un correo. Solo dibuja
 * lo que le llega: no sabe de dónde vienen los datos (eso lo hace useCandidatos),
 * así que se prueba con datos inventados.
 */
export function ListaCandidatos({ carga, pagina, alCambiarPagina, alReintentar }: ListaCandidatosProps) {
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

  return (
    <section
      ref={zona}
      tabIndex={-1}
      aria-label="Cobros encontrados"
      aria-busy={carga.tipo === 'cargando'}
      className={styles.lista}
    >
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
          <ol className={styles.items}>
            {carga.datos.results.map((candidato) => (
              <ItemCandidato key={candidato.id} candidato={candidato} />
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

function ItemCandidato({ candidato }: { candidato: CandidatoDetectado }) {
  // Sin proveedor se muestra lo que decía el archivo o el correo: inventar un nombre sería peor.
  const sinProveedor = candidato.servicio === null;
  const nombre = candidato.servicio ?? (candidato.servicio_texto || 'Cobro sin descripción');
  const pendienteDeAplicar = candidato.aplicacion === 'pendiente';
  return (
    <li className={styles.item}>
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
    </li>
  );
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
