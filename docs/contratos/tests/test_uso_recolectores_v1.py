"""Regresiones del contrato canónico de uso de recolectores v1 (S3-VI-01).

Valida las fixtures de docs/contratos/uso-recolectores-v1.ejemplos.json contra
docs/contratos/uso-recolectores-v1.schema.json y las reglas cruzadas que el
esquema no puede expresar. El contrato sustituye la propuesta previa de la
PR #148: la suscripción se resuelve en la ruta y el cuerpo no lleva
usuario_id, organizacion_id ni suscripcion_id.

No prueba al productor (recolectores, S3-MX-01) ni al receptor (Analytics):
fija el contrato acordado para que ninguna de las dos partes lo desalinee sola.

Desde la raíz del repo:

    python -m pip install "jsonschema[format]==4.26.0" "pytest==8.3.4"
    python -m pytest docs/contratos/tests -v
"""

import copy
import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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

# Casos y límites acordados en el contrato canónico.
RUTA_CANONICA = "/api/suscripciones/{suscripcion_id}/uso/recolector/"
DURACION_MS_MAXIMA = 9_007_199_254_740_991
NOMBRES_EVENTOS_USO = [
    "android",
    "navegador",
    "medianoche",
    "precision_30s_mas_30s",
    "pausa_conocida",
]
NOMBRES_ACUSES = ["aceptado_201", "duplicado_200", "conflicto_409"]
CAMPOS_IDENTIDAD_PROHIBIDOS = ["usuario_id", "organizacion_id", "suscripcion_id"]
ZONA_DE_INFORME = "America/Santiago"
DIA_LOCAL_DE_PRUEBA = date(2026, 11, 9)

EVENTOS_USO_POR_NOMBRE = {
    caso["nombre"]: caso["evento"] for caso in EJEMPLOS["eventos_uso"]
}
SUSCRIPCIONES_POR_EVENTO = {
    caso["nombre"]: caso["suscripcion_id"] for caso in EJEMPLOS["eventos_uso"]
}
ACUSES_POR_NOMBRE = {caso["nombre"]: caso for caso in EJEMPLOS["acuses"]}
SIMULTANEIDAD_POR_NOMBRE = {
    caso["nombre"]: caso for caso in EJEMPLOS["simultaneidad"]
}
COBERTURA_POR_NOMBRE = {caso["nombre"]: caso for caso in EJEMPLOS["cobertura"]}
INVALIDOS_POR_NOMBRE = {caso["nombre"]: caso for caso in EJEMPLOS["casos_invalidos"]}


def validador_de(definicion: str) -> Draft202012Validator:
    """El mismo esquema, pero validando una definición como raíz."""
    raiz = dict(ESQUEMA)
    raiz["$ref"] = f"#/$defs/{definicion}"
    return Draft202012Validator(raiz, format_checker=FORMATOS)


VALIDADOR_COBERTURA = validador_de("CoverageIntervalPayload")


def instante(texto_rfc3339: str) -> datetime:
    """Parsea un RFC3339 UTC terminado en Z (fromisoformat pre-3.11 no lo toma)."""
    return datetime.fromisoformat(texto_rfc3339.removesuffix("Z") + "+00:00")


def duracion_tramo_ms(tramo: dict) -> int:
    """Milisegundos enteros entre el inicio y el fin de un tramo."""
    delta = instante(tramo["fin"]) - instante(tramo["inicio"])
    return delta.days * 86_400_000 + delta.seconds * 1000 + delta.microseconds // 1000


def duracion_union_ms(tramos: list[dict]) -> int:
    """Milisegundos de la unión de tramos: un solape cuenta una sola vez."""
    intervalos = sorted(
        (instante(tramo["inicio"]), instante(tramo["fin"])) for tramo in tramos
    )
    unidos: list[tuple[datetime, datetime]] = []
    for inicio, fin in intervalos:
        if unidos and inicio <= unidos[-1][1]:
            unidos[-1] = (unidos[-1][0], max(unidos[-1][1], fin))
        else:
            unidos.append((inicio, fin))
    return sum(
        (fin - inicio).days * 86_400_000
        + (fin - inicio).seconds * 1000
        + (fin - inicio).microseconds // 1000
        for inicio, fin in unidos
    )


def copia_del_evento(nombre_evento: str) -> dict:
    """Copia profunda de un fixture de uso: mutarla no toca el original."""
    return copy.deepcopy(EVENTOS_USO_POR_NOMBRE[nombre_evento])


def copia_del_acuse(nombre_acuse: str) -> dict:
    """Copia profunda del cuerpo de un acuse, por su nombre."""
    return copy.deepcopy(ACUSES_POR_NOMBRE[nombre_acuse]["cuerpo"])


def medianoche_local(dia: date, zona: ZoneInfo) -> datetime:
    """Medianoche local del día indicado, con el offset vigente en esa fecha."""
    return datetime.combine(dia, time.min, tzinfo=zona)


def validar_zona_horaria(evento: dict) -> ZoneInfo:
    """La zona debe existir en la base IANA; una cadena no vacía no basta."""
    try:
        return ZoneInfo(evento["zona_horaria"])
    except ZoneInfoNotFoundError as error:
        raise ValueError(f"zona_horaria desconocida: {evento['zona_horaria']}") from error


def validar_ventana_en_un_dia_local(evento: dict, zona: ZoneInfo) -> None:
    """Un evento cabe en un día local; fin puede ser la medianoche siguiente."""
    inicio = instante(evento["inicio"])
    fin = instante(evento["fin"])
    dia_inicio = inicio.astimezone(zona).date()
    dia_fin = fin.astimezone(zona).date()
    if dia_inicio == dia_fin:
        return
    if fin == medianoche_local(dia_inicio + timedelta(days=1), zona):
        return
    raise ValueError(
        f"la ventana cruza el día local {dia_inicio}: "
        f"{evento['inicio']} -> {evento['fin']}"
    )


def validar_semantica(evento: dict) -> None:
    """Reglas cruzadas que el JSON Schema no puede expresar."""
    zona = validar_zona_horaria(evento)
    inicio = instante(evento["inicio"])
    fin = instante(evento["fin"])
    if not inicio < fin:
        raise ValueError("inicio debe ser anterior a fin")

    validar_ventana_en_un_dia_local(evento, zona)

    tramos = evento["tramos_actividad"]
    anterior_fin = None
    for tramo in tramos:
        tramo_inicio = instante(tramo["inicio"])
        tramo_fin = instante(tramo["fin"])
        if not tramo_inicio < tramo_fin:
            raise ValueError("cada tramo debe cumplir inicio < fin")
        if tramo_inicio < inicio or tramo_fin > fin:
            raise ValueError("el tramo cae fuera de la ventana [inicio, fin)")
        if anterior_fin is not None and tramo_inicio < anterior_fin:
            raise ValueError("los tramos deben estar ordenados y sin solapes internos")
        anterior_fin = tramo_fin

    suma_tramos = sum(duracion_tramo_ms(tramo) for tramo in tramos)
    if evento["duracion_ms"] != suma_tramos:
        raise ValueError(
            "duracion_ms no coincide con la suma de los tramos: "
            f"{evento['duracion_ms']} != {suma_tramos}"
        )

    duracion_ventana = duracion_tramo_ms({"inicio": evento["inicio"], "fin": evento["fin"]})
    if evento["duracion_ms"] > duracion_ventana:
        raise ValueError("duracion_ms no puede superar la ventana observada")

    if evento["cobertura"] == "sin_medicion" and evento["duracion_ms"] > 0:
        raise ValueError("sin_medicion no acredita actividad positiva")
    if evento["estado"] != "activo" and evento["duracion_ms"] > 0:
        raise ValueError("un estado no activo no informa actividad positiva")


def validar_destino(suscripcion_id: str, autorizadas: list[str]) -> None:
    """La suscripción de la ruta debe pertenecer a la sesión autenticada."""
    if suscripcion_id not in autorizadas:
        raise ValueError("destino ajeno: la suscripción no pertenece a la sesión")


def cubre_dia_completo(ventanas: list[dict], zona: ZoneInfo, dia: date) -> bool:
    """La unión de ventanas de cobertura completa debe cubrir el día sin huecos."""
    inicio_dia = medianoche_local(dia, zona)
    fin_dia = medianoche_local(dia + timedelta(days=1), zona)
    cursor = inicio_dia
    for ventana in sorted(ventanas, key=lambda v: v["inicio"]):
        inicio = instante(ventana["inicio"])
        fin = instante(ventana["fin"])
        if fin <= cursor:
            continue
        if inicio > cursor:
            return False
        cursor = max(cursor, fin)
        if cursor >= fin_dia:
            return True
    return cursor >= fin_dia


# --- Fixtures válidas: todo lo que el contrato declara válido pasa el esquema.


def test_los_casos_de_uso_son_los_acordados():
    """Guarda: renombrar o quitar un caso de ejemplos.json no pasa inadvertido."""
    assert [caso["nombre"] for caso in EJEMPLOS["eventos_uso"]] == NOMBRES_EVENTOS_USO


def test_la_ruta_canonica_resuelve_la_suscripcion_en_la_url():
    """La suscripción no viaja en el cuerpo: viaja en la ruta canónica."""
    assert EJEMPLOS["ruta_canonica"] == RUTA_CANONICA
    for caso in EJEMPLOS["eventos_uso"]:
        ruta = RUTA_CANONICA.format(suscripcion_id=caso["suscripcion_id"])
        assert ruta == f"/api/suscripciones/{caso['suscripcion_id']}/uso/recolector/"


def test_los_acuses_cubren_aceptado_duplicado_y_conflicto():
    """Guarda: los tres acuses del contrato (201, 200 y 409) están presentes."""
    assert [caso["nombre"] for caso in EJEMPLOS["acuses"]] == NOMBRES_ACUSES


@pytest.mark.parametrize("nombre_evento", NOMBRES_EVENTOS_USO)
def test_el_evento_de_uso_pasa_el_esquema(nombre_evento):
    """Cada caso válido (Android, navegador, medianoche, precisión y pausa)."""
    VALIDADOR_USO.validate(EVENTOS_USO_POR_NOMBRE[nombre_evento])


@pytest.mark.parametrize("nombre_evento", NOMBRES_EVENTOS_USO)
def test_el_evento_de_uso_pasa_la_semantica(nombre_evento):
    """Las reglas cruzadas también aceptan todas las fixtures válidas."""
    validar_semantica(EVENTOS_USO_POR_NOMBRE[nombre_evento])


def test_el_cuerpo_no_lleva_identidad_ni_suscripcion():
    """El cuerpo no repite usuario_id, organizacion_id ni suscripcion_id."""
    for evento in EVENTOS_USO_POR_NOMBRE.values():
        for campo in CAMPOS_IDENTIDAD_PROHIBIDOS:
            assert campo not in evento


def test_android_reporta_actividad_positiva():
    """Android es el caso con actividad positiva: tramos que suman duracion_ms."""
    evento = EVENTOS_USO_POR_NOMBRE["android"]
    assert evento["origen"] == "android"
    assert evento["estado"] == "activo"
    assert evento["duracion_ms"] == 30000
    assert evento["tramos_actividad"]
    assert (
        sum(duracion_tramo_ms(tramo) for tramo in evento["tramos_actividad"])
        == evento["duracion_ms"]
    )


def test_navegador_reporta_cero_observado():
    """Navegador es el caso cero observado: se midió y no hubo actividad."""
    evento = EVENTOS_USO_POR_NOMBRE["navegador"]
    assert evento["origen"] == "navegador"
    assert evento["estado"] == "activo"
    assert evento["cobertura"] == "completa"
    assert evento["duracion_ms"] == 0
    assert evento["tramos_actividad"] == []


def test_android_y_navegador_miden_la_misma_suscripcion_y_ventana():
    """Los dos orígenes observan el mismo destino y la misma ventana."""
    android = EVENTOS_USO_POR_NOMBRE["android"]
    navegador = EVENTOS_USO_POR_NOMBRE["navegador"]
    assert SUSCRIPCIONES_POR_EVENTO["android"] == SUSCRIPCIONES_POR_EVENTO["navegador"]
    assert (android["inicio"], android["fin"]) == (navegador["inicio"], navegador["fin"])


def test_los_acuses_repiten_event_id_y_suscripcion_del_evento_enviado():
    """El acuse confirma qué hecho y qué destino quedaron registrados."""
    event_id_enviado = EVENTOS_USO_POR_NOMBRE["android"]["event_id"]
    suscripcion_enviada = SUSCRIPCIONES_POR_EVENTO["android"]
    for nombre in ("aceptado_201", "duplicado_200"):
        acuse = ACUSES_POR_NOMBRE[nombre]["cuerpo"]
        assert acuse["event_id"] == event_id_enviado
        assert acuse["suscripcion_id"] == suscripcion_enviada


def test_el_acuse_201_y_200_solo_cambian_el_estado():
    """Un reintento conserva event_id, suscripción y recibido_en original."""
    aceptado = copia_del_acuse("aceptado_201")
    duplicado = copia_del_acuse("duplicado_200")
    assert ACUSES_POR_NOMBRE["aceptado_201"]["estado_http"] == 201
    assert ACUSES_POR_NOMBRE["duplicado_200"]["estado_http"] == 200
    assert {**duplicado, "estado": "aceptado"} == aceptado


def test_el_409_usa_codigo_y_mensaje_canonicos():
    """El conflicto de idempotencia se reporta como event_id_conflictivo."""
    conflicto = ACUSES_POR_NOMBRE["conflicto_409"]
    assert conflicto["estado_http"] == 409
    assert set(conflicto["cuerpo"]) == {"codigo", "mensaje"}
    assert conflicto["cuerpo"]["codigo"] == "event_id_conflictivo"
    assert conflicto["cuerpo"]["mensaje"]


def test_la_precision_de_30s_mas_30s_se_conserva():
    """Dos tramos de 30 s suman 60000 ms exactos; no se redondea a minutos."""
    evento = EVENTOS_USO_POR_NOMBRE["precision_30s_mas_30s"]
    duraciones = [duracion_tramo_ms(tramo) for tramo in evento["tramos_actividad"]]
    assert duraciones == [30000, 30000]
    assert evento["duracion_ms"] == 60000


def test_el_evento_de_medianoche_termina_en_el_limite_local():
    """fin puede coincidir con la medianoche siguiente del día local."""
    evento = EVENTOS_USO_POR_NOMBRE["medianoche"]
    zona = ZoneInfo(ZONA_DE_INFORME)
    fin = instante(evento["fin"])
    assert fin == medianoche_local(DIA_LOCAL_DE_PRUEBA + timedelta(days=1), zona)
    assert evento["tramos_actividad"][-1]["fin"] == evento["fin"]
    validar_semantica(evento)


# --- Unión temporal: la suscripción acredita lo observado, no la suma por fuente.


def test_la_union_de_recolectores_no_duplica_el_mismo_tramo():
    """Android y navegador sobre la misma ventana: 120 s de uso, no 240 s."""
    caso = SIMULTANEIDAD_POR_NOMBRE["misma_ventana_120s"]
    assert duracion_union_ms(caso["tramos"]) == caso["union_esperada_ms"] == 120000
    assert sum(duracion_tramo_ms(tramo) for tramo in caso["tramos"]) == 240000


def test_la_union_resuelve_un_solapamiento_parcial():
    """Dos ventanas de 2 min desplazadas 1 min: 180 s de uso, no 240 s."""
    caso = SIMULTANEIDAD_POR_NOMBRE["solape_parcial_180s"]
    assert duracion_union_ms(caso["tramos"]) == caso["union_esperada_ms"] == 180000


def test_la_union_exacta_resuelve_un_solape_de_cincuenta_segundos():
    """Dos tramos de 30 s con 10 s de solape: 50 s, no 60 s ni min(suma, ventana)."""
    caso = SIMULTANEIDAD_POR_NOMBRE["solape_cincuenta_s"]
    assert duracion_union_ms(caso["tramos"]) == caso["union_esperada_ms"] == 50000
    assert caso["suma_por_fuente_ms"] == 60000


# --- Cobertura: se acredita con la unión de ventanas, no con mínimo y máximo.


def test_la_cobertura_completa_sin_huecos_acredita_el_dia():
    caso = COBERTURA_POR_NOMBRE["dia_completo_sin_huecos"]
    zona = ZoneInfo(ZONA_DE_INFORME)
    assert cubre_dia_completo(caso["ventanas"], zona, DIA_LOCAL_DE_PRUEBA)
    assert caso["acredita_dia_completo"] is True


def test_los_huecos_no_se_rellenan_con_el_minimo_y_el_maximo():
    caso = COBERTURA_POR_NOMBRE["huecos_no_acreditan_dia"]
    zona = ZoneInfo(ZONA_DE_INFORME)
    inicio_minimo = min(instante(v["inicio"]) for v in caso["ventanas"])
    fin_maximo = max(instante(v["fin"]) for v in caso["ventanas"])
    assert fin_maximo - inicio_minimo == timedelta(hours=24)
    assert duracion_union_ms(caso["ventanas"]) == 22 * 60 * 60 * 1000
    assert not cubre_dia_completo(caso["ventanas"], zona, DIA_LOCAL_DE_PRUEBA)
    assert caso["acredita_dia_completo"] is False


def test_sin_medicion_no_acredita_actividad_ni_cobertura_completa():
    """Una pausa conocida no se lee como cero observado."""
    evento = EVENTOS_USO_POR_NOMBRE["pausa_conocida"]
    assert evento["cobertura"] == "sin_medicion"
    assert evento["estado"] == "pausado"
    assert evento["duracion_ms"] == 0
    assert evento["tramos_actividad"] == []


def test_sin_medicion_sigue_siendo_valido_si_no_hay_actividad():
    evento = copia_del_evento("navegador")
    evento["cobertura"] = "sin_medicion"
    evento["estado"] = "sin_permiso"
    VALIDADOR_USO.validate(evento)
    validar_semantica(evento)


def test_duracion_ms_acepta_el_limite_del_esquema():
    """El máximo del esquema es el entero seguro de JavaScript."""
    evento = copia_del_evento("android")
    evento["duracion_ms"] = DURACION_MS_MAXIMA
    VALIDADOR_USO.validate(evento)


def test_la_proyeccion_interna_de_cobertura_pasa_el_esquema():
    """CoverageIntervalPayload es la proyección derivada, no una entrada pública."""
    proyeccion = {
        "version": 1,
        "coverage_id": "12345678-1234-4234-8234-123456789abc",
        "event_id": EVENTOS_USO_POR_NOMBRE["android"]["event_id"],
        "usuario_id": "5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d",
        "suscripcion_id": SUSCRIPCIONES_POR_EVENTO["android"],
        "recolector_id": EVENTOS_USO_POR_NOMBRE["android"]["recolector_id"],
        "origen": "android",
        "inicio": "2026-11-09T12:00:00Z",
        "fin": "2026-11-09T12:02:00Z",
        "zona_horaria": ZONA_DE_INFORME,
        "cobertura": "completa",
        "estado": "activo",
    }
    VALIDADOR_COBERTURA.validate(proyeccion)
    with pytest.raises(ValidationError):
        VALIDADOR_USO.validate(proyeccion)


# --- Casos inválidos: esquema, autorización y reglas cruzadas.


def test_el_esquema_rechaza_identidad_en_el_cuerpo():
    """usuario_id, organizacion_id y suscripcion_id se resuelven fuera del cuerpo."""
    for campo in CAMPOS_IDENTIDAD_PROHIBIDOS:
        evento = copia_del_evento("android")
        evento[campo] = "5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d"
        with pytest.raises(ValidationError):
            VALIDADOR_USO.validate(evento)


def test_un_destino_ajeno_se_rechaza_por_autorizacion():
    """La autorización no es del esquema: se comprueba antes de responder."""
    caso = INVALIDOS_POR_NOMBRE["destino_ajeno"]
    with pytest.raises(ValueError):
        validar_destino(caso["suscripcion_id"], caso["suscripciones_de_la_sesion"])


def evento_con_estado_desconocido() -> dict:
    evento = copia_del_evento("android")
    evento["estado"] = "con_uso"
    return evento


def evento_con_version_futura() -> dict:
    evento = copia_del_evento("android")
    evento["version"] = 2
    return evento


def evento_con_event_id_no_v4() -> dict:
    evento = copia_del_evento("android")
    evento["event_id"] = "71cf2b28-055e-170e-b7c2-6800310ef536"
    return evento


def evento_con_recolector_id_no_uuid() -> dict:
    evento = copia_del_evento("android")
    evento["recolector_id"] = "recolector-windows-8f14"
    return evento


def evento_con_origen_no_permitido() -> dict:
    evento = copia_del_evento("android")
    evento["origen"] = "cliente_windows"
    return evento


def evento_con_instante_sin_z_utc() -> dict:
    evento = copia_del_evento("android")
    evento["inicio"] = "2026-11-09T12:00:00+03:00"
    return evento


def evento_con_cuatro_decimales() -> dict:
    """El contrato admite hasta tres decimales de segundo."""
    evento = copia_del_evento("android")
    evento["fin"] = "2026-11-09T12:02:00.0001Z"
    return evento


def evento_con_duracion_ms_negativa() -> dict:
    evento = copia_del_evento("android")
    evento["duracion_ms"] = -1
    return evento


def evento_con_duracion_ms_de_texto() -> dict:
    evento = copia_del_evento("android")
    evento["duracion_ms"] = "30000"
    return evento


def evento_con_duracion_ms_fraccionaria() -> dict:
    evento = copia_del_evento("android")
    evento["duracion_ms"] = 30000.5
    return evento


def evento_con_duracion_ms_nula() -> dict:
    evento = copia_del_evento("android")
    evento["duracion_ms"] = None
    return evento


def evento_con_duracion_ms_booleana() -> dict:
    evento = copia_del_evento("android")
    evento["duracion_ms"] = True
    return evento


def evento_con_cobertura_desconocida() -> dict:
    evento = copia_del_evento("android")
    evento["cobertura"] = "total"
    return evento


def evento_con_tramo_con_campo_extra() -> dict:
    evento = copia_del_evento("android")
    evento["tramos_actividad"][0]["app"] = "banco"
    return evento


def evento_sin_campo_obligatorio() -> dict:
    evento = copia_del_evento("android")
    del evento["recolector_id"]
    return evento


MUTACIONES_MALFORMADAS = [
    pytest.param(evento_con_estado_desconocido, id="estado_desconocido"),
    pytest.param(evento_con_version_futura, id="version_futura"),
    pytest.param(evento_con_event_id_no_v4, id="event_id_no_v4"),
    pytest.param(evento_con_recolector_id_no_uuid, id="recolector_id_no_uuid"),
    pytest.param(evento_con_origen_no_permitido, id="origen_no_permitido"),
    pytest.param(evento_con_instante_sin_z_utc, id="instante_sin_z_utc"),
    pytest.param(evento_con_cuatro_decimales, id="cuatro_decimales"),
    pytest.param(evento_con_duracion_ms_negativa, id="duracion_ms_negativa"),
    pytest.param(evento_con_duracion_ms_de_texto, id="duracion_ms_de_texto"),
    pytest.param(evento_con_duracion_ms_fraccionaria, id="duracion_ms_fraccionaria"),
    pytest.param(evento_con_duracion_ms_nula, id="duracion_ms_nula"),
    pytest.param(evento_con_duracion_ms_booleana, id="duracion_ms_booleana"),
    pytest.param(evento_con_cobertura_desconocida, id="cobertura_desconocida"),
    pytest.param(evento_con_tramo_con_campo_extra, id="tramo_con_campo_extra"),
    pytest.param(evento_sin_campo_obligatorio, id="falta_campo_obligatorio"),
]


@pytest.mark.parametrize("construir_evento_malformado", MUTACIONES_MALFORMADAS)
def test_el_esquema_rechaza_los_eventos_de_uso_malformados(
    construir_evento_malformado,
):
    """Cada mutación rompe una regla del esquema: se rechaza."""
    with pytest.raises(ValidationError):
        VALIDADOR_USO.validate(construir_evento_malformado())


@pytest.mark.parametrize(
    "caso", EJEMPLOS["casos_invalidos"], ids=list(INVALIDOS_POR_NOMBRE)
)
def test_los_casos_invalidos_se_rechazan(caso):
    """Cada caso negativo falla en el nivel que le corresponde."""
    if caso["nivel"] == "esquema":
        with pytest.raises(ValidationError):
            VALIDADOR_USO.validate(caso["evento"])
        return
    if caso["nivel"] == "autorizacion":
        with pytest.raises(ValueError):
            validar_destino(caso["suscripcion_id"], caso["suscripciones_de_la_sesion"])
        return
    # Un caso semántico puede pasar el esquema: lo rechazan las reglas cruzadas.
    VALIDADOR_USO.validate(caso["evento"])
    with pytest.raises(ValueError):
        validar_semantica(caso["evento"])


ESTADOS_DE_ACUSE = {"aceptado", "duplicado"}
CODIGOS_DE_ERROR = {
    "evento_invalido",
    "version_no_soportada",
    "detalle_actividad_invalido",
    "intervalo_cruza_dia_local",
    "event_id_conflictivo",
    "consentimiento_requerido",
}


def test_los_acuses_usan_los_campos_y_estados_del_contrato():
    """AcuseUso = {event_id, suscripcion_id, estado, recibido_en}."""
    for nombre in ("aceptado_201", "duplicado_200"):
        acuse = copia_del_acuse(nombre)
        assert set(acuse) == {"event_id", "suscripcion_id", "estado", "recibido_en"}
        assert acuse["estado"] in ESTADOS_DE_ACUSE
        assert acuse["recibido_en"].endswith("Z")


def test_el_error_uso_usa_codigo_y_mensaje():
    """ErrorUso = {codigo, mensaje}; el 409 usa event_id_conflictivo."""
    error = copia_del_acuse("conflicto_409")
    assert set(error) == {"codigo", "mensaje"}
    assert error["codigo"] in CODIGOS_DE_ERROR
    assert error["codigo"] == "event_id_conflictivo"
    assert error["mensaje"]


def test_los_codigos_de_error_son_los_acordados():
    """Guarda: un código nuevo exige actualizar contrato, DTO y pruebas."""
    assert CODIGOS_DE_ERROR == {
        "evento_invalido",
        "version_no_soportada",
        "detalle_actividad_invalido",
        "intervalo_cruza_dia_local",
        "event_id_conflictivo",
        "consentimiento_requerido",
    }
