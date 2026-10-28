"""
FE-08 — modelar importaciones y exponer su progreso (RF-05 / RF-19).

Lo que tiene que quedar demostrado, criterio por criterio:

- el polling devuelve un estado **estable y terminal**
- **no se consulta una importación de otra organización**
- terminar el análisis **no es** confirmar los candidatos
- los errores vienen **resumidos**, no cinco mil
"""

import uuid

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from connectors.models import CuentaConectada, Importacion

pytestmark = pytest.mark.django_db

ORG_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
ORG_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
USUARIO_A = "42"
USUARIO_B = "99"

LISTA = "/api/importaciones/"


@pytest.fixture
def cliente():
    return APIClient()


def cabecera(org=ORG_A, usuario=USUARIO_A):
    return {"X-Organizacion-Id": str(org), "X-Usuario-Id": str(usuario)}


def crear(org=ORG_A, usuario=USUARIO_A, **extra):
    datos = {
        "organizacion_id": org,
        "usuario_id": usuario,
        "origen": Importacion.Origen.CSV,
        "nombre_archivo": "cartola-octubre.csv",
    }
    datos.update(extra)
    return Importacion.objects.create(**datos)


# ── la máquina de estados ────────────────────────────────────────────


class TestMaquinaDeEstados:
    def test_nace_pendiente(self):
        assert crear().estado == Importacion.Estado.PENDIENTE

    def test_el_camino_feliz(self):
        imp = crear()
        assert imp.avanzar_a(Importacion.Estado.PROCESANDO) is True
        assert imp.avanzar_a(Importacion.Estado.COMPLETADA) is True
        assert imp.terminada is True

    def test_se_puede_fallar_desde_pendiente_y_desde_procesando(self):
        for desde in (Importacion.Estado.PENDIENTE, Importacion.Estado.PROCESANDO):
            imp = crear()
            if desde == Importacion.Estado.PROCESANDO:
                imp.avanzar_a(Importacion.Estado.PROCESANDO)
            assert imp.avanzar_a(Importacion.Estado.FALLIDA) is True

    def test_no_se_puede_saltar_de_pendiente_a_completada(self):
        """Completar sin haber procesado no significa nada."""
        imp = crear()
        with pytest.raises(ValueError, match="no se puede pasar"):
            imp.avanzar_a(Importacion.Estado.COMPLETADA)

    @pytest.mark.parametrize(
        "terminal", [Importacion.Estado.COMPLETADA, Importacion.Estado.FALLIDA]
    )
    @pytest.mark.parametrize(
        "destino",
        [
            Importacion.Estado.PENDIENTE,
            Importacion.Estado.PROCESANDO,
        ],
    )
    def test_un_estado_TERMINAL_no_vuelve_atras(self, terminal, destino):
        """El criterio: el polling devuelve un estado estable y terminal.

        Si una importación pudiera volver a `procesando`, el frontend que dejó
        de preguntar se quedaría con una respuesta vieja para siempre.
        """
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        imp.avanzar_a(terminal)
        with pytest.raises(ValueError):
            imp.avanzar_a(destino)
        imp.refresh_from_db()
        assert imp.estado == terminal

    def test_una_terminal_no_pasa_a_la_otra(self):
        """Completada y fallida son dos finales, no dos pasos."""
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        imp.avanzar_a(Importacion.Estado.COMPLETADA)
        with pytest.raises(ValueError):
            imp.avanzar_a(Importacion.Estado.FALLIDA)

    def test_repetir_el_estado_actual_no_rompe(self):
        """Dos workers que reporten "procesando" no deberían romperse."""
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        assert imp.avanzar_a(Importacion.Estado.PROCESANDO) is False
        assert imp.estado == Importacion.Estado.PROCESANDO

    def test_llegar_a_terminal_sella_la_fecha(self):
        antes = timezone.now()
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        assert imp.terminada_en is None
        imp.avanzar_a(Importacion.Estado.COMPLETADA)
        assert imp.terminada_en >= antes

    def test_los_estados_terminales_declarados_calzan_con_la_tabla(self):
        """Si alguien agrega un estado sin salida y no lo marca terminal,
        `terminada` mentiría."""
        sin_salida = {
            e for e, salidas in Importacion.TRANSICIONES.items() if not salidas
        }
        assert sin_salida == set(Importacion.ESTADOS_TERMINALES)

    def test_todos_los_estados_estan_en_la_tabla_de_transiciones(self):
        faltan = set(Importacion.Estado.values) - set(Importacion.TRANSICIONES)
        assert not faltan, f"estados sin transiciones declaradas: {sorted(faltan)}"


class TestInstanciasObsoletas:
    """Dos instancias leídas de la misma fila no pueden pisarse.

    La guarda de `avanzar_a` se evaluaba en memoria: con A y B leídas de la
    misma importación en `procesando`, las dos creen que pueden avanzar, las
    dos pasan la guarda, y la segunda pisa a la primera. Una importación que
    ya había reportado `completada` terminaba `fallida`.

    No hacen falta hilos: basta con dos instancias viejas. Lo reprodujo la
    revisión de la PR.
    """

    def test_la_segunda_instancia_NO_pisa_la_terminal_de_la_primera(self):
        """La reproducción exacta de la revisión."""
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)

        a = Importacion.objects.get(pk=imp.pk)
        b = Importacion.objects.get(pk=imp.pk)

        assert a.avanzar_a(Importacion.Estado.COMPLETADA) is True
        # B todavía cree que está procesando, así que pasa la guarda en
        # memoria. Lo que la detiene es la condición en el WHERE.
        assert b.avanzar_a(Importacion.Estado.FALLIDA) is False

        imp.refresh_from_db()
        assert imp.estado == Importacion.Estado.COMPLETADA, "la vieja piso a la nueva"

    def test_la_instancia_perdedora_queda_con_el_estado_REAL(self):
        """Si siguiera con el suyo, el llamador operaría sobre una mentira."""
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        a = Importacion.objects.get(pk=imp.pk)
        b = Importacion.objects.get(pk=imp.pk)

        a.avanzar_a(Importacion.Estado.COMPLETADA)
        b.avanzar_a(Importacion.Estado.FALLIDA)
        assert b.estado == Importacion.Estado.COMPLETADA

    def test_la_fecha_terminal_es_la_de_la_que_gano(self):
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        a = Importacion.objects.get(pk=imp.pk)
        b = Importacion.objects.get(pk=imp.pk)

        a.avanzar_a(Importacion.Estado.COMPLETADA)
        primera = Importacion.objects.get(pk=imp.pk).terminada_en
        b.avanzar_a(Importacion.Estado.FALLIDA)
        assert Importacion.objects.get(pk=imp.pk).terminada_en == primera

    def test_dos_instancias_no_confirman_dos_veces(self):
        """`confirmar_candidatos` decidía igual desde memoria: una reentrega
        del mismo evento movía la fecha de confirmación."""
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        imp.avanzar_a(Importacion.Estado.COMPLETADA)

        a = Importacion.objects.get(pk=imp.pk)
        b = Importacion.objects.get(pk=imp.pk)

        assert a.confirmar_candidatos() is True
        primera = Importacion.objects.get(pk=imp.pk).confirmada_en
        assert b.confirmar_candidatos() is False
        assert Importacion.objects.get(pk=imp.pk).confirmada_en == primera

    def test_el_polling_nunca_ve_retroceder_una_terminal(self, cliente):
        """La consecuencia que importa: lo que ve quien consulta."""
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        a = Importacion.objects.get(pk=imp.pk)
        b = Importacion.objects.get(pk=imp.pk)

        a.avanzar_a(Importacion.Estado.COMPLETADA)
        visto = cliente.get(f"{LISTA}{imp.id}/", headers=cabecera()).data
        assert visto["estado"] == "completada"

        b.avanzar_a(Importacion.Estado.FALLIDA)
        otra_vez = cliente.get(f"{LISTA}{imp.id}/", headers=cabecera()).data
        assert otra_vez["estado"] == "completada", "el polling vio retroceder el estado"
        assert otra_vez["terminada"] is True


# ── terminar ≠ confirmar ─────────────────────────────────────────────


class TestAnalisisVsConfirmacion:
    """El criterio que más importa no equivocar.

    Una importación `completada` significa "los candidatos están listos para
    que alguien los mire" (FE-10), **no** "ya se tocaron tus suscripciones".
    Eso recién pasa cuando la persona los confirma (FE-11).
    """

    def _completada(self, **extra):
        imp = crear(**extra)
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        imp.avanzar_a(Importacion.Estado.COMPLETADA)
        return imp

    def test_completada_NO_implica_confirmada(self):
        imp = self._completada(candidatos_detectados=4)
        assert imp.terminada is True
        assert imp.confirmada_en is None

    def test_confirmar_es_un_hito_aparte(self):
        imp = self._completada()
        assert imp.confirmar_candidatos() is True
        assert imp.confirmada_en is not None
        # Y no cambia el estado: sigue completada.
        assert imp.estado == Importacion.Estado.COMPLETADA

    def test_confirmar_dos_veces_no_mueve_la_fecha(self):
        imp = self._completada()
        imp.confirmar_candidatos()
        primera = imp.confirmada_en
        assert imp.confirmar_candidatos() is False
        assert imp.confirmada_en == primera

    def test_no_se_confirman_los_candidatos_de_una_que_fallo(self):
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        imp.avanzar_a(Importacion.Estado.FALLIDA)
        with pytest.raises(ValueError, match="completada"):
            imp.confirmar_candidatos()

    def test_no_se_confirman_los_de_una_que_todavia_corre(self):
        imp = crear()
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        with pytest.raises(ValueError, match="completada"):
            imp.confirmar_candidatos()

    def test_la_API_distingue_los_dos_hitos(self, cliente):
        """Quien haga polling tiene que poder diferenciarlos sin adivinar."""
        imp = self._completada(candidatos_detectados=3)
        respuesta = cliente.get(f"{LISTA}{imp.id}/", headers=cabecera())
        assert respuesta.data["terminada"] is True
        assert respuesta.data["candidatos_confirmados"] is False
        assert respuesta.data["candidatos_detectados"] == 3

        imp.confirmar_candidatos()
        respuesta = cliente.get(f"{LISTA}{imp.id}/", headers=cabecera())
        assert respuesta.data["candidatos_confirmados"] is True


# ── el progreso ──────────────────────────────────────────────────────


class TestProgreso:
    def test_sin_total_conocido_el_progreso_es_null_no_cero(self):
        """Son cosas distintas: una barra indeterminada no es una vacía. Una
        lectura de correo no sabe cuántos mensajes hay hasta pedirlos."""
        imp = crear(origen=Importacion.Origen.CORREO, filas_totales=None)
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        assert imp.progreso is None

    def test_con_total_conocido_calcula_el_porcentaje(self):
        imp = crear(filas_totales=200, filas_procesadas=50)
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        assert imp.progreso == 25

    def test_una_terminal_es_100_aunque_no_se_supiera_el_total(self):
        imp = crear(filas_totales=None)
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        imp.avanzar_a(Importacion.Estado.COMPLETADA)
        assert imp.progreso == 100

    def test_el_progreso_no_pasa_de_100(self):
        """Si el proceso contara de más, la barra no puede desbordarse."""
        imp = crear(filas_totales=10, filas_procesadas=15)
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        assert imp.progreso == 100

    def test_la_API_devuelve_el_progreso(self, cliente):
        imp = crear(filas_totales=4, filas_procesadas=1)
        imp.avanzar_a(Importacion.Estado.PROCESANDO)
        respuesta = cliente.get(f"{LISTA}{imp.id}/", headers=cabecera())
        assert respuesta.data["progreso"] == 25
        assert respuesta.data["terminada"] is False


# ── los errores, resumidos ───────────────────────────────────────────


class TestErrores:
    def test_anota_el_error_y_lo_cuenta(self):
        imp = crear()
        imp.anotar_error("fila_invalida", "falta el monto", fila=3)
        assert imp.errores_totales == 1
        assert imp.errores[0]["codigo"] == "fila_invalida"
        assert imp.errores[0]["fila"] == 3

    def test_guarda_como_maximo_los_primeros(self):
        """Un CSV de 5.000 filas malas no puede devolver 5.000 errores en un
        polling: la respuesta tiene que caber en una pantalla."""
        imp = crear()
        for i in range(Importacion.MAXIMO_ERRORES + 30):
            imp.anotar_error("x", "y", fila=i)
        assert len(imp.errores) == Importacion.MAXIMO_ERRORES
        # Pero el conteo real NO se pierde.
        assert imp.errores_totales == Importacion.MAXIMO_ERRORES + 30

    def test_el_mensaje_se_acota(self):
        imp = crear()
        imp.anotar_error("x", "a" * 500)
        assert len(imp.errores[0]["mensaje"]) == 200

    def test_la_API_devuelve_los_errores_y_el_total(self, cliente):
        imp = crear()
        for i in range(25):
            imp.anotar_error("fila_invalida", f"fila {i}", fila=i)
        imp.save(update_fields=["errores", "errores_totales"])

        respuesta = cliente.get(f"{LISTA}{imp.id}/", headers=cabecera())
        assert len(respuesta.data["errores"]) == Importacion.MAXIMO_ERRORES
        assert respuesta.data["errores_totales"] == 25


# ── el aislamiento ───────────────────────────────────────────────────


class TestAislamiento:
    """Criterio: no se consulta importación de otra organización."""

    def test_otra_organizacion_recibe_404(self, cliente):
        imp = crear(org=ORG_A)
        respuesta = cliente.get(f"{LISTA}{imp.id}/", headers=cabecera(ORG_B))
        # 404 y no 403: para ORG_B esa importación no existe. Un 403
        # confirmaría que el id es de alguien.
        assert respuesta.status_code == status.HTTP_404_NOT_FOUND

    def test_el_listado_solo_trae_las_propias(self, cliente):
        crear(org=ORG_A)
        crear(org=ORG_B)
        respuesta = cliente.get(LISTA, headers=cabecera(ORG_A))
        assert respuesta.data["count"] == 1

    def test_sin_cabecera_no_se_entrega_nada(self, cliente):
        imp = crear()
        assert cliente.get(LISTA).status_code == status.HTTP_403_FORBIDDEN
        assert cliente.get(f"{LISTA}{imp.id}/").status_code == status.HTTP_403_FORBIDDEN

    def test_una_persona_ve_las_de_su_organizacion_aunque_no_sean_suyas(self, cliente):
        """El aislamiento es por organización. Dentro de ella se ven todas:
        el equipo comparte las suscripciones, así que comparte las cargas."""
        crear(org=ORG_A, usuario=USUARIO_B)
        respuesta = cliente.get(LISTA, headers=cabecera(ORG_A, USUARIO_A))
        assert respuesta.data["count"] == 1

    def test_el_filtro_mias_acota_a_quien_pregunta(self, cliente):
        crear(org=ORG_A, usuario=USUARIO_A)
        crear(org=ORG_A, usuario=USUARIO_B)
        respuesta = cliente.get(f"{LISTA}?mias=true", headers=cabecera(ORG_A, USUARIO_A))
        assert respuesta.data["count"] == 1
        assert respuesta.data["results"][0]["id"]

    def test_mias_sin_cabecera_de_usuario_se_rechaza(self, cliente):
        crear()
        respuesta = cliente.get(
            f"{LISTA}?mias=true", headers={"X-Organizacion-Id": str(ORG_A)}
        )
        assert respuesta.status_code == status.HTTP_403_FORBIDDEN


# ── la API es de solo lectura ────────────────────────────────────────


class TestSoloLectura:
    def test_no_se_puede_crear_por_la_API(self, cliente):
        """Una importación nace del proceso que la ejecuta. Un `create`
        abierto permitiría inventar una "completada" sin procesar nada."""
        respuesta = cliente.post(
            LISTA, {"origen": "csv"}, format="json", headers=cabecera()
        )
        assert respuesta.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

    def test_no_se_puede_editar_ni_borrar(self, cliente):
        imp = crear()
        for metodo in (cliente.put, cliente.patch):
            assert metodo(
                f"{LISTA}{imp.id}/", {"estado": "completada"}, format="json",
                headers=cabecera(),
            ).status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert cliente.delete(
            f"{LISTA}{imp.id}/", headers=cabecera()
        ).status_code == status.HTTP_405_METHOD_NOT_ALLOWED


# ── los filtros ──────────────────────────────────────────────────────


class TestFiltros:
    def test_filtra_por_estado(self, cliente):
        crear()
        otra = crear()
        otra.avanzar_a(Importacion.Estado.PROCESANDO)
        respuesta = cliente.get(f"{LISTA}?estado=procesando", headers=cabecera())
        assert respuesta.data["count"] == 1

    def test_un_estado_inventado_se_rechaza(self, cliente):
        respuesta = cliente.get(f"{LISTA}?estado=volando", headers=cabecera())
        assert respuesta.status_code == status.HTTP_400_BAD_REQUEST

    def test_filtra_por_origen(self, cliente):
        crear(origen=Importacion.Origen.CSV)
        crear(origen=Importacion.Origen.CORREO)
        respuesta = cliente.get(f"{LISTA}?origen=correo", headers=cabecera())
        assert respuesta.data["count"] == 1

    def test_un_origen_inventado_se_rechaza(self, cliente):
        assert cliente.get(
            f"{LISTA}?origen=paloma", headers=cabecera()
        ).status_code == status.HTTP_400_BAD_REQUEST

    def test_mias_invalido_se_rechaza(self, cliente):
        assert cliente.get(
            f"{LISTA}?mias=quizas", headers=cabecera()
        ).status_code == status.HTTP_400_BAD_REQUEST

    def test_el_detalle_ignora_los_filtros(self, cliente):
        """`get_queryset` también lo usa `retrieve`: un query param colgado no
        puede hacer desaparecer el recurso."""
        imp = crear()
        respuesta = cliente.get(f"{LISTA}{imp.id}/?estado=completada", headers=cabecera())
        assert respuesta.status_code == status.HTTP_200_OK


# ── la relación con la cuenta conectada ──────────────────────────────


class TestCuentaDeOrigen:
    def test_desconectar_la_cuenta_no_borra_la_importacion(self, claves):
        """SET_NULL y no CASCADE: la importación que ya ocurrió sigue siendo
        un hecho y su historial no se borra."""
        cuenta = CuentaConectada.objects.create(
            organizacion_id=ORG_A, proveedor="gmail", cuenta_externa="a@gmail.com",
        )
        imp = crear(origen=Importacion.Origen.CORREO, cuenta=cuenta)
        cuenta.delete()

        imp.refresh_from_db()
        assert imp.cuenta_id is None
        assert Importacion.objects.filter(pk=imp.pk).exists()
