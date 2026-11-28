import { useEffect } from 'react';
import { AppState } from 'react-native';
import { cicloUsoAndroid, detenerUsoAndroid } from './usoAndroidSincronizacion';

export function useRecolectorAndroid() {
  useEffect(() => {
    let montado = true;
    const ejecutar = () => {
      if (montado && AppState.currentState === 'active') void cicloUsoAndroid().catch(() => {});
    };
    ejecutar();
    const intervalo = setInterval(ejecutar, 30_000);
    const escucha = AppState.addEventListener('change', estado => { if (estado === 'active') ejecutar(); });
    return () => { montado = false; clearInterval(intervalo); escucha.remove(); detenerUsoAndroid(); };
  }, []);
}
