"""Regresiones del contrato de eventos de uso y cobertura v1 (S3-VI-01).

Valida que las fixtures de docs/contratos/uso-recolectores-v1.ejemplos.json
pasen el esquema docs/contratos/uso-recolectores-v1.schema.json, más las
reglas cruzadas que el esquema no puede expresar. No prueba al productor
(recolectores, S3-MX-01) ni al receptor (Analytics): fija el contrato
acordado para que ninguna de las dos partes lo desalinee sola.

Desde la raíz del repo:

    python -m pip install "jsonschema[format]==4.26.0" "pytest==8.3.4"
    python -m pytest docs/contratos/tests -v
"""

import copy
import json
from datetime import datetime
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker, ValidationError

# docs/contratos/tests/test_uso_recolectores_v1.py -> raíz del repo.
RAIZ = Path(__file__).resolve().parents[3]
DIR_CONTRATO = RAIZ / "docs" / "contratos"
ESQUEMA = json.loads(
    (DIR_CONTRATO / "uso-recolectores-v1.schema.json").read_text(encoding="utf-8")
)
EJEMPLOS = json.loads(
    (DIR_CONTRATO / "uso-recolectores-v1.ejemplos.json").read_text(encoding="utf-8")
)
Draft202012Validator.check_schema(ESQUEMA)
FORMATOS = FormatChecker()
VALIDADOR_USO = Draft202012Validator(ESQUEMA, format_checker=FORMATOS)

# Casos y límites acordados en el contrato.
DURACION_MS_MAXIMA = 90_000_000  # 25 h: un día de cambio de horario.
NOMBRE_EVENTO_USO_POSITIVO = "uso_positivo"
NOMBRE_EVENTO_CERO_OBSERVADO = "cero_observado"
NOMBRE_EVENTO_SIN_MEDICION = "sin_medicion"
NOMBRES_EVENTOS_USO = [
    NOMBRE_EVENTO_USO_POSITIVO,
    NOMBRE_EVENTO_CERO_OBSERVADO,
    NOMBRE_EVENTO_SIN_MEDICION,
]
NOMBRES_INTERVALOS_COBERTURA = [
    caso["nombre"] for caso in EJEMPLOS["intervalos_cobertura"]
]
NOMBRES_ACUSES = [caso["nombre"] for caso in EJEMPLOS["acuses"]]

EVENTOS_USO_POR_NOMBRE = {
    caso["nombre"]: caso["payload"] for caso in EJEMPLOS["eventos_uso"]
}
ACUSES_POR_NOMBRE = {caso["nombre"]: caso for caso in EJEMPLOS["acuses"]}


def validador_de(definicion: str) -> Draft202012Validator:
    """El mismo esquema, pero validando una definición como raíz.

    La raíz del archivo valida un UsageEventPayload; así se llega a las
    otras tres definiciones sin duplicar el documento ni reubicar $defs.
    """
    raiz = dict(ESQUEMA)
    raiz["$ref"] = f"#/$defs/{definicion}"
    return Draft202012Validator(raiz, format_checker=FORMATOS)


VALIDADOR_COBERTURA = validador_de("coverage_interval_payload")
VALIDADOR_ACUSE = validador_de("acuse_uso")
VALIDADOR_ERROR = validador_de("error_uso")


def instante(texto_rfc3339: str) -> datetime:
    """Parsea un RFC3339 UTC terminado en Z (fromisoformat pre-3.11 no lo toma)."""
    return datetime.fromisoformat(texto_rfc3339.removesuffix("Z") + "+00:00")


def duracion_tramo_ms(tramo: dict) -> int:
    """Milisegundos enteros entre el inicio y el fin de un tramo."""
    delta = instante(tramo["fin"]) - instante(tramo["inicio"])
    return delta.days * 86_400_000 + delta.seconds * 1000 + delta.microseconds // 1000


def copia_del_evento(nombre_evento: str) -> dict:
    """Copia profunda de un fixture de uso: mutarla no toca el original."""
    return copy.deepcopy(EVENTOS_USO_POR_NOMBRE[nombre_evento])


def copia_del_acuse(nombre_acuse: str) -> dict:
    """Copia profunda del cuerpo de un acuse, por su nombre."""
    return copy.deepcopy(ACUSES_POR_NOMBRE[nombre_acuse]["cuerpo"])


# --- Fixtures válidas: todo lo que el contrato declara válido pasa el esquema.


def test_los_casos_de_uso_son_los_acordados():
    """Guarda: renombrar o quitar un caso de ejemplos.json no pasa inadvertido."""
    assert set(EVENTOS_USO_POR_NOMBRE) == set(NOMBRES_EVENTOS_USO)


def test_los_acuses_cubren_aceptado_duplicado_y_conflicto():
    """Guarda: los tres acuses del contrato (201, 200 y 409) están presentes."""
    assert set(NOMBRES_ACUSES) == {"aceptado_201", "duplicado_200", "conflicto_409"}


@pytest.mark.parametrize("nombre_evento", NOMBRES_EVENTOS_USO)
def test_el_evento_de_uso_pasa_el_esquema(nombre_evento):
    """Cada estado del contrato tiene su fixture y valida contra el esquema."""
    VALIDADOR_USO.validate(EVENTOS_USO_POR_NOMBRE[nombre_evento])


@pytest.mark.parametrize(
    "intervalo", EJEMPLOS["intervalos_cobertura"], ids=NOMBRES_INTERVALOS_COBERTURA
)
def test_el_intervalo_de_cobertura_pasa_el_esquema(intervalo):
    VALIDADOR_COBERTURA.validate(intervalo["payload"])


@pytest.mark.parametrize("acuse", EJEMPLOS["acuses"], ids=NOMBRES_ACUSES)
def test_el_acuse_pasa_el_esquema(acuse):
    """201/200 responden AcuseUso; el 409 responde ErrorUso."""
    if acuse["estado_http"] >= 400:
        VALIDADOR_ERROR.validate(acuse["cuerpo"])
        return
    VALIDADOR_ACUSE.validate(acuse["cuerpo"])


def test_los_acuses_repiten_el_event_id_del_evento_enviado():
    """El acuse confirma qué hecho quedó registrado: el mismo event_id."""
    event_id_enviado = EVENTOS_USO_POR_NOMBRE[NOMBRE_EVENTO_USO_POSITIVO]["event_id"]
    for acuse in EJEMPLOS["acuses"]:
        assert acuse["cuerpo"]["event_id"] == event_id_enviado


# --- Reglas cruzadas: lo que el esquema no puede expresar, el contrato lo fija.


def test_duracion_ms_es_la_suma_de_los_tramos():
    """La duración declarada tiene que calzar con los tramos medidos."""
    evento = EVENTOS_USO_POR_NOMBRE[NOMBRE_EVENTO_USO_POSITIVO]
    suma_tramos_ms = sum(
        duracion_tramo_ms(tramo) for tramo in evento["tramos_actividad"]
    )
    assert evento["duracion_ms"] == suma_tramos_ms


def test_todo_tramo_termina_despues_de_empezar():
    for evento in EVENTOS_USO_POR_NOMBRE.values():
        for tramo in evento["tramos_actividad"]:
            assert instante(tramo["inicio"]) < instante(tramo["fin"])


def test_cero_observado_y_sin_medicion_no_llevan_uso():
    """Quien no vio uso (o no midió) no manda tramos ni duración."""
    for nombre_evento in (NOMBRE_EVENTO_CERO_OBSERVADO, NOMBRE_EVENTO_SIN_MEDICION):
        evento = EVENTOS_USO_POR_NOMBRE[nombre_evento]
        assert evento["duracion_ms"] == 0
        assert evento["tramos_actividad"] == []


def test_sin_medicion_no_acredita_cobertura():
    evento = EVENTOS_USO_POR_NOMBRE[NOMBRE_EVENTO_SIN_MEDICION]
    assert evento["cobertura"] is None


def test_la_cobertura_del_evento_cubre_su_fecha():
    """ISO YYYY-MM-DD ordena igual como texto que como fecha."""
    for nombre_evento in (NOMBRE_EVENTO_USO_POSITIVO, NOMBRE_EVENTO_CERO_OBSERVADO):
        evento = EVENTOS_USO_POR_NOMBRE[nombre_evento]
        assert evento["cobertura"]["desde"] <= evento["fecha"]
        assert evento["fecha"] <= evento["cobertura"]["hasta"]


def test_el_intervalo_de_cobertura_es_un_rango_valido():
    for intervalo in EJEMPLOS["intervalos_cobertura"]:
        assert intervalo["payload"]["desde"] <= intervalo["payload"]["hasta"]


def test_duracion_ms_acepta_el_dia_de_25_horas():
    """Un día de cambio de horario puede durar 25 h: el límite lo admite."""
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = DURACION_MS_MAXIMA
    VALIDADOR_USO.validate(evento)


# --- Mutaciones de fixtures válidas: el esquema tiene que rechazarlas.


def evento_con_estado_desconocido() -> dict:
    """`positivo` no existe: el enum de estado es cerrado."""
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["estado"] = "positivo"
    return evento


def evento_de_uso_sin_uso() -> dict:
    """con_uso exige duracion_ms > 0 y al menos un tramo."""
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = 0
    evento["tramos_actividad"] = []
    return evento


def evento_con_duracion_ms_negativa() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = -1
    return evento


def evento_con_duracion_ms_de_texto() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = "5700000"
    return evento


def evento_con_duracion_ms_fraccionaria() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = 5700000.5
    return evento


def evento_con_duracion_ms_nula() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = None
    return evento


def evento_con_duracion_ms_booleana() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = True
    return evento


def evento_con_duracion_ms_sobre_el_limite() -> dict:
    """Más de 25 h en un solo día: ni el cambio de horario lo justifica."""
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["duracion_ms"] = DURACION_MS_MAXIMA + 1
    return evento


def cero_observado_con_tramos() -> dict:
    """Un cero observado con actividad: el estado manda sobre el resto."""
    evento = copia_del_evento(NOMBRE_EVENTO_CERO_OBSERVADO)
    evento["tramos_actividad"] = [
        {"inicio": "2026-11-10T12:00:00Z", "fin": "2026-11-10T12:30:00Z"}
    ]
    return evento


def sin_medicion_con_cobertura() -> dict:
    """Sin medición no acredita cobertura: jamás se lee como cero."""
    evento = copia_del_evento(NOMBRE_EVENTO_SIN_MEDICION)
    evento["cobertura"] = {"desde": "2026-11-11", "hasta": "2026-11-11"}
    return evento


def evento_con_version_futura() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["version"] = 2
    return evento


def evento_con_event_id_no_uuid() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["event_id"] = "no-soy-uuid"
    return evento


def evento_con_instante_sin_z_utc() -> dict:
    """RFC3339 válido pero con offset: el contrato exige UTC explícito (Z)."""
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["ocurrido_en"] = "2026-11-10T03:00:00+03:00"
    return evento


def evento_con_fecha_invalida() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    evento["fecha"] = "2026-02-30"
    return evento


def evento_sin_campo_obligatorio() -> dict:
    evento = copia_del_evento(NOMBRE_EVENTO_USO_POSITIVO)
    del evento["recolector_id"]
    return evento


MUTACIONES_MALFORMADAS = [
    pytest.param(evento_con_estado_desconocido, id="estado_desconocido"),
    pytest.param(evento_de_uso_sin_uso, id="con_uso_sin_uso"),
    pytest.param(evento_con_duracion_ms_negativa, id="duracion_ms_negativa"),
    pytest.param(evento_con_duracion_ms_de_texto, id="duracion_ms_de_texto"),
    pytest.param(evento_con_duracion_ms_fraccionaria, id="duracion_ms_fraccionaria"),
    pytest.param(evento_con_duracion_ms_nula, id="duracion_ms_nula"),
    pytest.param(evento_con_duracion_ms_booleana, id="duracion_ms_booleana"),
    pytest.param(
        evento_con_duracion_ms_sobre_el_limite, id="duracion_ms_sobre_el_limite"
    ),
    pytest.param(cero_observado_con_tramos, id="cero_observado_con_tramos"),
    pytest.param(sin_medicion_con_cobertura, id="sin_medicion_con_cobertura"),
    pytest.param(evento_con_version_futura, id="version_futura"),
    pytest.param(evento_con_event_id_no_uuid, id="event_id_no_uuid"),
    pytest.param(evento_con_instante_sin_z_utc, id="instante_sin_z_utc"),
    pytest.param(evento_con_fecha_invalida, id="fecha_invalida"),
    pytest.param(evento_sin_campo_obligatorio, id="falta_campo_obligatorio"),
]


@pytest.mark.parametrize("construir_evento_malformado", MUTACIONES_MALFORMADAS)
def test_el_esquema_rechaza_los_eventos_de_uso_malformados(
    construir_evento_malformado,
):
    """Cada mutación rompe una regla del contrato: el esquema la rechaza."""
    evento_malformado = construir_evento_malformado()
    with pytest.raises(ValidationError):
        VALIDADOR_USO.validate(evento_malformado)


def test_el_esquema_rechaza_un_acuse_con_estado_desconocido():
    acuse = copia_del_acuse("aceptado_201")
    acuse["estado"] = "aceptada"
    with pytest.raises(ValidationError):
        VALIDADOR_ACUSE.validate(acuse)


def test_el_esquema_rechaza_un_error_con_codigo_desconocido():
    error = copia_del_acuse("conflicto_409")
    error["codigo"] = "otra_cosa"
    with pytest.raises(ValidationError):
        VALIDADOR_ERROR.validate(error)
