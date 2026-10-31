"""
El reenvío. Una sola vista para todo /api/:

  1. Decide a qué servicio va la ruta (settings.RUTAS). Desconocida → 404.
  2. Descarta cualquier cabecera de identidad que venga del cliente. Nadie
     de afuera fabrica su X-Organizacion-Id: eso es RF-26.
  3. Si la ruta no es pública, exige y valida el JWT. Falla → 401.
  4. Pone la identidad del token en cabeceras y reenvía la petición tal
     cual: mismo método, misma ruta, mismo cuerpo, misma query.
  5. Devuelve la respuesta del servicio como venga (un 403 del servicio
     llega al cliente como 403). Si el servicio no responde: 502 o 504.

Cada petición lleva un X-Correlation-ID, de entrada a salida, para seguir
una llamada por los logs de todos los servicios.
"""

import uuid

import requests
from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .identidad import SesionesNoDisponibles, TokenInvalido, leer_token, validar

# Las que el gateway fija; se ignoran si vienen del cliente.
CABECERAS_DE_IDENTIDAD = {"x-usuario-id", "x-organizacion-id", "x-rol", "x-sesion-id", "x-plan", "x-features"}

# Cabeceras de transporte que no tiene sentido reenviar en ninguna dirección.
CABECERAS_DE_SALTO = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host",
    "content-length", "content-encoding",
}


def servicio_para(ruta: str) -> str | None:
    for prefijo, servicio in settings.RUTAS.items():
        if ruta.startswith(prefijo):
            return servicio
    return None


def es_publica(ruta: str) -> bool:
    return ruta in settings.RUTAS_PUBLICAS


def respuesta_de_error(estado: int, detalle: str, correlacion: str) -> JsonResponse:
    respuesta = JsonResponse({"detalle": detalle}, status=estado, json_dumps_params={"ensure_ascii": False})
    respuesta["X-Correlation-ID"] = correlacion
    if estado == 401:
        respuesta["WWW-Authenticate"] = "Bearer"
    return respuesta


# ── La subida de archivos (FE-07) ───────────────────────────────────────────
# `request.body` lanza `RequestDataTooBig` cuando CONTENT_LENGTH supera
# `DATA_UPLOAD_MAX_MEMORY_SIZE`, que por omisión son 2,5 MB. Como el gateway
# no lo cambiaba, un archivo de 3 MB —válido para el servicio, que admite
# 5 MB— moría acá con un 400 genérico sin `codigo`, y uno de 6 MB tampoco
# recibía el `413 archivo_excedido` documentado. Las pruebas no lo veían
# porque llamaban a Connectors directamente. Lo encontró la revisión de #120.
#
# No se sube el límite global: se trata SOLO esta ruta, mirando
# CONTENT_LENGTH **antes** de tocar el cuerpo y leyendo con un tope explícito.
RUTA_SUBIDA = "/api/importaciones/archivos/"

#: Lo que el sobre multipart agrega al archivo: las cabeceras de cada parte y
#: los delimitadores. 64 KB sobra para un formulario de un archivo y un par de
#: campos, y mantiene el tope cerca del real en vez de duplicarlo.
MARGEN_MULTIPART = 64 * 1024


def _es_subida_de_archivo(request) -> bool:
    return request.method == "POST" and request.path == RUTA_SUBIDA


def _tope_de_subida() -> int:
    return int(settings.IMPORTACION_TAMANO_MAXIMO_BYTES) + MARGEN_MULTIPART


def respuesta_archivo_excedido(correlacion: str, largo: int) -> JsonResponse:
    """413 con la MISMA forma que devuelve Connectors.

    El cliente no debería notar si lo rechazó el gateway o el servicio: si acá
    devolviéramos `{"detalle": ...}` y allá `{"codigo": ...}`, el frontend
    tendría que mirar dos formas para el mismo caso.
    """
    maximo = int(settings.IMPORTACION_TAMANO_MAXIMO_BYTES)
    respuesta = JsonResponse(
        {
            "codigo": "archivo_excedido",
            "archivo": (
                f"La petición pesa {largo:,} bytes y el máximo del archivo es "
                f"{maximo:,}.".replace(",", ".")
            ),
        },
        status=413,
        json_dumps_params={"ensure_ascii": False},
    )
    respuesta["X-Correlation-ID"] = correlacion
    return respuesta


def _cuerpo_a_reenviar(request, correlacion):
    """(cuerpo, error). Solo uno de los dos no es None.

    En la ruta de subida se exige `Content-Length` y se lee con tope, para no
    leer nunca un cuerpo sin límite. En el resto se usa `request.body`, que
    conserva el límite por omisión de Django.
    """
    if not _es_subida_de_archivo(request):
        try:
            return request.body, None
        except RequestDataTooBig:
            # Antes salía como un 400 genérico de Django sin `codigo`.
            return None, respuesta_archivo_excedido(
                correlacion, int(request.META.get("CONTENT_LENGTH") or 0)
            )

    crudo = request.META.get("CONTENT_LENGTH") or ""
    if not str(crudo).isdigit():
        # Sin Content-Length no se puede saber cuánto va a llegar, y leer sin
        # tope es justo lo que esto evita.
        respuesta = JsonResponse(
            {"codigo": "largo_requerido",
             "archivo": "Falta la cabecera Content-Length."},
            status=411,
            json_dumps_params={"ensure_ascii": False},
        )
        respuesta["X-Correlation-ID"] = correlacion
        return None, respuesta

    largo = int(crudo)
    if largo > _tope_de_subida():
        # No se lee NADA del cuerpo: se corta antes.
        return None, respuesta_archivo_excedido(correlacion, largo)

    # `read` y no `body`: `body` compara contra DATA_UPLOAD_MAX_MEMORY_SIZE y
    # lanzaría igual. El stream ya viene acotado por Content-Length, y el tope
    # se pasa explícito para no depender de eso.
    return request.read(largo), None


def comprobar_feature(ruta, cabeceras):
    feature = next((valor for prefijo, valor in {
        "/api/asistente/": "asistente_financiero",
        "/api/recomendaciones/": "recomendaciones_automaticas",
    }.items() if ruta.startswith(prefijo)), None)
    if not feature:
        return True
    permisos = requests.request("GET", settings.SERVICIOS["auth"] + "/api/usuarios/me/permisos/",
        headers=cabeceras, timeout=settings.TIEMPO_ESPERA_SEGUNDOS, allow_redirects=False)
    if permisos.status_code in (403, 404):
        return False
    if permisos.status_code != 200:
        raise ValueError("No se pudieron verificar los permisos")
    datos = permisos.json()
    if (not isinstance(datos, dict) or datos.get("plan") not in ("free", "premium")
            or not isinstance(datos.get("features"), dict)):
        raise ValueError("Contrato de permisos inválido")
    if feature not in datos["features"]:
        return False
    if type(datos["features"][feature]) is not bool:
        raise ValueError("Contrato de permisos inválido")
    return datos["plan"] == "premium" and datos["features"][feature]


@csrf_exempt
def reenviar(request):
    # str() y no .hex: el contrato de eventos (shared/events/catalogo.md) pide
    # el correlation_id en forma canónica con guiones, y su esquema lo valida
    # con `format: uuid`. `.hex` devuelve 32 caracteres sin guiones, que ese
    # validador rechaza. El ejemplo del propio catálogo ya usaba la forma con
    # guiones; acá se generaba distinto.
    correlacion = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())

    servicio = servicio_para(request.path)
    if servicio is None:
        return respuesta_de_error(404, "Ruta desconocida", correlacion)

    # Se parte de las cabeceras del cliente, sin las de transporte ni las
    # de identidad. Las de identidad las pone el gateway, y solo el gateway.
    cabeceras = {
        nombre: valor
        for nombre, valor in request.headers.items()
        if nombre.lower() not in CABECERAS_DE_SALTO
        and nombre.lower() not in CABECERAS_DE_IDENTIDAD
    }

    if not es_publica(request.path):
        try:
            identidad = validar(leer_token(request.headers.get("Authorization")))
        except TokenInvalido as e:
            return respuesta_de_error(401, str(e), correlacion)
        except SesionesNoDisponibles:
            return respuesta_de_error(503, "No se pudo comprobar la sesión. Inténtalo nuevamente", correlacion)

        # El token se queda en el gateway: los servicios internos no lo
        # necesitan y no deberían verlo.
        cabeceras = {nombre: valor for nombre, valor in cabeceras.items() if nombre.lower() != "authorization"}
        cabeceras["X-Usuario-Id"] = identidad["usuario_id"]
        cabeceras["X-Sesion-Id"] = identidad["sesion_id"]
        if identidad["organizacion_id"]:
            cabeceras["X-Organizacion-Id"] = str(identidad["organizacion_id"])
        if identidad["rol"]:
            cabeceras["X-Rol"] = str(identidad["rol"])

    cabeceras["X-Correlation-ID"] = correlacion

    try:
        if not comprobar_feature(request.path, cabeceras):
            return respuesta_de_error(403, "Esta función requiere Premium vigente", correlacion)
    except (requests.RequestException, ValueError):
        return respuesta_de_error(503, "No se pudieron comprobar los permisos. Inténtalo nuevamente", correlacion)

    cuerpo, error_de_cuerpo = _cuerpo_a_reenviar(request, correlacion)
    if error_de_cuerpo is not None:
        return error_de_cuerpo

    destino = settings.SERVICIOS[servicio] + request.get_full_path()
    try:
        upstream = requests.request(
            request.method,
            destino,
            headers=cabeceras,
            data=cuerpo,
            timeout=settings.TIEMPO_ESPERA_SEGUNDOS,
            allow_redirects=False,
        )
    except requests.Timeout:
        return respuesta_de_error(504, f"El servicio {servicio} no respondió a tiempo", correlacion)
    except requests.ConnectionError:
        return respuesta_de_error(502, f"El servicio {servicio} no está disponible", correlacion)

    respuesta = HttpResponse(
        upstream.content,
        status=upstream.status_code,
        content_type=upstream.headers.get("Content-Type", "application/json"),
    )
    for nombre, valor in upstream.headers.items():
        if nombre.lower() not in CABECERAS_DE_SALTO and nombre.lower() != "content-type":
            respuesta[nombre] = valor
    respuesta["X-Correlation-ID"] = correlacion
    return respuesta

