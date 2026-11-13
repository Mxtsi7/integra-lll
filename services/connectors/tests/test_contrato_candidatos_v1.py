"""Contrato MX25: productores existentes, sin BD ni llamadas de correo."""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker, ValidationError

from connectors.candidatos import Candidato
from connectors.csv_candidatos import leer
from connectors.models import CobroCandidato, Importacion
from connectors.serializers import CobroCandidatoSerializer

CONTRATOS = Path(__file__).resolve().parents[3] / "docs" / "contratos"


@pytest.fixture
def validador():
    esquema = json.loads((CONTRATOS / "candidatos-v1.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(esquema)
    return Draft202012Validator(esquema, format_checker=FormatChecker())


def candidatos_de_ejemplo():
    ejemplos = json.loads((CONTRATOS / "candidatos-v1.ejemplos.json").read_text(encoding="utf-8"))
    contenido = (CONTRATOS / "fixtures" / "candidatos-v1.csv").read_bytes()
    resultado = leer(contenido, separador=";", sha256="a" * 64,
                     organizacion_id=ejemplos[0]["organizacion_id"])
    assert not resultado.errores
    assert len(resultado.candidatos) == 1
    correo = ejemplos[1]
    candidato_correo = Candidato(**{
        **correo, "importe": Decimal(correo["importe"]),
        "fecha": date.fromisoformat(correo["fecha"]),
    })
    return ejemplos, (resultado.candidatos[0], candidato_correo)


def test_productores_y_ejemplos_comparten_contrato(validador):
    ejemplos, candidatos = candidatos_de_ejemplo()
    for ejemplo, candidato in zip(ejemplos, candidatos):
        validador.validate(ejemplo)
        real = candidato.como_json()
        validador.validate(real)
        # Identidad del productor opaca: FE17 puede cambiar su algoritmo.
        assert {k: v for k, v in real.items() if k not in ("identificador_origen", "evidencia")} == {
            k: v for k, v in ejemplo.items() if k not in ("identificador_origen", "evidencia")
        }
        assert ejemplo["evidencia"].items() <= real["evidencia"].items()


def test_todos_los_campos_comunes_son_obligatorios(validador):
    ejemplos, _ = candidatos_de_ejemplo()
    for campo in ejemplos[0]:
        incompleto = {k: v for k, v in ejemplos[0].items() if k != campo}
        with pytest.raises(ValidationError):
            validador.validate(incompleto)


@pytest.mark.parametrize("cambio", [
    {"importe": 5990.0}, {"fecha": "2026-02-31"}, {"origen": "pdf"},
    {"tipo_mensaje": "pagado"}, {"estado": "aplicado"},
    {"identificador_origen": ""}, {"evidencia": {"fila": 2}},
    {"campo_desconocido": True},
])
def test_rechaza_cambios_incompatibles(validador, cambio):
    ejemplos, _ = candidatos_de_ejemplo()
    with pytest.raises(ValidationError):
        validador.validate({**ejemplos[0], **cambio})


def test_http_conserva_datos_y_excluye_identidad_tenant():
    _, candidatos = candidatos_de_ejemplo()
    for candidato in candidatos:
        importacion = Importacion(organizacion_id=candidato.organizacion_id)
        modelo = CobroCandidato.desde_candidato(candidato, importacion=importacion)
        respuesta = CobroCandidatoSerializer(modelo).data
        assert "organizacion_id" not in respuesta
        assert respuesta["identificador_origen"] == candidato.identificador_origen
        assert Decimal(respuesta["importe"]) == candidato.importe
        assert respuesta["fecha"] == candidato.fecha.isoformat()
        assert respuesta["evidencia"] == dict(candidato.evidencia)
        assert respuesta["aplicacion"] is None
