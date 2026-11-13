"""Valida el contrato canónico sin inferir actividad ni redondear tramos."""
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from importlib.resources import files
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jsonschema import Draft202012Validator, FormatChecker
from rest_framework.exceptions import APIException

MAXIMO_CUERPO_BYTES = 4 * 1024
ESQUEMA = json.loads(files('shared.contratos').joinpath('uso-recolectores-v1.schema.json').read_text())
VALIDADOR = Draft202012Validator(ESQUEMA, format_checker=FormatChecker())


class ErrorEventoUso(APIException):
    status_code = 400

    def __init__(self, mensaje, codigo='evento_invalido', estado_http=400):
        self.status_code = estado_http
        super().__init__({'codigo': codigo, 'mensaje': mensaje})


@dataclass(frozen=True)
class EventoValidado:
    cuerpo: dict
    inicio: datetime
    fin: datetime
    fecha: date
    tramos: tuple


def instante(texto):
    return datetime.fromisoformat(texto.replace('Z', '+00:00'))


def texto_utc(fecha):
    return fecha.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def milisegundos(inicio, fin):
    diferencia = fin - inicio
    return diferencia.days * 86400000 + diferencia.seconds * 1000 + diferencia.microseconds // 1000


def validar_evento(evento):
    if not isinstance(evento, dict):
        raise ErrorEventoUso('Se requiere un objeto por petición.')
    if evento.get('version') != 1:
        raise ErrorEventoUso('Versión no soportada.', 'version_no_soportada')
    if next(VALIDADOR.iter_errors(evento), None) is not None:
        raise ErrorEventoUso('El cuerpo no cumple el contrato canónico v1.')
    try:
        zona = ZoneInfo(evento['zona_horaria'])
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ErrorEventoUso('La zona horaria IANA no existe.') from error
    inicio, fin = instante(evento['inicio']), instante(evento['fin'])
    if inicio >= fin:
        raise ErrorEventoUso('La ventana debe cumplir inicio < fin.')
    fecha = inicio.astimezone(zona).date()
    if (fin - timedelta(milliseconds=1)).astimezone(zona).date() != fecha:
        raise ErrorEventoUso('La ventana cruza el día local.', 'intervalo_cruza_dia_local')
    tramos = tuple((instante(tramo['inicio']), instante(tramo['fin'])) for tramo in evento['tramos_actividad'])
    fin_anterior = inicio
    duracion_ms = 0
    for inicio_tramo, fin_tramo in tramos:
        if inicio_tramo < fin_anterior or inicio_tramo >= fin_tramo or fin_tramo > fin:
            raise ErrorEventoUso('Tramos fuera de ventana, desordenados o solapados.', 'detalle_actividad_invalido')
        duracion_ms += milisegundos(inicio_tramo, fin_tramo)
        fin_anterior = fin_tramo
    if duracion_ms != evento['duracion_ms']:
        raise ErrorEventoUso('La duración no coincide con los tramos.', 'detalle_actividad_invalido')
    if duracion_ms and (evento['estado'] != 'activo' or evento['cobertura'] == 'sin_medicion'):
        raise ErrorEventoUso('El estado o la cobertura no acreditan actividad.')
    normalizado = {**evento, 'event_id': evento['event_id'].lower(), 'recolector_id': evento['recolector_id'].lower(),
        'inicio': texto_utc(inicio), 'fin': texto_utc(fin), 'duracion_ms': int(duracion_ms),
        'tramos_actividad': [{'inicio': texto_utc(desde), 'fin': texto_utc(hasta)} for desde, hasta in tramos]}
    return EventoValidado(normalizado, inicio, fin, fecha, tramos)
