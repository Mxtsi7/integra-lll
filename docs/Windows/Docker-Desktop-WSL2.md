# Windows 10/11 · Docker Desktop + WSL2

Guía versionada para levantar el backend completo en Windows. El objetivo es
que una persona nueva llegue de cero a **todos los servicios sanos** con
comandos reproducibles, sin instalar Python, PostgreSQL ni RabbitMQ en Windows.

> **Alcance.** El backend corre dentro de Docker. La app móvil **no** va dentro
> de Docker: Metro/Expo corre en Windows y el teléfono consume el gateway por la
> red local. Son dos arranques separados (ver
> [Conectividad del móvil](../Movil/Conectividad-Backend.md)).

## Versiones con las que se validó

| Componente | Versión observada | Cómo comprobarla |
|---|---|---|
| Windows | 10/11 con virtualización activa | `systeminfo` |
| WSL | 2.7.14.0 | `wsl --version` |
| Kernel de WSL | 6.18.33.2 | `wsl --version` |
| Docker Engine | 29.7.2 | `docker version` |
| Docker Compose | v5.5.1 | `docker compose version` |
| Python (sólo scripts del repo) | 3.12 | `python --version` |

Docker Desktop debe usar el **motor WSL2** y traer un Engine 29.x. Las imágenes
del proyecto están fijadas en `docker-compose.yml` (`postgres:16-alpine`,
`rabbitmq:3.13-management-alpine`, `redis:7-alpine`); no se cambian a mano.

## 1. Requisitos de Windows

1. Windows 10 22H2 o Windows 11, 64 bits.
2. Virtualización habilitada en la BIOS/UEFI (VT-x/AMD-V).
3. 8 GB de RAM recomendados (Docker Desktop + Metro + navegador).
4. Git para Windows.

Comprobar la virtualización:

```powershell
systeminfo | Select-String "Virtualization"
```

Debe decir `Enabled` o `Habilitado`. Si dice `Disabled`, hay que activarla en
la BIOS antes de continuar.

## 2. Instalar WSL2

En PowerShell **como administrador**:

```powershell
wsl --install
wsl --update
wsl --set-default-version 2
```

Reiniciar si Windows lo pide. Verificar:

```powershell
wsl --status
wsl --version
wsl --list --verbose
```

La distribución (por ejemplo `Ubuntu-24.04`) debe mostrar `VERSION 2`. Si una
distro quedó en versión 1:

```powershell
wsl --set-version Ubuntu-24.04 2
```

## 3. Instalar y configurar Docker Desktop

1. Descargar Docker Desktop desde <https://www.docker.com/products/docker-desktop/>.
2. Instalar con la opción **Use WSL 2 instead of Hyper-V**.
3. Abrir Docker Desktop y esperar a que el motor diga **Running**.
4. En *Settings → General*: activar **Use the WSL 2 based engine**.
5. En *Settings → Resources → WSL Integration*: activar la distro que se use.
6. En *Settings → Resources*: dejar al menos 4 GB de RAM y 2 CPUs.

Verificar desde PowerShell:

```powershell
docker version
docker compose version
docker run --rm hello-world
docker context show
```

`docker context show` debe devolver `desktop-linux`. Si `docker version` falla
con `open //./pipe/dockerDesktopLinuxEngine`, Docker Desktop no está abierto o
el motor WSL2 no terminó de arrancar; no es un problema del repositorio.

## 4. Ubicación del repositorio y volúmenes

Clonar en una ruta local corta, **fuera de OneDrive, Dropbox o una unidad de
red**:

```powershell
New-Item -ItemType Directory -Force C:\dev | Out-Null
cd C:\dev
git clone https://github.com/Mxtsi7/integra-lll.git
cd integra-lll
```

Por qué importa:

- Los bind mounts de Docker Desktop cruzan de Windows a Linux. OneDrive puede
  bloquear archivos mientras sincroniza y el *hot reload* se vuelve errático.
- Las rutas con espacios o acentos funcionan, pero complican los comandos.
- Si el repo ya está en OneDrive, excluir la carpeta de la sincronización o
  aceptar que el arranque será más lento. No mover archivos con el stack
  levantado.

En `docker-compose.yml` los volúmenes son **relativos** (`./services/auth`).
No reemplazarlos por rutas absolutas de Windows (`C:\...`): dentro del
contenedor Linux no existen.

## 5. Archivo `.env`

```powershell
Copy-Item .env.example .env
```

El `.env` de la raíz es para los servicios y **nunca** se versiona. Revisar como
mínimo:

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
JWT_SECRET=cambiar-por-una-clave-larga-y-aleatoria
SESSION_REDIS_URL=redis://redis:6379/2
```

Reglas:

- `JWT_SECRET` debe ser **idéntico** en `auth` y `gateway`; ambos leen el mismo
  `.env`, así que no se duplica.
- `ANTHROPIC_API_KEY` puede quedar vacía: Analytics degrada a un resumen local
  en vez de fallar. Si se pone una clave real, vive sólo en este `.env`.
- `CLAVES_CIFRADO` es para cifrar tokens de conectores. Se puede dejar vacía en
  desarrollo local; el servicio lo indica al conectar OAuth.
- No poner secretos en `frontend/movil/.env`: todo lo que empieza con
  `EXPO_PUBLIC_` queda escrito en el bundle del teléfono.

## 6. Levantar el backend

Desde la raíz del repo:

```powershell
docker compose up -d --build
```

La primera vez descarga imágenes y construye 7 imágenes; puede tardar varios
minutos. Las siguientes veces es mucho más rápido. El orden lo impone Compose:
Postgres, RabbitMQ y Redis sanos → servicios de dominio → gateway. Los
`entrypoint.sh` aplican las migraciones de cada esquema antes de servir.

Comprobar el estado:

```powershell
docker compose ps
```

Todos los servicios HTTP y workers deben quedar `healthy`; `subscriptions-beat`
y `frontend` quedan `running` porque no exponen un canal de salud (no se finge
un `healthy` que no se puede comprobar). Si alguno queda `unhealthy`, ver la
sección de problemas.

### Verificación automática

```powershell
python scripts\verificar_compose.py          # valida el YAML sin daemon
python scripts\verificar_servicios.py        # espera los 6 /health/ y prueba el gateway
```

`verificar_servicios.py` comprueba:

- `http://localhost:8000-8005/health/` con HTTP 200 real;
- que el gateway, sin token, responda **401** en `/api/usuarios/me/` (prueba de
  que enruta y valida el JWT, no que deja pasar);
- que los 15 contenedores esperados estén presentes y en el estado esperado.

Para un arranque limpio y la verificación en un solo paso:

```powershell
python scripts\verificar_servicios.py --compose-up --timeout 300
```

### Prueba de reinicio (VI-13)

```powershell
docker compose restart
python scripts\verificar_servicios.py --timeout 180
```

Un reinicio no debe perder datos ni exigir migraciones a mano: los volúmenes
`datos_postgres` se conservan y `migrate` es idempotente. Para probar desde
cero, incluida la creación de esquemas:

```powershell
docker compose down -v
docker compose up -d --build
python scripts\verificar_servicios.py --timeout 300
```

`down -v` **borra la base**. El seed de desarrollo vuelve a crear el usuario
`demo@ojoalgasto.cl` al arrancar `auth`.

## 7. Backend separado del ejecutable de Windows

El backend no se ejecuta con `python manage.py runserver` en Windows. Ese
comando se corre **dentro** del contenedor, y Compose ya lo hace. En Windows
sólo se ejecutan dos cosas:

1. **Docker Desktop** con el stack de backend (`docker compose up -d`).
2. **Metro/Expo** para la app móvil (ver la guía de conectividad).

No hay que instalar un `.exe` del backend ni dejar una consola de Django
abierta. Si se quiere trabajar en un servicio puntual con su código montado,
alcanza con dejar su contenedor levantado; los cambios se reflejan por el bind
mount.

## 8. Final del día y diagnóstico

```powershell
docker compose ps                       # estado y salud
docker compose logs -f gateway          # logs en vivo (Ctrl+C para salir)
docker compose logs --tail=100 auth     # últimas 100 líneas
docker compose restart analytics        # reiniciar uno solo
docker compose stop                     # apagar sin borrar datos
docker compose down                     # apagar y quitar contenedores
```

## 9. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` | Docker Desktop cerrado o motor WSL2 detenido | Abrir Docker Desktop y esperar **Running**; `wsl --shutdown` y reabrir si queda colgado |
| `docker: command not found` | Docker Desktop no agregó el CLI al PATH | Reabrir PowerShell; reinstalar marcando la opción de PATH |
| Un servicio queda `unhealthy` | Su base/Redis no respondió en el tiempo de arranque | `docker compose logs <servicio>`; luego `docker compose restart <servicio>` |
| `port is already allocated` | Otro proceso usa 5432, 5672, 6379, 8000-8005 o 5173 | `Get-NetTCPConnection -LocalPort 8000` y cerrar el proceso, o cambiar el puerto publicado |
| `entrypoint.sh: not found` o `^M: bad interpreter` | El archivo se guardó con CRLF | `git config --global core.autocrlf input`; `git add --renormalize .`; el repo ya fuerza LF en `.gitattributes` |
| Cambios que no se reflejan | OneDrive/antivirus bloqueando el bind mount | Mover el repo a `C:\dev`, excluir de OneDrive, reiniciar el contenedor |
| `no space left on device` en WSL | Disco virtual de Docker lleno | `docker system prune -a`; ampliar el disco en Docker Desktop |
| La app del teléfono no conecta | URL con `localhost` o firewall | Ver [Conectividad del móvil](../Movil/Conectividad-Backend.md) |

## 10. Referencias

- [Conectividad del móvil (VI-14)](../Movil/Conectividad-Backend.md)
- [Prueba E2E móvil ↔ backend (VI-16)](../Movil/E2E-Backend.md)
- [Contenedores y arranque](../flujos/felipe-orellana/02-contenedores-y-arranque.md)
- [README raíz](../../README.md)
