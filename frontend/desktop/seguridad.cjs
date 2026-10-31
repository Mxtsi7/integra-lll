const path = require('node:path');

function configurarApi(valor = 'http://localhost:8000/api') {
  const url = new URL(valor);
  if (url.username || url.password || url.search || url.hash || !url.hostname
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      || url.pathname.replace(/\/+$/, '') !== '/api') {
    throw new Error('DESKTOP_API_URL debe ser HTTPS o HTTP loopback, terminar en /api y no contener credenciales/query.');
  }
  return url.href.replace(/\/+$/, '');
}

function esInterna(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'app:' && url.hostname === 'ojoalgasto' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function resolverArchivo(raiz, valor) {
  if (!esInterna(valor)) throw new Error('Origen de navegación no autorizado');
  const nombre = decodeURIComponent(new URL(valor).pathname);
  if (nombre.includes('\0') || nombre.includes('\\')) throw new Error('Ruta inválida');
  const destino = path.resolve(raiz, '.' + nombre);
  const relativo = path.relative(path.resolve(raiz), destino);
  if (relativo === '..' || relativo.startsWith('..' + path.sep) || path.isAbsolute(relativo)) throw new Error('Ruta fuera del renderer');
  return destino;
}

function politicaCSP(apiUrl) {
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ${new URL(apiUrl).origin}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'`;
}

module.exports = { configurarApi, esInterna, resolverArchivo, politicaCSP };
