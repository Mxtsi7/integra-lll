const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const {
  configurarApi,
  esInterna,
  resolverArchivo,
  politicaCSP,
  DIMENSIONES_VENTANA,
  obtenerRutaInicial,
} = require('../seguridad.cjs');

test('SE-04: navegación a rutas del calendario se mantiene en el origen interno app://ojoalgasto', () => {
  // Rutas válidas de calendario y agenda en web reutilizadas en desktop
  assert.ok(esInterna('app://ojoalgasto/calendario'));
  assert.ok(esInterna('app://ojoalgasto/calendario/agenda'));
  assert.ok(esInterna('app://ojoalgasto/calendario?mes=2026-11'));
  assert.ok(esInterna('app://ojoalgasto/calendario/agenda?mes=2026-12'));

  // Rechazo de orígenes externos o protocolos no autorizados al intentar acceder al calendario
  for (const url of [
    'https://ojoalgasto/calendario',
    'http://ojoalgasto/calendario',
    'file:///calendario',
    'app://malicioso/calendario',
    'app://usuario:clave@ojoalgasto/calendario',
    'app://ojoalgasto:8080/calendario',
    'javascript:alert("calendario")',
  ]) {
    assert.equal(esInterna(url), false, `Debe rechazar URL: ${url}`);
  }
});

test('SE-04: obtenerRutaInicial permite abrir directamente en /calendario sin hardcoding', () => {
  // Por defecto abre en /login
  assert.equal(obtenerRutaInicial([], {}), '/login');

  // Vía argumento de línea de comandos --ruta
  assert.equal(obtenerRutaInicial(['--ruta=/calendario'], {}), '/calendario');
  assert.equal(
    obtenerRutaInicial(['--ruta=/calendario?mes=2026-11'], {}),
    '/calendario?mes=2026-11'
  );
  assert.equal(
    obtenerRutaInicial(['--ruta=/calendario/agenda'], {}),
    '/calendario/agenda'
  );

  // Vía variable de entorno DESKTOP_RUTA
  assert.equal(
    obtenerRutaInicial([], { DESKTOP_RUTA: '/calendario' }),
    '/calendario'
  );
  assert.equal(
    obtenerRutaInicial([], { DESKTOP_RUTA: '/calendario/agenda?mes=2026-10' }),
    '/calendario/agenda?mes=2026-10'
  );

  // Argumento CLI tiene prioridad sobre variable de entorno
  assert.equal(
    obtenerRutaInicial(['--ruta=/calendario/agenda'], { DESKTOP_RUTA: '/calendario' }),
    '/calendario/agenda'
  );

  // Rutas maliciosas o con esquemas externos se rechazan
  for (const rutaInvalida of [
    'https://externo.test/calendario',
    'http://127.0.0.1:8000/api',
    'javascript:alert(1)',
    '//otro-dominio/calendario',
    'app://otro/calendario',
  ]) {
    assert.throws(
      () => obtenerRutaInicial([`--ruta=${rutaInvalida}`], {}),
      /Ruta inicial de desktop no autorizada/,
      `Debe rechazar ruta: ${rutaInvalida}`
    );
  }
});

test('SE-04: resolución de rutas del calendario en el renderer (SPA)', () => {
  const raiz = path.resolve('renderer');
  
  // Las rutas de calendario resuelven dentro del renderer
  const destinoCalendario = resolverArchivo(raiz, 'app://ojoalgasto/calendario');
  assert.equal(destinoCalendario, path.join(raiz, 'calendario'));

  const destinoAgenda = resolverArchivo(raiz, 'app://ojoalgasto/calendario/agenda');
  assert.equal(destinoAgenda, path.join(raiz, 'calendario/agenda'));

  // Al no tener extensión física (.js, .css), el protocolo 'app:' de Electron
  // entrega index.html para que React Router monte la vista de CalendarioPage / AgendaPage.
  assert.equal(path.extname(destinoCalendario), '');
  assert.equal(path.extname(destinoAgenda), '');

  // Los escapes de directorio se bloquean
  assert.throws(() => resolverArchivo(raiz, 'app://ojoalgasto/%2e%2e%2fcalendario'));
});

test('SE-04: red y CSP autorizan consultas del calendario al backend real', () => {
  const apiUrl = 'http://127.0.0.1:8015/api';
  const csp = politicaCSP(apiUrl);

  // La CSP debe autorizar conexiones al origen de la API configurada
  assert.ok(
    csp.includes('connect-src http://127.0.0.1:8015;'),
    'La CSP debe incluir connect-src con el origen de la API'
  );

  // No debe permitir comodines ni eval
  assert.ok(!csp.includes('connect-src *'), 'No se permite connect-src wildcard');
  assert.ok(!csp.includes('unsafe-eval'), 'No se permite unsafe-eval');
});

test('SE-04: dimensiones de ventana y responsividad del calendario', () => {
  // Dimensiones configuradas en el cliente desktop
  assert.equal(DIMENSIONES_VENTANA.width, 1280);
  assert.equal(DIMENSIONES_VENTANA.height, 800);
  assert.equal(DIMENSIONES_VENTANA.minWidth, 900);
  assert.equal(DIMENSIONES_VENTANA.minHeight, 650);

  // El diseño del calendario (CH-18 a CH-20) requiere:
  // - En minWidth: 900px, 7 columnas disponen de >100px por columna (900 - margen lateral ~80 = ~820 / 7 ≈ 117px).
  // - En width: 1280px (predeterminado), las 7 columnas tienen ~170px por columna, cabiendo 2 cobros por día sin truncar.
  // - El punto de quiebre para colocar el detalle del día en columna lateral es 1440px:
  //   tanto en 900px como en 1280px el detalle se ubica ergonómicamente abajo, preservando ancho para nombres de cobros.
  const anchoMinimoColumnas = (DIMENSIONES_VENTANA.minWidth - 100) / 7;
  assert.ok(anchoMinimoColumnas >= 100, 'Las columnas deben tener suficiente ancho en el tamaño mínimo');
});

test('SE-04: no mantiene un segundo cálculo de fechas en el shell desktop', () => {
  // El shell desktop no debe contener lógica duplicada de fechas (como sumarMeses, parsear fechas o formatear).
  // Todo el cálculo reside en @ojoalgasto/shared y web/src/utils/calendario.ts.
  const archivosDesktop = fs.readdirSync(path.resolve(__dirname, '..'));
  
  // Verificamos que desktop solo contiene los archivos del shell Electron
  const archivosEsperados = new Set([
    'main.cjs',
    'preload.cjs',
    'seguridad.cjs',
    'preparar.cjs',
    'empaquetar.cjs',
    'package.json',
    'README.md',
    'test',
    'renderer',
    'release',
  ]);

  for (const archivo of archivosDesktop) {
    assert.ok(
      archivosEsperados.has(archivo),
      `Archivo no esperado en desktop (posible lógica duplicada): ${archivo}`
    );
  }

  // Verificamos que ni en seguridad.cjs ni en main.cjs hay lógica de cálculo de calendario
  const contenidoSeguridad = fs.readFileSync(path.resolve(__dirname, '../seguridad.cjs'), 'utf8');
  const contenidoMain = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');

  assert.ok(!contenidoSeguridad.includes('sumarMeses'), 'seguridad.cjs no debe recalcular fechas');
  assert.ok(!contenidoMain.includes('sumarMeses'), 'main.cjs no debe recalcular fechas');
  assert.ok(!contenidoSeguridad.includes('new Date('), 'seguridad.cjs no debe crear instancias de Date de negocio');
});
