import { ChevronLeft, ChevronRight, Pencil, Plus, Wallet } from 'lucide-react';
import { usePresupuestoMensual } from '../../hooks/usePresupuestoMensual';
import { useMesEnUrl } from '../../hooks/useMesEnUrl';
import { fechaATexto, mesDeFecha, sumarMeses } from '../../utils/calendario';
import { Boton } from '../ui/Boton';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import { ComparacionDelPresupuesto } from './ComparacionDelPresupuesto';
import { FormularioDePresupuesto } from './FormularioDePresupuesto';
import { montoDelServidor, nombreDelMes, tituloDelMes } from './presentacionDePresupuesto';
import styles from './Presupuesto.module.css';

/**
 * S3-CH-27: el presupuesto mensual del Panel: lo que se gastó y se espera gastar en un mes,
 * frente a lo que se definió (VI-05).
 *
 * La moneda es la del Panel y el mes vive en la URL (?mes=), igual que en el Calendario: al
 * recargar se queda en lo mismo, y cada moneda se mira por separado, nunca sumada con otra.
 */
export function SeccionPresupuesto({ moneda }: { moneda: string }) {
  const hoy = fechaATexto(new Date());
  const mesDeHoy = mesDeFecha(hoy);
  const { mes, irAMes } = useMesEnUrl(hoy);
  const { carga, reintentar, edicion, montoGuardado, abrirEdicion, cancelarEdicion, guardar } = usePresupuestoMensual(mes, moneda);
  const mesAnterior = sumarMeses(mes, -1);
  const mesSiguiente = sumarMeses(mes, 1);
  const presupuestoActual = carga.tipo === 'listo' ? carga.comparacion.presupuesto : null;

  return (
    <section className={`tile ${styles.tile}`} aria-label="Presupuesto del mes">
      <div className={styles.cabecera}>
        <span className={styles.icono}>
          <Wallet size={19} aria-hidden="true" />
        </span>
        <div className={styles.titulos}>
          <h2 className={styles.titulo}>Presupuesto</h2>
          <p className={styles.subtitulo}>Lo que esperas gastar, en {moneda}</p>
        </div>
      </div>

      <div className={styles.navegacion} role="group" aria-label="Cambiar de mes del presupuesto">
        <button type="button" className={styles.flecha} aria-label={`Mes anterior: ${nombreDelMes(mesAnterior)}`} onClick={() => irAMes(mesAnterior)}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <p className={styles.mes} aria-live="polite">
          {tituloDelMes(mes)}
        </p>
        <button type="button" className={styles.flecha} aria-label={`Mes siguiente: ${nombreDelMes(mesSiguiente)}`} onClick={() => irAMes(mesSiguiente)}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      {mes !== mesDeHoy && (
        <Boton variante="sutil" tamano="s" onClick={() => irAMes(mesDeHoy)}>
          Volver a {nombreDelMes(mesDeHoy)}
        </Boton>
      )}

      {carga.tipo === 'cargando' && <div className={styles.esqueleto} aria-busy="true" aria-label="Cargando el presupuesto" />}
      {carga.tipo === 'error' && <ErrorConReintento mensaje={carga.mensaje} onReintentar={reintentar} />}
      {carga.tipo === 'listo' && <ComparacionDelPresupuesto comparacion={carga.comparacion} />}

      <div role="status" className={styles.aviso}>
        {montoGuardado !== null && (
          <p>
            Guardamos tu presupuesto de {nombreDelMes(mes)}: {montoDelServidor(montoGuardado, moneda)}.
          </p>
        )}
      </div>

      {carga.tipo === 'listo' && edicion.tipo === 'cerrada' && (
        <Boton
          variante="secundario"
          tamano="s"
          icono={presupuestoActual === null ? <Plus size={15} aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />}
          onClick={abrirEdicion}
        >
          {presupuestoActual === null ? 'Definir presupuesto' : 'Editar presupuesto'}
        </Boton>
      )}
      {carga.tipo === 'listo' && edicion.tipo !== 'cerrada' && (
        <FormularioDePresupuesto
          mes={mes}
          moneda={moneda}
          montoActual={presupuestoActual}
          guardando={edicion.tipo === 'guardando'}
          errorDelServidor={edicion.tipo === 'abierta' ? edicion.error : null}
          alGuardar={guardar}
          alCancelar={cancelarEdicion}
        />
      )}
    </section>
  );
}
