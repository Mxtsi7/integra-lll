const fs = require('node:fs');
const path = require('node:path');
const destino = path.resolve(__dirname, 'renderer');
if (path.relative(path.resolve(__dirname), destino) !== 'renderer') throw new Error('Destino de build fuera de desktop');
fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(path.resolve(__dirname, '../web/dist'), destino, { recursive: true });
