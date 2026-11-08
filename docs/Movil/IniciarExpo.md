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
- **Backend levantado** en Docker, sano y alcanzable desde el teléfono. Ver
  [Docker Desktop + WSL2](../Windows/Docker-Desktop-WSL2.md).

> `expo-secure-store` es un módulo nativo. Expo Go suele incluirlo; si tu
> versión no lo trae, genera una *development build*:
> `npx expo run:android` o `npx expo run:ios`.

## Configuración

1. Crea el archivo `.env` a partir del ejemplo:

```powershell
cd frontend\movil
Copy-Item .env.example .env
```

2. Escribe la URL del **gateway** en `EXPO_PUBLIC_API_URL`. No hay valor por
   defecto:

```dotenv
# Teléfono físico: IP LAN del equipo que corre Docker
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000/api

# Emulador Android
# EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/api

# Simulador iOS o Expo web
# EXPO_PUBLIC_API_URL=http://localhost:8000/api
```

> **Regla:** en un teléfono, `localhost` es el propio teléfono. Nunca uses
> `localhost` para llegar al backend desde un dispositivo físico. El detalle
> completo (IP, firewall, CORS, TLS y deep links) está en
> [Conectividad del móvil con el backend](Conectividad-Backend.md).

> **Sin secretos:** todo lo que empieza con `EXPO_PUBLIC_` queda escrito en el
> bundle. No pongas API keys, `JWT_SECRET`, contraseñas ni tokens en este
> archivo.

## Ejecución

Desde la carpeta `frontend`:

```powershell
npm install
npm run start --workspace=movil
```

Luego, abre la app en tu celular de una de estas formas:

- Escanea el **código QR** que aparece en la terminal.
- O copia la **URL de Metro** que se muestra en la terminal, por ejemplo:

```text
› Metro: exp://192.168.4.62:8081
```

> **Nota:** el celular y el computador deben estar conectados a la misma red
> Wi-Fi. Metro usa el puerto 8081 y el backend el 8000; ambos deben estar
> permitidos en el firewall para redes privadas.

## Probar la conexión

```powershell
# desde el PC
python scripts\verificar_servicios.py

# la misma URL que verá el teléfono, rechazando localhost
python scripts\e2e_movil_backend.py --desde-movil `
  --url http://192.168.1.20:8000/api
```

El detalle del contrato (login, JWT, refresh, 401 y recuperación con el
backend caído) está en [E2E móvil ↔ backend](E2E-Backend.md).

## Enlaces profundos

El esquema está declarado en `app.json`:

```text
ojoalgasto://verificar-correo?token=...
```

`App.tsx` lo conecta con React Navigation. Para probarlo:

```bash
npx uri-scheme open "ojoalgasto://verificar-correo?token=abc123" --android
```
