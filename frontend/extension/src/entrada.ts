import { conectarSincronizacion, coordinarMedicion } from './background.js';
import { crearSincronizacionNavegador } from './sincronizacion';
declare const chrome: any;
conectarSincronizacion(crearSincronizacionNavegador(chrome, coordinarMedicion));
