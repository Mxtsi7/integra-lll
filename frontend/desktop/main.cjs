const { app, BrowserWindow, net, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { configurarApi, esInterna, resolverArchivo, politicaCSP } = require('./seguridad.cjs');
const humo = process.argv.includes('--smoke-test');
const apiUrl = configurarApi(process.env.DESKTOP_API_URL);
const renderer = path.join(__dirname, 'renderer');
app.setName('Ojo al Gasto');
if (humo) {
  const perfil = path.join(app.getPath('temp'), 'ojoalgasto-smoke-' + process.pid);
  fs.mkdirSync(perfil, { recursive: true });
  app.setPath('userData', perfil);
  setTimeout(() => { console.error('Timeout de prueba desktop'); app.exit(1); }, 30000).unref();
}
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (humo) app.disableHardwareAcceleration();

async function abrir() {
  protocol.handle('app', async request => {
    let archivo;
    try { archivo = resolverArchivo(renderer, request.url); }
    catch { return new Response('Ruta no autorizada', { status: 403 }); }
    if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) {
      if (path.extname(archivo)) return new Response('Archivo no encontrado', { status: 404 });
      archivo = path.join(renderer, 'index.html');
    }
    const respuesta = await net.fetch(pathToFileURL(archivo).href);
    const headers = new Headers(respuesta.headers);
    headers.set('Content-Security-Policy', politicaCSP(apiUrl));
    return new Response(respuesta.body, { status: respuesta.status, headers });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permiso, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const ventana = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 650,
    title: 'Ojo al Gasto', show: !humo, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: !humo,
      additionalArguments: ['--ojo-api-url=' + encodeURIComponent(apiUrl)] } });
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const evento of ['will-navigate', 'will-redirect']) {
    ventana.webContents.on(evento, (e, url) => { if (!esInterna(url)) e.preventDefault(); });
  }
  await ventana.loadURL('app://ojoalgasto/login');
  if (humo) {
    const resultado = await ventana.webContents.executeJavaScript(`(async () => {
      for (let i=0; i<100 && !document.querySelector('#raiz')?.children.length; i++) await new Promise(r=>setTimeout(r,50));
      const respuesta = await fetch(new URL('/health/', window.ojoDesktop.apiUrl));
      return { plataforma: navigator.platform, renderer: !!document.querySelector('#raiz')?.children.length,
        nodeAislado: typeof window.require === 'undefined' && typeof window.process === 'undefined',
        apiUrl: window.ojoDesktop.apiUrl, estadoApi: respuesta.status, api: await respuesta.json() };
    })()`);
    const archivo = process.env.DESKTOP_SMOKE_OUTPUT || path.join(process.cwd(), 'smoke-desktop.json');
    fs.writeFileSync(archivo, JSON.stringify(resultado, null, 2));
    fs.writeFileSync(archivo.replace(/\.json$/, '.png'), (await ventana.webContents.capturePage()).toPNG());
    if (!resultado.renderer || !resultado.nodeAislado || resultado.estadoApi !== 200) throw new Error('Falló comprobación desktop');
    app.exit(0);
  }
}

app.whenReady().then(abrir).catch(error => { console.error(error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
