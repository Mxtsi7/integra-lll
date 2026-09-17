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
 
import { Sidebar, type NavItem } from './components/sidebar';
import Footer from './components/footer';
import Homepage, { type Stat, type Subscription, type Transaction } from './pages/homepage';
 
const NAV_ITEMS: NavItem[] = [
  { key: 'panel', label: 'Panel' },
  { key: 'calendario', label: 'Calendario de pagos' },
  { key: 'recomendaciones', label: 'Recomendaciones' },
  { key: 'cuentas', label: 'Cuentas conectadas' },
  { key: 'informes', label: 'Informes' },
  { key: 'configuracion', label: 'Configuración' },
];
 
// TODO: reemplazar cuando @ojoalgasto/shared exponga getTransacciones()
const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 't1', name: 'Suscripción Netflix', date: 'Hoy, 10:45 AM', category: 'Entretenimiento', amount: '-17,99 €' },
  { id: 't2', name: 'Cafetería La Linda', date: 'Ayer, 04:30 PM', category: 'Alimentación', amount: '-3,50 €' },
  { id: 't3', name: 'Spotify Premium', date: '24 Octubre', category: 'Entretenimiento', amount: '-10,99 €' },
];
 
const DIAS_ALERTA_COBRO = 7;
 
function esCobroProximo(fechaProximoCobro: string, dias: number): boolean {
  const hoy = new Date();
  const cobro = new Date(fechaProximoCobro);
  const diffMs = cobro.getTime() - hoy.getTime();
  const diffDias = diffMs / (1000 * 60 * 60 * 24);
  return diffDias >= 0 && diffDias <= dias;
}
 
/** Convierte una Suscripcion de @ojoalgasto/shared al shape que espera el PanelView */
function mapSuscripcionToSubscription(s: Suscripcion): Subscription {
  return {
    id: s.id,
    name: s.nombre,
    initial: s.nombre.charAt(0).toUpperCase(),
    nextCharge: `Próximo cobro: ${formatearFecha(s.fecha_proximo_cobro)}`,
    price: `${formatearMonto(s.monto, s.moneda)}/mes`,
    alert: s.estado === 'activa' && esCobroProximo(s.fecha_proximo_cobro, DIAS_ALERTA_COBRO),
  };
}
 
/** Arma las 3 tarjetas de stats a partir de las suscripciones reales */
function buildStats(suscripciones: Suscripcion[]): Stat[] {
  const moneda = suscripciones[0]?.moneda;
 
  const proximas = suscripciones.filter((s) => esCobroProximo(s.fecha_proximo_cobro, DIAS_ALERTA_COBRO));
  const totalProximos = proximas.reduce((acc, s) => acc + s.monto, 0);
 
  return [
    {
      label: 'TOTAL GASTADO ESTE MES',
      value: formatearMonto(gastoProyectado(suscripciones), moneda),
      // TODO: comparar contra el mes anterior cuando haya histórico disponible
      footnote: 'Basado en tus suscripciones activas',
    },
    {
      label: `PRÓXIMOS COBROS (${DIAS_ALERTA_COBRO} DÍAS)`,
      value: formatearMonto(totalProximos, moneda),
      footnote: `${proximas.length} suscripciones pendientes de cobro`,
      highlight: true,
    },
    {
      label: 'AHORRO ESTIMADO',
      // TODO: no hay función de ahorro en @ojoalgasto/shared todavía
      value: '—',
      footnote: 'Próximamente',
    },
  ];
}
 
type ViewKey = string;
 
export function App() {
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [selected, setSelected] = useState<ViewKey>('panel');
 
  useEffect(() => {
    getSuscripciones()
      .then(setSuscripciones)
      .finally(() => setCargando(false));
  }, []);
 
  const subscriptions = suscripciones.map(mapSuscripcionToSubscription);
  const stats = buildStats(suscripciones);
  const selectedItem = NAV_ITEMS.find((item) => item.key === selected);
 
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        margin: 0,
      }}
    >
      <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
        <Sidebar items={NAV_ITEMS} selected={selected} onSelect={setSelected} />
 
        {selected === 'panel' ? (
          cargando ? (
            <main
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Courier New', Courier, monospace",
                color: '#8a95b3',
              }}
            >
              Cargando tus suscripciones…
            </main>
          ) : (
            <Homepage
              stats={stats}
              subscriptions={subscriptions}
              transactions={MOCK_TRANSACTIONS}
            />
          )
        ) : (
          <main
            style={{
              flex: 1,
              padding: '40px 48px',
              fontFamily: "'Courier New', Courier, monospace",
              color: '#8a95b3',
            }}
          >
            <h1 style={{ color: '#1e2a4a' }}>{selectedItem?.label}</h1>
            <p>Esta sección todavía no está conectada.</p>
          </main>
        )}
      </div>
 
      <Footer />
    </div>
  );
}
