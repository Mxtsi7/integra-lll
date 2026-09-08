/**
 * Convierte cada .dc.html en un HTML autónomo, para verlo en el navegador
 * o exportarlo como imagen sin necesidad del canvas.
 *
 *   node generar-preview.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SALIDA = path.join(DIR, 'preview');

const PANTALLAS = [
  ['Main.dc.html', 'movil-panel', 'Móvil · Panel'],
  ['Alertas.dc.html', 'movil-alertas', 'Móvil · Alertas'],
  ['Detalle.dc.html', 'movil-detalle', 'Móvil · Detalle de suscripción'],
  ['Registrar.dc.html', 'movil-registrar', 'Móvil · Registrar suscripción'],
  ['WebPanel.dc.html', 'web-panel', 'Web · Panel'],
  ['WebConectar.dc.html', 'web-conectar', 'Web · Conectar cuentas'],
];

fs.mkdirSync(SALIDA, { recursive: true });

const entre = (txt, a, b) => {
  const i = txt.indexOf(a);
  const j = txt.indexOf(b, i);
  return i < 0 || j < 0 ? '' : txt.slice(i + a.length, j);
};

for (const [archivo, slug, titulo] of PANTALLAS) {
  const src = fs.readFileSync(path.join(DIR, archivo), 'utf8');
  const helmet = entre(src, '<helmet>', '</helmet>');
  const cuerpo = entre(src, '</helmet>', '</x-dc>');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${titulo} — Ojo al Gasto</title>
${helmet.trim()}
<style>
  html, body { margin: 0; padding: 0; background: #FBF9F5; }
  body > div { margin: 0 auto; }
</style>
</head>
<body>
${cuerpo.trim()}
</body>
</html>
`;
  fs.writeFileSync(path.join(SALIDA, slug + '.html'), html);
  console.log('  preview/' + slug + '.html');
}

console.log(`\n${PANTALLAS.length} pantallas en preview/`);
