"""Contrato cruzado Python → TypeScript del sobre ``uso.registrado``.

El publicador real vive en Python y el consumidor real en TypeScript. Cada
lado puede pasar sus propias pruebas y aun así romperse en el borde: Python
serializaba ``ocurrido_en`` con 6 decimales cuando el ``datetime`` traía
microsegundos, y el validador TypeScript solo acepta 1–3.

Esta prueba construye el sobre con ``crear_sobre_uso`` (no un JSON a mano) y
lo pasa por el mismo ``ProcesadorUso`` que usa el worker. Así el desajuste de
precisión se reproduce de verdad y no queda cubierto por un doble.
"""

from __future__ import annotations

import datetime as dt
import json
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from app.models import OutboxEvento
from events.uso import (
    EVENTO_USO,
    VERSION_USO,
    crear_sobre_uso,
    datos_uso,
)

RAIZ = Path(__file__).resolve().parents[3]
SERVICIO_TS = RAIZ / "services" / "analytics-uso"
TSX = SERVICIO_TS / "node_modules" / "tsx" / "dist" / "cli.mjs"
SCRIPT = SERVICIO_TS / "tests" / "cruzado" / "validar-sobre-python.ts"

EVENT_ID = "22222222-2222-4222-8222-222222222222"
RECOLECTOR_ID = "33333333-3333-4333-8333-333333333333"
SUSCRIPCION_ID = "11111111-1111-4111-8111-111111111111"
USUARIO_ID = "44444444-4444-4444-8444-444444444444"
USUARIO_ID_INT = 42
USUARIO_ID_INT_UUID = "9180eff3-4e75-5137-95fa-1879656f1c43"
ORGANIZACION_ID = "55555555-5555-4555-8555-555555555555"

CUERPO_CANONICO = {
    "version": 1,
    "event_id": EVENT_ID,
    "recolector_id": RECOLECTOR_ID,
    "origen": "android",
    "inicio": "2026-11-09T12:00:00Z",
    "fin": "2026-11-09T12:02:00Z",
    "duracion_ms": 30000,
    "tramos_actividad": [
        {"inicio": "2026-11-09T12:00:00Z", "fin": "2026-11-09T12:00:30Z"}
    ],
    "zona_horaria": "America/Santiago",
    "cobertura": "completa",
    "estado": "activo",
}

OCURRIDO_CON_MICROSEGUNDOS = dt.datetime(
    2026, 11, 9, 12, 2, 1, 123456, tzinfo=dt.timezone.utc
)


def _sobre(*, usuario_id=USUARIO_ID) -> dict:
    """Sobre real del outbox, con microsegundos en ``ocurrido_en``."""
    evento = OutboxEvento(
        id=uuid.uuid4(),
        organizacion_id=uuid.UUID(ORGANIZACION_ID),
        evento=EVENTO_USO,
        version=VERSION_USO,
        ocurrido_en=OCURRIDO_CON_MICROSEGUNDOS,
        correlation_id=uuid.uuid4(),
        datos=datos_uso(
            evento=CUERPO_CANONICO,
            suscripcion_id=SUSCRIPCION_ID,
            usuario_id=usuario_id,
        ),
    )
    return crear_sobre_uso(evento)


def _ejecutar_typescript(
    sobre: dict, tmp_path: Path, modo: str | None = None
) -> subprocess.CompletedProcess:
    """Pasa el sobre por el validador y el procesador TypeScript reales."""
    node = shutil.which("node")
    if node is None:
        pytest.fail(
            "no se encontró `node` en PATH; la prueba cruzada necesita Node.js "
            "para ejecutar el validador TypeScript"
        )
    if not TSX.exists():
        pytest.fail(
            f"falta {TSX}; ejecuta `npm ci` en services/analytics-uso antes de "
            "las pruebas de subscriptions"
        )

    archivo = tmp_path / "sobre-uso.json"
    archivo.write_text(json.dumps(sobre), encoding="utf-8")

    cmd = [node, str(TSX), str(SCRIPT), str(archivo)]
    if modo:
        cmd.append(modo)
    return subprocess.run(
        cmd,
        cwd=SERVICIO_TS,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )


def test_sobre_python_con_microsegundos_pasa_por_el_validador_typescript(tmp_path):
    sobre = _sobre()

    # El sobre real ya sale con 3 decimales, no con los 6 de Python.
    assert sobre["ocurrido_en"] == "2026-11-09T12:02:01.123Z"

    ejecucion = _ejecutar_typescript(sobre, tmp_path)

    assert ejecucion.returncode == 0, ejecucion.stdout + ejecucion.stderr
    salida = json.loads(ejecucion.stdout)
    assert salida == {
        "ok": True,
        "resultado": "aplicado",
        "ocurridoEn": "2026-11-09T12:02:01.123Z",
        "fechaLocal": "2026-11-09",
        "eventId": EVENT_ID,
        "usuarioId": USUARIO_ID,
        "llamadasAlRepositorio": 1,
    }


@pytest.mark.parametrize("campo", ["inicio", "fin"])
def test_validador_typescript_rechaza_inicio_o_fin_con_microsegundos(
    tmp_path, campo
):
    """La precisión se corrige en Python; el contrato TypeScript no se relaja."""
    sobre = _sobre()
    sobre["datos"][campo] = sobre["datos"][campo].replace(
        "00Z", "00.123456Z"
    )

    ejecucion = _ejecutar_typescript(sobre, tmp_path)

    assert ejecucion.returncode == 2, ejecucion.stdout + ejecucion.stderr
    salida = json.loads(ejecucion.stdout)
    assert salida["ok"] is False
    assert salida["nombre"] == "ErrorValidacionUso"
    assert salida["codigo"] == "evento_invalido"
    assert f"datos.{campo}" in salida["mensaje"]


def test_usuario_entero_auth_se_mapea_a_uuid_rfc_determinista():
    """El entero de Auth no puede viajar como UUID(int=...); usa UUIDv5 documentado."""
    datos = datos_uso(
        evento=CUERPO_CANONICO,
        suscripcion_id=SUSCRIPCION_ID,
        usuario_id=USUARIO_ID_INT,
    )

    assert datos["usuario_id"] == USUARIO_ID_INT_UUID
    # Debe ser RFC 4122 (versión 5, variante RFC) para pasar z.string().uuid().
    uuid.UUID(datos["usuario_id"])  # parsea
    assert uuid.UUID(datos["usuario_id"]).version == 5


def test_sobre_python_con_usuario_entero_auth_pasa_validador_ts_y_reintento(tmp_path):
    sobre = _sobre(usuario_id=USUARIO_ID_INT)

    assert sobre["datos"]["usuario_id"] == USUARIO_ID_INT_UUID

    ejecucion = _ejecutar_typescript(sobre, tmp_path, modo="retry")

    assert ejecucion.returncode == 0, ejecucion.stdout + ejecucion.stderr
    salida = json.loads(ejecucion.stdout)
    assert salida == {
        "ok": True,
        "resultado": "aplicado",
        "ocurridoEn": "2026-11-09T12:02:01.123Z",
        "fechaLocal": "2026-11-09",
        "eventId": EVENT_ID,
        "usuarioId": USUARIO_ID_INT_UUID,
        "llamadasAlRepositorio": 2,
        "resultadoReintento": "aplicado",
    }
