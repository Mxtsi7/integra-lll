/**
 * Pantalla de arranque. Existe para demostrar que la web importa desde
 * @ojoalgasto/shared y que el workspace funciona; el Home real la reemplaza
 * (ver docs/mockup/capturas/web-panel.png).
 */

import {
  costoPorHora,
  formatearFecha,
  formatearMonto,
  gastoProyectado,
  getSuscripciones,
  type Suscripcion,
} from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';

export function App() {
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);

  useEffect(() => {
    getSuscripciones().then(setSuscripciones);
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 720 }}>
      <h1>Ojo al Gasto</h1>
      <p>
        Gasto mensual proyectado: <strong>{formatearMonto(gastoProyectado(suscripciones))}</strong>
      </p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th align="left">Suscripción</th>
            <th align="right">Monto</th>
            <th align="left">Próximo cobro</th>
            <th align="left">Estado</th>
            <th align="right">Costo por hora</th>
          </tr>
        </thead>
        <tbody>
          {suscripciones.map((s) => {
            const porHora = costoPorHora(s.monto, s.horas_uso_mes ?? 0);
            return (
              <tr key={s.id}>
                <td>{s.nombre}</td>
                <td align="right">{formatearMonto(s.monto, s.moneda)}</td>
                <td>{formatearFecha(s.fecha_proximo_cobro)}</td>
                <td>{s.estado}</td>
                <td align="right">{porHora === null ? 'sin uso' : formatearMonto(porHora, s.moneda)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
