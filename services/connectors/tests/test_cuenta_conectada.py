"""
FE-01 — Cuentas conectadas por organización.

Las pruebas siguen los criterios de aceptación de la tarjeta:

- la migración crea un modelo aislado por tenant
- las respuestas no contienen `access_token`, `refresh_token` ni claves
"""

import uuid

import pytest
from django.db import IntegrityError, connection
from rest_framework import serializers

from connectors.models import CuentaConectada
from connectors.serializers import CuentaConectadaSerializer

pytestmark = pytest.mark.django_db

TOKEN = "ya29.a0AfB_token-de-prueba-largo"
ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")


def crear(org=ORG_A, proveedor="gmail", cuenta="persona@gmail.com", **extra):
    return CuentaConectada.objects.create(
        organizacion_id=org, proveedor=proveedor, cuenta_externa=cuenta, **extra
    )


# ── Aislamiento por organización ─────────────────────────────────────────


def test_la_cuenta_pertenece_a_una_organizacion(claves):
    cuenta = crear()
    assert cuenta.organizacion_id == ORG_A
    assert isinstance(cuenta.id, uuid.UUID)


def test_cada_organizacion_solo_ve_lo_suyo(claves):
    crear(org=ORG_A, cuenta="a@gmail.com")
    crear(org=ORG_B, cuenta="b@gmail.com")

    de_a = CuentaConectada.objects.filter(organizacion_id=ORG_A)
    assert de_a.count() == 1
    assert de_a.first().cuenta_externa == "a@gmail.com"


def test_dos_organizaciones_pueden_conectar_la_misma_cuenta(claves):
    """La unicidad es por organización, no global: que otra empresa ya haya
    conectado ese correo no puede impedírmelo a mí."""
    crear(org=ORG_A, cuenta="compartida@gmail.com")
    crear(org=ORG_B, cuenta="compartida@gmail.com")

    assert CuentaConectada.objects.count() == 2


def test_la_misma_organizacion_no_conecta_dos_veces_la_misma_cuenta(claves):
    crear(org=ORG_A, cuenta="repetida@gmail.com")
    with pytest.raises(IntegrityError):
        crear(org=ORG_A, cuenta="repetida@gmail.com")


def test_el_mismo_correo_en_dos_proveedores_si_se_puede(claves):
    crear(org=ORG_A, proveedor="gmail", cuenta="persona@dominio.cl")
    crear(org=ORG_A, proveedor="outlook", cuenta="persona@dominio.cl")

    assert CuentaConectada.objects.filter(organizacion_id=ORG_A).count() == 2


# ── Los tokens no quedan legibles ────────────────────────────────────────


def test_la_base_no_guarda_el_token_en_claro(claves):
    cuenta = crear(access_token=TOKEN, refresh_token=TOKEN)

    # Se leen todas las filas en vez de filtrar por id: sqlite guarda los UUID
    # sin guiones y Postgres con ellos, así que un WHERE id = %s solo calza en
    # uno de los dos. Acá hay una sola fila.
    with connection.cursor() as cur:
        cur.execute("SELECT access_token, refresh_token FROM cuenta_conectada")
        filas = cur.fetchall()

    assert len(filas) == 1
    guardado_access, guardado_refresh = filas[0]

    assert TOKEN not in str(guardado_access)
    assert TOKEN not in str(guardado_refresh)
    assert str(guardado_access).startswith("gAAAA")  # token Fernet

    # Y al leer por el ORM vuelve el valor original.
    assert CuentaConectada.objects.get(pk=cuenta.pk).access_token == TOKEN


def test_cada_guardado_produce_un_cifrado_distinto(claves):
    """Mismo texto, cifrados distintos: por eso no se puede buscar por token."""
    crear(cuenta="una@gmail.com", access_token=TOKEN)
    crear(cuenta="otra@gmail.com", access_token=TOKEN)

    with connection.cursor() as cur:
        cur.execute("SELECT access_token FROM cuenta_conectada")
        cifrados = {fila[0] for fila in cur.fetchall()}

    assert len(cifrados) == 2


# ── Las respuestas no exponen secretos ───────────────────────────────────


def test_el_serializer_no_devuelve_los_tokens(claves):
    cuenta = crear(access_token=TOKEN, refresh_token=TOKEN)
    datos = CuentaConectadaSerializer(cuenta).data

    assert "access_token" not in datos
    assert "refresh_token" not in datos
    assert TOKEN not in str(datos)


def test_un_serializer_con_todos_los_campos_tampoco_los_devuelve(claves):
    """La red de seguridad de FE-06: aunque alguien escriba un serializer sin
    pensar, el campo sale write_only por estar registrado en el mapeo."""

    class Descuidado(serializers.ModelSerializer):
        class Meta:
            model = CuentaConectada
            fields = "__all__"

    cuenta = crear(access_token=TOKEN, refresh_token=TOKEN)
    datos = Descuidado(cuenta).data

    assert "access_token" not in datos
    assert "refresh_token" not in datos
    assert TOKEN not in str(datos)


def test_el_token_si_entra_por_el_serializer(claves):
    serializer = CuentaConectadaSerializer(
        data={
            "proveedor": "gmail",
            "cuenta_externa": "entra@gmail.com",
            "access_token": TOKEN,
        }
    )
    assert serializer.is_valid(), serializer.errors
    cuenta = serializer.save(organizacion_id=ORG_A)

    assert CuentaConectada.objects.get(pk=cuenta.pk).access_token == TOKEN
    assert TOKEN not in str(CuentaConectadaSerializer(cuenta).data)


def test_la_respuesta_trae_lo_que_el_usuario_necesita(claves):
    cuenta = crear(access_token=TOKEN)
    datos = CuentaConectadaSerializer(cuenta).data

    assert datos["proveedor"] == "gmail"
    assert datos["proveedor_legible"] == "Gmail"
    assert datos["cuenta_externa"] == "persona@gmail.com"
    assert datos["estado"] == "conectada"
    assert datos["necesita_reautorizacion"] is False


# ── Estados y reautorización ─────────────────────────────────────────────


def test_nace_conectada(claves):
    assert crear().estado == CuentaConectada.Estado.CONECTADA


def test_marcar_para_reautorizar_no_pisa_los_tokens(claves):
    cuenta = crear(access_token=TOKEN)
    cuenta.marcar_para_reautorizar("el proveedor revocó el permiso")

    guardada = CuentaConectada.objects.get(pk=cuenta.pk)
    assert guardada.estado == CuentaConectada.Estado.REQUIERE_REAUTORIZACION
    assert guardada.detalle_del_estado == "el proveedor revocó el permiso"
    assert guardada.necesita_reautorizacion is True
    assert guardada.access_token == TOKEN


def test_una_cuenta_con_la_clave_perdida_pide_reautorizar_sin_romper(claves):
    """Si se rotó la clave sin re-cifrar, la fila queda ilegible. El listado
    tiene que seguir funcionando y esa cuenta quedar marcada."""
    from shared.cifrado.cifrador import generar_clave

    cuenta = crear(access_token=TOKEN)
    claves(generar_clave())  # clave nueva, la vieja ya no está

    guardada = CuentaConectada.objects.get(pk=cuenta.pk)
    assert not guardada.access_token  # SECRETO_ILEGIBLE es falsy
    assert guardada.necesita_reautorizacion is True

    # Lo importante: el listado completo no revienta.
    assert CuentaConectada.objects.filter(organizacion_id=ORG_A).count() == 1
    assert TOKEN not in str(CuentaConectadaSerializer(guardada).data)
