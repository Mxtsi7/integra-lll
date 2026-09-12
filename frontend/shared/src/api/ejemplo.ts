/**
 * Datos de ejemplo para desarrollar las pantallas mientras el servicio
 * `subscriptions` no expone el endpoint. Cubren los cinco estados y varias
 * categorías, para que el panel tenga algo real que mostrar.
 *
 * No son datos de prueba del backend ni de ninguna persona.
 */

import type { Suscripcion } from '../tipos';

export const SUSCRIPCIONES_DE_EJEMPLO: Suscripcion[] = [
  {
    id: 'a1',
    nombre: 'Netflix',
    monto: 9990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-05',
    categoria: 'streaming',
    estado: 'activo',
    horas_uso_mes: 18,
  },
  {
    id: 'a2',
    nombre: 'Spotify',
    monto: 4990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-09-28',
    categoria: 'musica',
    estado: 'activo',
    horas_uso_mes: 40,
  },
  {
    id: 'a3',
    nombre: 'Gimnasio',
    monto: 25000,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-01',
    categoria: 'salud',
    estado: 'fantasma',
    horas_uso_mes: 0,
  },
  {
    id: 'a4',
    nombre: 'iCloud',
    monto: 1290,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-09-20',
    categoria: 'nube',
    estado: 'activo',
    horas_uso_mes: 2,
  },
  {
    id: 'a5',
    nombre: 'Duolingo',
    monto: 6990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-09-25',
    categoria: 'educacion',
    estado: 'prueba',
    fin_prueba: '2026-09-25',
    horas_uso_mes: 3,
  },
  {
    id: 'a6',
    nombre: 'Canva',
    monto: 59990,
    moneda: 'CLP',
    frecuencia: 'anual',
    fecha_proximo_cobro: '2027-03-14',
    categoria: 'productividad',
    estado: 'por_confirmar',
  },
  {
    id: 'a7',
    nombre: 'Disney+',
    monto: 8990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-08-10',
    categoria: 'streaming',
    estado: 'cancelado',
  },
];
