const path = require('node:path');
(async () => {
  const { packager } = await import('@electron/packager');
  const salida = path.resolve(__dirname, 'release');
  if (path.relative(path.resolve(__dirname), salida) !== 'release') throw new Error('Salida fuera de desktop');
  await packager({ dir: __dirname, name: 'OjoAlGasto', platform: 'win32', arch: 'x64',
    electronVersion: require('electron/package.json').version, out: salida, overwrite: true, asar: true,
    ignore: /^\/(?:release|test)(?:\/|$)/ });
})().catch(error => { console.error(error); process.exit(1); });
