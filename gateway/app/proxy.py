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
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .identidad import TokenInvalido, leer_token, validar

# Las que el gateway fija; se ignoran si vienen del cliente.
CABECERAS_DE_IDENTIDAD = {"x-usuario-id", "x-organizacion-id", "x-rol"}

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
    return ruta.startswith(settings.RUTAS_PUBLICAS)


def respuesta_de_error(estado: int, detalle: str, correlacion: str) -> JsonResponse:
    respuesta = JsonResponse({"detalle": detalle}, status=estado, json_dumps_params={"ensure_ascii": False})
    respuesta["X-Correlation-ID"] = correlacion
    if estado == 401:
        respuesta["WWW-Authenticate"] = "Bearer"
    return respuesta


@csrf_exempt
def reenviar(request):
    correlacion = request.headers.get("X-Correlation-ID") or uuid.uuid4().hex

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

        # El token se queda en el gateway: los servicios internos no lo
        # necesitan y no deberían verlo.
        cabeceras.pop("Authorization", None)
        cabeceras["X-Usuario-Id"] = identidad["usuario_id"]
        if identidad["organizacion_id"]:
            cabeceras["X-Organizacion-Id"] = str(identidad["organizacion_id"])
        if identidad["rol"]:
            cabeceras["X-Rol"] = str(identidad["rol"])

    cabeceras["X-Correlation-ID"] = correlacion

    destino = settings.SERVICIOS[servicio] + request.get_full_path()
    try:
        upstream = requests.request(
            request.method,
            destino,
            headers=cabeceras,
            data=request.body,
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
