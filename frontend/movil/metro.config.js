const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const raiz = path.resolve(__dirname, '..');

config.watchFolders = [raiz];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(raiz, 'node_modules'),
];

module.exports = config;
