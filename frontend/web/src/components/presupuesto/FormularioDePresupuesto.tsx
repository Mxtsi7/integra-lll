import { useRef, useState, type FormEvent } from 'react';
import { Boton } from '../ui/Boton';
import { CampoTexto } from '../ui/Campo';
import { leerMontoEscrito, montoParaEditar } from './montoDePresupuesto';
import { nombreDelMes } from './presentacionDePresupuesto';
import styles from './Presupuesto.module.css';

interface FormularioDePresupuestoProps {
  mes: string;
  moneda: string;
  /** El monto que hay guardado para ese mes y moneda, o null si todavía no hay presupuesto. */
  montoActual: string | null;
  guardando: boolean;
  /** Lo que respondió el servidor al último intento de guardar, si lo rechazó. */
  errorDelServidor: string | null;
  /** Recibe el monto ya leído y validado: texto decimal con punto. */
  alGuardar: (monto: string) => void;
  alCancelar: () => void;
}

/**
 * S3-CH-27: define o cambia el presupuesto de UN mes en UNA moneda. El mes y la moneda no se
 * eligen aquí sino arriba, en los mismos filtros con que se ve la comparación: así no se puede
 * guardar en pesos mientras se mira dólares. El monto se valida antes de salir; lo que el
 * servidor rechaza se muestra igual, junto al campo.
 */
export function FormularioDePresupuesto({
  mes,
  moneda,
  montoActual,
  guardando,
  errorDelServidor,
  alGuardar,
  alCancelar,
}: FormularioDePresupuestoProps) {
  const [textoDelMonto, setTextoDelMonto] = useState(montoActual === null ? '' : montoParaEditar(montoActual));
  const [errorDelMonto, setErrorDelMonto] = useState<string | null>(null);
  const formulario = useRef<HTMLFormElement>(null);

  function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const lectura = leerMontoEscrito(textoDelMonto);
    if (!lectura.valido) {
      setErrorDelMonto(lectura.mensaje);
      // El foco vuelve al campo para que quien usa teclado o lector de pantalla oiga el motivo.
      formulario.current?.querySelector('input')?.focus();
      return;
    }
    setErrorDelMonto(null);
    alGuardar(lectura.monto);
  }

  return (
    <form ref={formulario} className={styles.formulario} onSubmit={guardar} noValidate>
      <CampoTexto
        etiqueta={`Presupuesto de ${nombreDelMes(mes)} en ${moneda}`}
        ayuda="Solo números, sin separador de miles. Hasta 8 dígitos y 2 decimales."
        error={errorDelMonto ?? errorDelServidor ?? undefined}
        value={textoDelMonto}
        onChange={(evento) => {
          setTextoDelMonto(evento.target.value);
          setErrorDelMonto(null);
        }}
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        disabled={guardando}
      />
      <div className={styles.accionesDelFormulario}>
        <Boton type="submit" tamano="s" cargando={guardando}>
          Guardar
        </Boton>
        <Boton variante="sutil" tamano="s" onClick={alCancelar} disabled={guardando}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
