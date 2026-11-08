# Conectividad del móvil con el backend (VI-14)

La app Expo corre en el teléfono y el backend en Docker sobre el equipo de
desarrollo. El teléfono **nunca** debe usar `localhost`: en un teléfono,
`localhost` es el propio teléfono, no la máquina donde corre el backend. Este
documento fija la URL, el entorno, TLS, CORS y los deep links.

## 1. Elegir la URL correcta

| Escenario | URL de `EXPO_PUBLIC_API_URL` | Por qué |
|---|---|---|
| Teléfono físico en la misma Wi-Fi | `http://192.168.1.20:8000/api` | La IP LAN del equipo es alcanzable desde el teléfono |
| Emulador Android (AVD) | `http://10.0.2.2:8000/api` | `10.0.2.2` es el host visto desde el emulador |
| Simulador iOS | `http://192.168.1.20:8000/api` | La app rechaza `localhost` también en nativo; se usa la IP LAN del Mac |
| Navegador / Expo web | `http://localhost:8000/api` | El navegador corre en el mismo equipo |
| Producción | `https://api.ejemplo.cl/api` | La app rechaza `http` en producción |

La URL siempre termina en `/api`, que es la base del **gateway** (puerto 8000).
No se apunta directo a `auth:8001`, `analytics:8004` ni a ningún nombre de
contenedor: esos hosts sólo resuelven dentro de Docker.

### Obtener la IP LAN

```powershell
ipconfig
```

Buscar la tarjeta Wi-Fi/Ethernet activa y anotar **Dirección IPv4**, por
ejemplo `192.168.1.20`.

```bash
# macOS
ipconfig getifaddr en0
# Linux
hostname -I
```

El teléfono y el equipo deben estar en la **misma red**. Las redes de
invitados, el aislamiento de clientes (AP isolation) y algunas VPN bloquean la
comunicación entre dispositivos.

## 2. Configurar la app sin filtrar secretos

```powershell
cd frontend\movil
Copy-Item .env.example .env
```

Editar `frontend/movil/.env`:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000/api
```

`EXPO_PUBLIC_*` se incrusta en el bundle que se instala en el teléfono:
cualquiera puede leerlo. Por eso en ese archivo **no** van:

- `ANTHROPIC_API_KEY` ni claves de proveedores;
- `SECRET_KEY`, `JWT_SECRET` ni contraseñas de base;
- credenciales OAuth, tokens ni `usuario:contraseña@host`.

Los secretos viven sólo en el `.env` de la raíz, que leen los contenedores.
La app no tiene valor por defecto: si falta la variable, muestra una pantalla
de configuración con el motivo en vez de intentar `localhost` y parecer “sin
red”.

La URL se valida en `frontend/movil/src/config/api.ts`:

- exige `http://` o `https://`;
- rechaza `localhost`, `127.0.0.1`, `::1` y `0.0.0.0` en nativo;
- exige que el path sea exactamente `/api`;
- rechaza credenciales embebidas, query string y fragmento;
- en producción exige `https`.

## 3. CORS

Las apps nativas no envían `Origin` y no están sujetas a CORS. CORS importa
para **Expo web** y para la web React:

```dotenv
# .env de la raíz
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8081
```

- Agregar sólo orígenes reales, con esquema, host y puerto.
- No usar `*` junto con cookies o credenciales.
- En producción, el origen de la web pública (por ejemplo
  `https://app.ejemplo.cl`), no `localhost`.
- El gateway es el único que necesita CORS; los servicios internos no se
  exponen al navegador.

## 4. TLS en producción

En desarrollo se usa `http://` dentro de la LAN. En producción la app exige
`https://` y rechaza el texto plano antes de enviar credenciales.

Recomendaciones:

1. Terminar TLS en un reverse proxy (Caddy, Nginx, Traefik o el balanceador)
   delante del gateway.
2. Usar un certificado de una CA pública; el teléfono no confía en
   certificados autofirmados.
3. Redirigir `http` → `https` en el proxy.
4. No desactivar la validación de certificados en la app.
5. Si se prueba un certificado interno, instalar la CA de desarrollo **sólo**
   en el dispositivo de prueba, nunca en la build publicada.

## 5. Deep links

`app.json` declara el esquema:

```json
{ "expo": { "scheme": "ojoalgasto" } }
```

`App.tsx` configura React Navigation con ese esquema. Enlaces de ejemplo:

```text
ojoalgasto://login
ojoalgasto://registro
ojoalgasto://recuperar-contrasena
ojoalgasto://verificar-correo?token=abc123
```

El correo de verificación (MX-28) puede abrir la app con el token. En
producción, además del esquema propio, se pueden configurar *universal links*
(`https://app.ejemplo.cl/...`) con `expo-linking`; el esquema `ojoalgasto://`
sigue siendo el fallback.

Probar en Android:

```bash
npx uri-scheme open "ojoalgasto://verificar-correo?token=abc123" --android
```

## 6. Arranque y prueba

1. Backend sano:

   ```powershell
   docker compose up -d --build
   python scripts\verificar_servicios.py
   ```

2. Comprobar desde el **navegador del teléfono** que la IP responde:

   ```text
   http://192.168.1.20:8000/health/
   ```

   Si no abre, el problema es de red/firewall, no de la app.

3. Arrancar Expo en Windows:

   ```powershell
   cd frontend
   npm install
   npm run start --workspace=movil
   ```

4. Escanear el QR con Expo Go (o abrir el emulador). La app toma
   `EXPO_PUBLIC_API_URL` del `.env`.

5. Ejecutar el E2E contra la misma URL que verá el teléfono:

   ```powershell
   python scripts\e2e_movil_backend.py --desde-movil --url http://192.168.1.20:8000/api
   ```

   `--desde-movil` sólo exige que la URL sea alcanzable desde un teléfono (sin
   `localhost`) y ejecuta las comprobaciones HTTP desde el equipo de desarrollo.
   **No** instala ni abre la app, así que no valida SecureStore, login nativo ni
   la recuperación tras un 401. Eso se prueba aparte, con la app en un
   dispositivo físico o emulador.

## 7. Firewall de Windows

Docker Desktop publica los puertos en Windows. Si el teléfono no conecta pero
`localhost` sí:

1. Permitir Docker Desktop en el Firewall de Windows para redes privadas.
2. Verificar que la red Wi-Fi esté marcada como **Privada**, no Pública.
3. Abrir el puerto 8000 (y 8081 para Metro) sólo en la red local:

   ```powershell
   New-NetFirewallRule -DisplayName "OjoAlGasto backend" -Direction Inbound `
     -Protocol TCP -LocalPort 8000,8081 -Action Allow -Profile Private
   ```

No abrir estos puertos en el router hacia Internet.

## 8. Cuándo el backend está caído

La app distingue “sin red” de “sesión inválida”:

- **Sin red / timeout / 503:** conserva los tokens cifrados y muestra el error
  de conexión. No muestra datos de la sesión anterior como si fueran frescos.
- **401 del refresh:** descarta la sesión y vuelve al login.
- **Arranque sin backend:** hidrata los tokens cifrados, intenta renovar; si no
  puede, queda en login. No hay almacenamiento inseguro de respaldo.

Ver [E2E móvil ↔ backend](E2E-Backend.md) para el detalle del contrato y las
pruebas.

## 9. Errores típicos

| Mensaje / síntoma | Causa | Solución |
|---|---|---|
| `Falta EXPO_PUBLIC_API_URL` | No existe `frontend/movil/.env` | Copiar `.env.example` y completar la IP |
| `"localhost" en un teléfono apunta al propio teléfono` | URL con localhost en nativo | Usar IP LAN o `10.0.2.2` en Android |
| `debe terminar en /api` | Falta el path del gateway | Agregar `/api` al final |
| La app carga pero todo da error de red | Firewall o redes distintas | Probar `/health/` desde el navegador del teléfono |
| CORS bloquea sólo en Expo web | Origen no listado | Agregar el origen exacto a `CORS_ALLOWED_ORIGINS` |
| `Network request failed` en producción | URL `http://` | Usar `https://` con certificado válido |
