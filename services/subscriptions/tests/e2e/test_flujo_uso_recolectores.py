"""S3-VI-23: flujo HTTP→outbox→broker→consumidor→Analytics con dobles acotados.

Lo que sí es real:

* el Bearer se valida con ``leer_token``/``validar`` del gateway;
* la recepción HTTP es la vista real de ``subscriptions`` y escribe el outbox
  en la misma transacción;
* ``despachar_pendientes`` publica de verdad en RabbitMQ;
* el worker de ``analytics-uso`` corre como proceso separado con la misma URL
  de PostgreSQL y escribe ``analytics.uso_*``;
* el verificador invoca el código local de contexto/resumen de Analytics.

Dobles y límites explícitos:

* el salto de red gateway→servicio se sustituye por ``BearerGatewayMiddleware``,
  que inyecta las cabeceras resultantes;
* las sesiones usan ``LocMemCache``, no Redis;
* ``USO_VERIFICAR_CONSENTIMIENTO`` es ``_consentimiento_prueba`` y devuelve
  ``True`` incondicionalmente: no ejerce la autoridad de consentimiento;
* los eventos son las fixtures del contrato v1, no capturas desde dispositivo;
* el resumen se calcula con código local: no intervienen proveedores de IA.

La suite exige PostgreSQL y el broker efímero anunciado por
``RABBITMQ_PRUEBA_URL``. Si falta infraestructura, npm, node o tsx, falla con
un mensaje explícito: nunca degrada a SQLite, omite pruebas ni inventa un
broker local.
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import jwt
import pika
import pytest
from django.conf import settings
from django.core.cache import caches
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.http import JsonResponse
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from shared.borrado.models import EstadoOrganizacion

from app.models import (
    EventoUsoRecibido,
    OutboxEvento,
    ProyeccionUsoRecolector,
    RegistroUso,
    Subscription,
)
from events.despacho import despachar_pendientes
from events.uso import (
    COLA_FALLOS_USO,
    COLA_USO,
    EVENTO_USO,
    declarar_uso,
    publicar_uso,
    registrar_uso,
    uuid_usuario_auth,
)

RAIZ = Path(__file__).resolve().parents[4]
SERVICIO_TS = RAIZ / "services" / "analytics-uso"
SERVICIO_ANALYTICS = RAIZ / "services" / "analytics"
VERIFICADOR = Path(__file__).with_name("verificar_analytics_uso.py")
EJEMPLOS = json.loads(
    (RAIZ / "docs" / "contratos" / "uso-recolectores-v1.ejemplos.json").read_text(
        encoding="utf-8"
    )
)
FIXTURAS = {entrada["nombre"]: entrada for entrada in EJEMPLOS["eventos_uso"]}
NPM = shutil.which("npm")
NODO = shutil.which("node")
TSX = SERVICIO_TS / "node_modules" / "tsx" / "dist" / "cli.mjs"
# El job de CI expone el broker efímero con esta variable. No hay default
# local: si falta, la fixture falla con un mensaje explícito en vez de apuntar
# silenciosamente a otro puerto.
RABBITMQ_PRUEBA_URL = os.environ.get("RABBITMQ_PRUEBA_URL", "")
USUARIO_E2E = 42
USUARIO_UUID = str(uuid_usuario_auth(USUARIO_E2E))


# El gateway valida el token y descarta cualquier identidad enviada por el
# cliente. Este middleware de prueba reutiliza esa validación real; el salto de
# red gateway→servicio se sustituye por la inyección de las mismas cabeceras.
class BearerGatewayMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from gateway.app.identidad import (
            SesionesNoDisponibles,
            TokenInvalido,
            leer_token,
            validar,
        )

        for nombre in (
            "HTTP_X_USUARIO_ID",
            "HTTP_X_ORGANIZACION_ID",
            "HTTP_X_ROL",
            "HTTP_X_SESION_ID",
        ):
            request.META.pop(nombre, None)
        try:
            identidad = validar(leer_token(request.META.get("HTTP_AUTHORIZATION")))
        except TokenInvalido as exc:
            return JsonResponse(
                {"codigo": "token_invalido", "mensaje": str(exc)}, status=401
            )
        except SesionesNoDisponibles:
            return JsonResponse(
                {"codigo": "sesiones_no_disponibles"}, status=503
            )
        request.META["HTTP_X_USUARIO_ID"] = str(identidad["usuario_id"])
        if identidad["organizacion_id"]:
            request.META["HTTP_X_ORGANIZACION_ID"] = str(
                identidad["organizacion_id"]
            )
        if identidad["rol"]:
            request.META["HTTP_X_ROL"] = str(identidad["rol"])
        return self.get_response(request)


def _consentimiento_prueba(**contexto):
    """Doble deliberado: la E2E no ejerce la autoridad de consentimiento."""
    return True


CACHES_E2E = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "e2e-default",
    },
    "sesiones": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "e2e-sesiones",
    },
}
MIDDLEWARE_E2E = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    f"{__name__}.BearerGatewayMiddleware",
    "shared.tenant.base.ContextoTenantMiddleware",
    "shared.borrado.middleware.EscrituraOrganizacionMiddleware",
]


def _esperar(condicion, mensaje: str, timeout: float = 25.0):
    inicio = time.monotonic()
    while time.monotonic() - inicio < timeout:
        resultado = condicion()
        if resultado:
            return resultado
        time.sleep(0.1)
    raise AssertionError(f"Se agotó el tiempo esperando: {mensaje}")


def _url_postgresql_de_prueba() -> str:
    configuracion = settings.DATABASES["default"]
    motor = configuracion.get("ENGINE", "")
    if "postgres" not in motor:
        pytest.fail("S3-VI-23 exige PostgreSQL; la configuración actual no lo es")
    host = configuracion.get("HOST", "")
    if not host:
        pytest.fail("S3-VI-23 exige un host PostgreSQL explícito")
    nombre = (configuracion.get("TEST") or {}).get("NAME") or (
        f"test_{configuracion['NAME']}"
    )
    usuario = quote(str(configuracion.get("USER") or "postgres"), safe="")
    clave = quote(str(configuracion.get("PASSWORD") or ""), safe="")
    puerto = configuracion.get("PORT") or "5432"
    return f"postgres://{usuario}:{clave}@{host}:{puerto}/{nombre}"


def _conexion_rabbit():
    return pika.BlockingConnection(pika.URLParameters(RABBITMQ_PRUEBA_URL))


def _declarar_y_purgar():
    conexion = _conexion_rabbit()
    try:
        canal = conexion.channel()
        declarar_uso(canal)
        canal.queue_purge(COLA_USO)
        canal.queue_purge(COLA_FALLOS_USO)
    finally:
        conexion.close()


def _mensajes_en_cola(cola: str) -> int:
    conexion = _conexion_rabbit()
    try:
        canal = conexion.channel()
        respuesta = canal.queue_declare(queue=cola, passive=True)
        return int(respuesta.method.message_count)
    finally:
        conexion.close()


@pytest.fixture(scope="session")
def infra_real(django_db_setup, django_db_blocker):
    """Aplica las migraciones reales, purga las colas y arranca el worker TS."""
    # El broker del job de CI se anuncia por RABBITMQ_PRUEBA_URL. No hay
    # default ni fallback a otro puerto: si falta infraestructura, la suite
    # falla aquí con un mensaje explícito en vez de omitirse.
    if not RABBITMQ_PRUEBA_URL:
        pytest.fail("S3-VI-23 exige RABBITMQ_PRUEBA_URL; definir el broker efímero del job")
    if NPM is None or NODO is None:
        pytest.fail("S3-VI-23 exige npm y node disponibles en PATH; sin fallback")
    if not TSX.is_file():
        pytest.fail(f"S3-VI-23 exige tsx instalado en {SERVICIO_TS}; ejecutar npm ci")

    base_datos = _url_postgresql_de_prueba()
    with django_db_blocker.unblock():
        with connection.cursor() as cursor:
            cursor.execute("CREATE SCHEMA IF NOT EXISTS analytics")
            cursor.execute("CREATE SCHEMA IF NOT EXISTS subscriptions")
            cursor.execute(
                "CREATE OR REPLACE VIEW subscriptions.subscription AS "
                "SELECT * FROM public.subscription"
            )

    entorno_analitica = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "analytics_config.settings",
        "DATABASE_URL": base_datos,
        "ESQUEMA_BD": "analytics",
        "RABBITMQ_URL": RABBITMQ_PRUEBA_URL,
    }
    migrar = subprocess.run(
        [sys.executable, "manage.py", "migrate", "--noinput"],
        cwd=SERVICIO_ANALYTICS,
        env=entorno_analitica,
        capture_output=True,
        text=True,
        check=False,
    )
    if migrar.returncode:
        pytest.fail(f"Fallaron las migraciones de analytics: {migrar.stderr[-2000:]}")

    entorno_ts = {
        **os.environ,
        "DATABASE_URL": base_datos,
        "RABBITMQ_URL": RABBITMQ_PRUEBA_URL,
        "LOG_LEVEL": "info",
    }
    ddl = subprocess.run(
        [NPM, "run", "migrar"],
        cwd=SERVICIO_TS,
        env=entorno_ts,
        capture_output=True,
        text=True,
        check=False,
    )
    if ddl.returncode:
        pytest.fail(f"Falló el DDL de analytics-uso: {ddl.stderr[-2000:]}")

    _declarar_y_purgar()
    registro = tempfile.NamedTemporaryFile(
        mode="w+", prefix="e2e-uso-worker-", suffix=".log", delete=False,
        encoding="utf-8",
    )
    worker = subprocess.Popen(
        [NODO, str(TSX), "src/worker.ts"],
        cwd=SERVICIO_TS,
        env=entorno_ts,
        stdout=registro,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        _esperar(
            lambda: "worker de analytics-uso listo"
            in Path(registro.name).read_text(encoding="utf-8", errors="replace"),
            "el worker real de analytics-uso arranque",
        )
    except Exception:
        worker.terminate()
        raise
    yield {
        "base_datos": base_datos,
        "rabbitmq": RABBITMQ_PRUEBA_URL,
        "registro_worker": registro.name,
    }
    worker.terminate()
    try:
        worker.wait(timeout=10)
    except subprocess.TimeoutExpired:
        worker.kill()
        worker.wait(timeout=10)
    close_old_connections()
    registro.close()


@override_settings(
    MIDDLEWARE=MIDDLEWARE_E2E,
    CACHES=CACHES_E2E,
    JWT_SECRET="valor-de-prueba-e2e-sin-uso-real",
    JWT_ALGORITMO="HS256",
    RABBITMQ_URL=RABBITMQ_PRUEBA_URL,
    # Doble explícito: siempre True. No se valida la autoridad de consentimiento.
    USO_VERIFICAR_CONSENTIMIENTO=_consentimiento_prueba,
    USO_PERSISTIR_EVENTO="app.uso_recolectores.persistencia.persistir",
)
@pytest.mark.usefixtures("infra_real")
class FlujoUsoRecolectoresE2E(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        super().setUp()
        call_command("gestionar_catalogo", cargar_iniciales=True)
        self.cliente = APIClient()
        self.organizacion_a = uuid4()
        self.organizacion_b = uuid4()
        self.hoy = timezone.localdate()
        self._limpiar_analytics()
        _declarar_y_purgar()
        self.suscripcion_clp = self._suscripcion(
            self.organizacion_a, "Streaming CLP", "CLP", "1000"
        )
        self.token_a = self._token(USUARIO_E2E, self.organizacion_a)
        self.token_b = self._token(USUARIO_E2E, self.organizacion_b)

    def tearDown(self):
        _declarar_y_purgar()
        super().tearDown()

    # ── ayudas ────────────────────────────────────────────────────────
    def _limpiar_analytics(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "TRUNCATE analytics.uso_tramo, analytics.uso_evento, "
                "analytics.uso_diario, analytics.uso_mensual_recolector, "
                "analytics.uso_mensual, "
                "analytics.estado_eliminacion_organizacion"
            )
            cursor.execute("TRUNCATE public.estado_eliminacion_organizacion")

    @staticmethod
    def _suscripcion(organizacion, nombre, moneda, monto):
        return Subscription.objects.create(
            organizacion_id=organizacion,
            nombre=nombre,
            monto=monto,
            moneda=moneda,
            frecuencia="mensual",
            categoria="streaming",
            fecha_proximo_cobro="2026-11-20",
            estado="activo",
            activo=True,
        )

    def _token(self, usuario_id, organizacion_id):
        version = "a" * 64
        sesion = str(uuid4())
        caches["sesiones"].set(f"usuario:{usuario_id}", version, timeout=None)
        caches["sesiones"].set(
            f"sesion:{sesion}", [str(usuario_id), version], timeout=600
        )
        return jwt.encode(
            {
                "sub": str(usuario_id),
                "organizacion_id": str(organizacion_id),
                "rol": "titular",
                "token_type": "access",
                "session_version": version,
                "sid": sesion,
                "exp": timezone.now() + timezone.timedelta(minutes=10),
            },
            settings.JWT_SECRET,
            algorithm=settings.JWT_ALGORITMO,
        )

    def _evento(self, fixture: str, **identificadores):
        evento = copy.deepcopy(FIXTURAS[fixture]["evento"])
        texto = json.dumps(evento)
        texto = texto.replace("2026-11-09", f"{self.hoy.year}-{self.hoy.month:02d}-09")
        evento = json.loads(texto)
        for campo, valor in identificadores.items():
            evento[campo] = str(valor)
        return evento

    def _enviar(self, token, suscripcion, evento, **extra):
        return self.cliente.post(
            f"/api/suscripciones/{suscripcion.id}/uso/recolector/",
            evento,
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
            **extra,
        )

    def _contar(self, tabla: str, organizacion) -> int:
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT count(*) FROM analytics.{tabla} WHERE organizacion_id = %s",
                [organizacion],
            )
            return int(cursor.fetchone()[0])

    def _filas(self, sql: str, parametros: list):
        with connection.cursor() as cursor:
            cursor.execute(sql, parametros)
            columnas = [descripcion[0] for descripcion in cursor.description]
            return [dict(zip(columnas, fila)) for fila in cursor.fetchall()]

    def _esperar_eventos(self, organizacion, total):
        return _esperar(
            lambda: self._contar("uso_evento", organizacion) == total,
            f"{total} evento(s) en analytics.uso_evento para {organizacion}",
        )

    def _despachar(self):
        resultado = despachar_pendientes()
        assert resultado["reintentados"] == 0
        assert resultado["publicados"] >= 1
        return resultado

    # ── pruebas ───────────────────────────────────────────────────────
    def test_flujo_bearer_outbox_rabbit_consumidor_y_redelivery(self):
        evento = self._evento("android")
        url = f"/api/suscripciones/{self.suscripcion_clp.id}/uso/recolector/"

        sin_token = self.cliente.post(url, evento, format="json")
        assert sin_token.status_code == 401
        assert OutboxEvento.objects.filter(evento=EVENTO_USO).count() == 0

        primera = self._enviar(self.token_a, self.suscripcion_clp, evento)
        duplicada = self._enviar(self.token_a, self.suscripcion_clp, evento)
        assert (primera.status_code, duplicada.status_code) == (201, 200)
        assert primera.data["recibido_en"] == duplicada.data["recibido_en"]
        assert EventoUsoRecibido.objects.count() == 1

        publicacion = OutboxEvento.objects.get(evento=EVENTO_USO)
        assert publicacion.publicado_en is None
        assert publicacion.datos["event_id"] == evento["event_id"]
        assert publicacion.datos["suscripcion_id"] == str(self.suscripcion_clp.id)
        assert publicacion.datos["usuario_id"] == USUARIO_UUID
        assert str(publicacion.correlation_id)

        self._despachar()
        publicacion.refresh_from_db()
        assert publicacion.publicado_en is not None
        assert publicacion.intentos == 0

        self._esperar_eventos(self.organizacion_a, 1)
        fila = self._filas(
            "SELECT event_id::text, duracion_ms, cobertura, estado, "
            "correlation_id::text, fecha_local::text "
            "FROM analytics.uso_evento WHERE organizacion_id = %s",
            [self.organizacion_a],
        )[0]
        assert fila["event_id"] == evento["event_id"]
        assert fila["duracion_ms"] == 30000
        assert (fila["cobertura"], fila["estado"]) == ("completa", "activo")
        assert fila["correlation_id"] == str(publicacion.correlation_id)
        assert self._contar("uso_tramo", self.organizacion_a) == 1

        diario = self._filas(
            "SELECT ms_netos::text, minutos_netos::text, ms_residuo "
            "FROM analytics.uso_diario WHERE organizacion_id = %s",
            [self.organizacion_a],
        )[0]
        assert diario["ms_netos"] == "30000"
        assert diario["minutos_netos"] == "0"
        assert diario["ms_residuo"] == 30000

        mensual = self._filas(
            "SELECT ms_netos::text, minutos_netos::text "
            "FROM analytics.uso_mensual_recolector WHERE organizacion_id = %s",
            [self.organizacion_a],
        )[0]
        assert mensual == {"ms_netos": "30000", "minutos_netos": "0"}

        proyeccion = ProyeccionUsoRecolector.objects.get(
            organizacion_id=self.organizacion_a
        )
        assert proyeccion.duracion_union_ms == 30000
        assert not RegistroUso.objects.filter(
            organizacion_id=self.organizacion_a,
            origen=RegistroUso.Origen.RECOLECTOR,
        ).exists()

        # Redelivery real del mismo sobre: el repositorio debe deduplicar sin
        # insertar otro evento ni another fila diaria/mensual.
        publicar_uso(publicacion)
        _esperar(
            lambda: _mensajes_en_cola(COLA_USO) == 0,
            "el redelivery sea confirmado por el consumidor",
        )
        assert self._contar("uso_evento", self.organizacion_a) == 1
        assert self._contar("uso_tramo", self.organizacion_a) == 1
        assert self._contar("uso_diario", self.organizacion_a) == 1
        assert _mensajes_en_cola(COLA_FALLOS_USO) == 0

    def test_aislamiento_de_organizaciones_y_barrera_de_borrado(self):
        evento = self._evento("android")
        suscripcion_b = self._suscripcion(
            self.organizacion_b, "Streaming Org B", "CLP", "1000"
        )
        token_b = self._token(USUARIO_E2E, self.organizacion_b)

        assert self._enviar(self.token_a, self.suscripcion_clp, evento).status_code == 201
        assert self._enviar(token_b, suscripcion_b, evento).status_code == 201
        assert OutboxEvento.objects.filter(evento=EVENTO_USO).count() == 2

        self._despachar()
        self._esperar_eventos(self.organizacion_a, 1)
        self._esperar_eventos(self.organizacion_b, 1)
        assert self._contar("uso_diario", self.organizacion_b) == 1

        # La barrera HTTP vive en public (modelo Django) y la del consumidor en
        # analytics (DDL del pipeline); la limpieza real marca ambas.
        EstadoOrganizacion.objects.update_or_create(
            organizacion_id=self.organizacion_a, defaults={"eliminada": True}
        )
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO analytics.estado_eliminacion_organizacion "
                "(organizacion_id, eliminada) VALUES (%s, TRUE) "
                "ON CONFLICT (organizacion_id) DO UPDATE SET eliminada = TRUE",
                [self.organizacion_a],
            )

        bloqueado = self._enviar(
            self.token_a, self.suscripcion_clp, self._evento("navegador")
        )
        assert bloqueado.status_code == 410
        assert bloqueado.json()["code"] == "organizacion_eliminada"
        assert OutboxEvento.objects.filter(evento=EVENTO_USO).count() == 2

        # Un mensaje en vuelo de un tenant eliminado se confirma sin
        # reinsertar; la barrera se aplica también al consumidor.
        evento_tardio = self._evento("navegador")
        publicacion = registrar_uso(
            organizacion_id=self.organizacion_a,
            suscripcion_id=self.suscripcion_clp.pk,
            evento=evento_tardio,
            usuario_id=USUARIO_UUID,
        )
        publicar_uso(publicacion)
        _esperar(
            lambda: _mensajes_en_cola(COLA_USO) == 0,
            "la redelivery del tenant eliminado sea confirmada",
        )
        assert self._contar("uso_evento", self.organizacion_a) == 1
        assert _mensajes_en_cola(COLA_FALLOS_USO) == 0

        permitido = self._enviar(token_b, suscripcion_b, self._evento("navegador"))
        assert permitido.status_code == 201
        self._despachar()
        self._esperar_eventos(self.organizacion_b, 2)
        assert self._contar("uso_evento", self.organizacion_a) == 1

    def test_precision_cobertura_y_gastos_por_moneda_en_analytics(self):
        suscripcion_usd = self._suscripcion(
            self.organizacion_a, "Herramienta USD", "USD", "25.50"
        )
        evento_positivo = self._evento("android")
        evento_pausado = self._evento("pausa_conocida")

        assert self._enviar(
            self.token_a, self.suscripcion_clp, evento_positivo
        ).status_code == 201
        assert self._enviar(
            self.token_a, suscripcion_usd, evento_pausado
        ).status_code == 201
        self._despachar()
        self._esperar_eventos(self.organizacion_a, 2)
        _esperar(
            lambda: _mensajes_en_cola(COLA_USO) == 0,
            "el consumidor confirme ambos eventos",
        )

        parametros = {
            "organizacion_id": str(self.organizacion_a),
            "anio": self.hoy.year,
            "mes": self.hoy.month,
            "suscripcion_ids": [
                str(self.suscripcion_clp.id),
                str(suscripcion_usd.id),
            ],
        }
        entorno = {
            **os.environ,
            "DATABASE_URL": infra_real_base_datos(),
            "RABBITMQ_URL": RABBITMQ_PRUEBA_URL,
            "ESQUEMA_BD": "analytics",
            "DJANGO_SETTINGS_MODULE": "analytics_config.settings",
            "E2E_ANALYTICS_PARAMETROS": json.dumps(parametros),
        }
        salida = subprocess.run(
            [sys.executable, str(VERIFICADOR)],
            cwd=SERVICIO_ANALYTICS,
            env=entorno,
            capture_output=True,
            text=True,
            check=False,
        )
        if salida.returncode:
            pytest.fail(f"Falló la verificación real de Analytics: {salida.stderr[-2000:]}")
        datos = json.loads(salida.stdout)

        uso_clp = datos["uso"][str(self.suscripcion_clp.id)]
        assert uso_clp["duracion_positiva_ms"] == 30000
        assert uso_clp["minutos_enteros_proyectados"] == 0
        puntaje_clp = next(
            item for item in datos["puntajes"]
            if item["suscripcion_id"] == str(self.suscripcion_clp.id)
        )
        assert puntaje_clp["clasificacion_uso"] == "uso_positivo_confirmado"
        assert puntaje_clp["minutos_enteros_proyectados"] == 0
        assert puntaje_clp["recomendacion"]["accion"] == "sin_recomendacion_automatica"

        uso_usd = datos["uso"][str(suscripcion_usd.id)]
        assert uso_usd["cobertura_predominante"] == "sin_medicion"
        assert uso_usd["estado_predominante"] == "pausado"
        assert uso_usd["existe_brecha_de_medicion"] is True
        puntaje_usd = next(
            item for item in datos["puntajes"]
            if item["suscripcion_id"] == str(suscripcion_usd.id)
        )
        assert puntaje_usd["clasificacion_uso"] == "datos_insuficientes"
        assert puntaje_usd["permite_penalizacion_por_bajo_uso"] is False
        assert puntaje_usd["recomendacion"] == {
            "accion": "sin_recomendacion_automatica",
            "motivo": "recolector_pausado",
            "penalizacion_aplicada": False,
        }

        assert datos["consulta_uso_disponible"] is True
        assert datos["gastos"] == [
            {
                "moneda": "CLP",
                "total_estimado_mensual_texto": "1000.00",
                "cantidad_suscripciones_activas": 1,
                "tipo_gasto": "estimacion_recurrente_mensual_equivalente",
            },
            {
                "moneda": "USD",
                "total_estimado_mensual_texto": "25.50",
                "cantidad_suscripciones_activas": 1,
                "tipo_gasto": "estimacion_recurrente_mensual_equivalente",
            },
        ], json.dumps(datos, ensure_ascii=False, default=str)
        assert "sin mezclar divisas" in datos["resumen"]
        assert "cobertura/datos insuficientes" in datos["resumen"]


def infra_real_base_datos() -> str:
    """La BD de test creada por Django, reutilizada por Analytics."""
    return _url_postgresql_de_prueba()
