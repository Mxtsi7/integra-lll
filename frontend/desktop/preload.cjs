const { contextBridge } = require('electron');
const argumento = process.argv.find(valor => valor.startsWith('--ojo-api-url='));
if (!argumento) throw new Error('Falta configuración de API desktop');
contextBridge.exposeInMainWorld('ojoDesktop', Object.freeze({ apiUrl: decodeURIComponent(argumento.slice('--ojo-api-url='.length)) }));
