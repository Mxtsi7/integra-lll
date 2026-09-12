# Plataforma de control de suscripciones

Proyecto universitario — Ingeniería Civil Informática, UCT.

**SaaS multi-tenant** construido sobre una **arquitectura de microservicios**.
Centraliza las suscripciones de pago de una persona o grupo familiar, mide
cuánto se usa realmente cada servicio y recomienda cuáles conviene cancelar.

**Segmento: B2C.** Una "organización" es un hogar. Ver [docs/glosario.md](docs/glosario.md).

---

## El problema que resolvemos

> **2 de cada 3** encuestados ha pagado por una suscripción que no estaba usando
> (68,4%). Entre quienes tienen **3 o más servicios contratados, el 100%** lo ha
> hecho, frente al 54,5% de quienes tienen una o dos — diferencia
> estadísticamente significativa (χ² = 8,81; p = 0,003).
>
> **2 de cada 3** han sido cobrados al terminar una prueba gratuita (65,8%), y al
> 44,7% le ocurrió más de una vez.
>
> **2 de cada 3** no lleva ningún control real de sus suscripciones (65,8%), y
> solo el 5,3% usa una aplicación destinada a ello.
>
> *(Encuesta propia, n = 38 con suscripciones sobre 49 respuestas, agosto 2026)*

El valor no está en mostrar el total del mes — eso ya lo hace la app del banco —
sino en **evitar el cobro que no se quería y detectar lo que no se usa**.

---

## Arquitectura

```
                        ┌──────────────┐
                        │   Clientes   │  React Native (móvil) + React (web)
                        └──────┬───────┘
                               │ HTTPS
                        ┌──────▼───────┐
                        │ API Gateway  │  ruteo · valida JWT · rate limit
                        └──────┬───────┘
                               │ HTTP interno
      ┌───────────┬────────────┼────────────┬──────────────┐
      │           │            │            │              │
 ┌────▼────┐ ┌────▼─────┐ ┌────▼─────┐ ┌────▼─────┐ ┌──────▼──────┐
 │  auth   │ │subscrip- │ │connectors│ │analytics │ │notifications│
 │         │ │  tions   │ │          │ │          │ │             │
 └────┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬──────┘
      │           │            │            │              │
      └───────────┴────────────┼────────────┴──────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  RabbitMQ (eventos) │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ PostgreSQL          │
                    │ un esquema por      │
                    │ servicio            │
                    └─────────────────────┘
```

### Los servicios

| Servicio | Responsabilidad | Puerto |
|---|---|---|
| **gateway** | Punto único de entrada. Rutea, valida el JWT y propaga el contexto de organización | 8000 |
| **auth** | Organizaciones, usuarios, roles, emisión y refresco de tokens | 8001 |
| **subscriptions** | Suscripciones, proveedores, cobros. Es el núcleo del dominio | 8002 |
| **connectors** | Spotify, Gmail, importador CSV. Sincronización periódica | 8003 |
| **analytics** | Registro de uso, cálculo de puntajes, recomendaciones, integración con IA | 8004 |
| **notifications** | Alertas, plantillas y envío de correo | 8005 |

### Los clientes

| Cliente | Stack | Alcance |
|---|---|---|
| **Móvil** | React Native + Expo · Android (APK) | Panel, **notificaciones push**, registro rápido, marcar uso |
| **Web** | React + Vite | Conexión de cuentas por OAuth, importación CSV, gestión del hogar, informes |
| **shared** | TypeScript | Cliente de API generado desde OpenAPI, tipos, validaciones y formateo. Lo importan ambos clientes |

Las funcionalidades se reparten **por contexto de uso**: no se construye la misma
aplicación dos veces. El push vive solo en móvil porque es lo que una app nativa
aporta; el OAuth vive solo en web porque en móvil exige *deep linking*. Ver
ADR-006.

Ambos clientes son TypeScript, así que **comparten código real** —cliente de API,
tipos, validaciones— en `frontend/shared/`, no solo un contrato.

⚠️ **Solo Android.** iOS queda fuera: exige cuenta de Apple Developer de pago.

### Por qué esta división

Cada servicio corresponde a un **contexto delimitado** del dominio, no a una capa
técnica. La frontera está donde cambian las razones para cambiar:

- `connectors` depende de APIs externas inestables → aislarlo contiene esa volatilidad
- `analytics` es cómputo pesado y periódico → escala distinto al resto
- `notifications` tiene una única responsabilidad y ninguna dependencia del dominio
- `auth` es transversal y su ciclo de cambio es mucho más lento

Y una razón organizacional que no es menor: **son 6 personas y 6 componentes**
(5 servicios más el gateway). Cada persona es dueña de uno, con su propio
repositorio de código, su despliegue y sus pruebas. Nadie edita el archivo de
otro.

---

## Estructura

```
proyecto-suscripciones/
├─ docker-compose.yml      levanta todo el sistema
├─ gateway/                API Gateway
├─ services/
│  ├─ auth/
│  ├─ subscriptions/
│  ├─ connectors/
│  ├─ analytics/
│  └─ notifications/
├─ shared/
│  ├─ contracts/           OpenAPI de cada servicio
│  ├─ events/              catálogo y esquemas de eventos
│  └─ tenant/              base multi-tenant compartida
├─ frontend/
│  ├─ shared/             cliente de API, tipos y validaciones
│  ├─ web/                React + Vite
│  └─ movil/              React Native + Expo
├─ infra/                  docker · migraciones · observabilidad
└─ docs/                   arquitectura · diagramas · investigación · informe
```

> La planilla de la encuesta en `docs/investigacion/` está **anonimizada**: se
> retiraron los correos de quienes se ofrecieron a probar la aplicación, porque
> este repositorio es público. El original con los correos se guarda fuera del
> repositorio y no debe subirse nunca (`.gitignore` bloquea `*con correos*`).

### Anatomía de un servicio

Todos son iguales por dentro. Aprender uno es aprenderlos todos.

```
services/subscriptions/
├─ Dockerfile
├─ requirements.txt
├─ manage.py
├─ config/            settings, urls, wsgi
├─ app/
│  ├─ models.py       entidades del contexto
│  ├─ services.py     lógica de negocio
│  ├─ serializers.py  contrato de entrada y salida
│  └─ views.py        HTTP
├─ events/
│  ├─ publishers.py   eventos que emite
│  └─ consumers.py    eventos que escucha
└─ tests/
```

---

## Quién es dueño de qué

| Persona | Componente | Además |
|---|---|---|
| Líder técnico | `gateway/` + `shared/` + `infra/` | CI/CD, despliegue, revisión de PRs |
| Integraciones | `services/connectors/` | Los tres conectores |
| Motor + IA | `services/analytics/` | Puntajes y recomendaciones |
| Backend dominio | `services/subscriptions/` + `services/auth/` | El núcleo |
| Frontend web | `frontend/web/` | React. Configuración, CSV, vistas de detalle |
| Frontend móvil | `frontend/movil/` | Expo. Panel, alertas push, registro rápido |
| QA y documentación | `docs/` + `services/notifications/` | Pruebas de integración |

`shared/` se toca de a poco y con aviso: un cambio ahí afecta a los seis.

---

## Preparar tu máquina

Solo hacen falta dos cosas:

- **Docker Desktop**, abierto. Todo corre adentro de contenedores; no hay que
  instalar Python, Postgres ni ninguna dependencia en tu computador.
- **Git**.

Python solo se necesita si vas a trabajar en un servicio *fuera* de Docker, y
entonces tiene que ser **3.12** (ver más abajo).

## Levantar el sistema

```bash
git clone https://github.com/Mxtsi7/integra-lll.git
cd integra-lll
cp .env.example .env                        # con los valores de ejemplo alcanza
docker compose up -d postgres auth subscriptions
```

La primera vez descarga las imágenes y tarda unos minutos. Después, segundos.

Para comprobar que quedó bien, abre en el navegador:

| Qué | Dónde | Tiene que responder |
|---|---|---|
| Servicio `auth` | http://localhost:8001/health/ | `{"servicio": "auth", "esquema": "auth", "estado": "ok"}` |
| Servicio `subscriptions` | http://localhost:8002/health/ | lo mismo, con `subscriptions` |
| Panel de RabbitMQ | http://localhost:15672 | usuario y clave `guest` |

Si `/health/` responde, el servicio leyó el `.env`, se conectó a PostgreSQL y
está parado en su propio esquema. Es la prueba completa.

> **Estado actual.** Hoy solo `auth` y `subscriptions` tienen proyecto Django y
> arrancan. `connectors`, `analytics`, `notifications`, el gateway y el frontend
> todavía son cascarones: `docker compose up --build` sin más los intenta
> levantar y fallan. A medida que cada uno reciba su `manage.py`, se agrega al
> comando de arriba hasta llegar al objetivo:
>
> ```bash
> docker compose up --build       # todo el sistema, un solo comando
> ```
>
> **Eso es innegociable**: si levantar el sistema toma más de un comando, con 6
> personas el proyecto se vuelve inmanejable.

Comandos del día a día:

```bash
docker compose ps                 # qué está corriendo y si está sano
docker compose logs -f auth       # ver el log de un servicio (Ctrl+C para salir)
docker compose down               # apagar todo; los datos quedan
docker compose down -v            # apagar y borrar la base (empezar de cero)
```

### Trabajar en un solo servicio

Los servicios se levantan con tu código montado adentro: editas un archivo en
`services/auth/` y el contenedor lo recarga solo. **No hace falta instalar
nada en tu máquina para desarrollar.**

Lo que sí conviene es un entorno virtual local para que el editor autocomplete
y marque errores. Tiene que ser **Python 3.12**, la misma versión del
contenedor: con otra, las dependencias fijadas en `requirements.txt` no tienen
paquete compilado y `pip` falla.

```bash
# Windows
winget install Python.Python.3.12
py -3.12 -m venv .venv
.venv\Scripts\activate

# macOS / Linux
python3.12 -m venv .venv
source .venv/bin/activate

# ambos
pip install -r services/auth/requirements.txt
```

`.venv/` ya está en `.gitignore`. Cada servicio tiene su propio
`requirements.txt`; instala el del servicio en el que trabajas.

Para correr un servicio fuera de Docker (por ejemplo, para usar el depurador
del editor), levanta solo sus dependencias y arráncalo a mano:

```bash
docker compose up -d postgres rabbitmq
cd services/subscriptions
python manage.py runserver 8002
```

En ese caso el servicio lee el `.env` de la raíz, pero `DATABASE_URL` apunta al
host `postgres`, que solo existe dentro de la red de Docker. Cámbialo en tu
`.env` local a `localhost` mientras trabajes así, y no lo subas.

---

## Decisiones que hay que conocer

Están documentadas en `docs/arquitectura/`. Las tres que más se preguntan:

**Un esquema por servicio, no una base por servicio.** Separación lógica
estricta — ningún servicio consulta el esquema de otro — sobre una sola
instancia de PostgreSQL. Ver ADR-002.

**Comunicación síncrona para consultas, asíncrona para efectos.** Si necesito un
dato ahora, HTTP. Si algo ocurrió y otros deben reaccionar, evento. Ver ADR-003.

**El gateway valida el JWT una vez** y propaga la identidad a los servicios
internos por cabeceras. Los servicios no vuelven a validar; confían en la red
interna. Ver ADR-004.

---

## Regla de oro

⚠️ **`organizacion_id` viaja en toda petición y en todo evento.** Cada servicio
filtra por él sin excepción. Es multi-tenant: una consulta sin filtro expone los
datos de un cliente a otro.

La base compartida está en `shared/tenant/`. Hereda de ahí y el filtro es
automático.
