# App móvil

## Requisitos

- **Node.js** `22.23.3`
```bash
  nvm install 22
  nvm use 22
```
- **Expo Go** en tu celular:
  - [App Store (iOS)](https://apps.apple.com/app/expo-go/id982107779)
  - [Google Play (Android)](https://play.google.com/store/apps/details?id=host.exp.exponent)

## Configuración

1. Crea el archivo `.env` a partir del ejemplo. Basta con copiar `.env.example` de la carpeta `movil` y quitarle el `.example`:
```bash
   cd movil
   cp .env.example .env
```

## Ejecución

Desde la carpeta `Frontend`:

```bash
npm run start --workspace=movil
```

Luego, abre la app en tu celular de una de estas formas:

- Escanea el **código QR** que aparece en la terminal.
- O copia la **URL de Metro** que se muestra en la terminal, por ejemplo:

``` › Metro: exp://192.168.4.62:8081```

> **Nota:** el celular y el computador deben estar conectados a la misma red Wi-Fi.
