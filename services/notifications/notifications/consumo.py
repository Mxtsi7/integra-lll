"""FE-24: contrato v2, inbox y proyección en una única transacción."""
import functools
import json
from pathlib import Path

from django.db import IntegrityError, transaction
from jsonschema import Draft202012Validator, FormatChecker

from shared.borrado.bloqueo import bloquear_organizacion
from .models import EventoRecibido
from .proyeccion import EVENTOS_QUE_ESCUCHA, aplicar


@functools.lru_cache(maxsize=1)
def validador():
    for carpeta in Path(__file__).resolve().parents:
        esquema = carpeta / 'shared/events/mx21-v2.schema.json'
        if esquema.is_file():
            return Draft202012Validator(json.loads(esquema.read_text()), format_checker=FormatChecker())
    raise RuntimeError('No se encontró el contrato MX-21 en la imagen')


def recibir(cuerpo: bytes) -> bool:
    sobre = json.loads(cuerpo)
    if not validador().is_valid(sobre):
        raise ValueError('Sobre inválido para MX-21 v2')
    if sobre['evento'] not in EVENTOS_QUE_ESCUCHA:
        raise ValueError('Evento ajeno al consumidor de suscripciones')
    # Durable impide devolver éxito dentro de una transacción ajena sin commit.
    with transaction.atomic(durable=True):
        if bloquear_organizacion(sobre['organizacion_id'], compartido=True).eliminada:
            return False
        clave = dict(organizacion_id=sobre['organizacion_id'], evento_id=sobre['id'])
        try:
            with transaction.atomic():
                EventoRecibido.objects.create(**clave)
        except IntegrityError:
            if EventoRecibido.objects.filter(**clave).exists():
                return False
            raise
        return aplicar(sobre)
