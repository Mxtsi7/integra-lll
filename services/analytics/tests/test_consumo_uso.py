"""
FE-28 — la traducción de eventos a la proyección.

Sin broker: `aplicar()` recibe el sobre ya decodificado. Lo que se prueba es
que un sobre del catálogo se convierta en los datos correctos, y que uno roto
se descarte en vez de ensuciar la proyección.
"""

import datetime as dt
import uuid

import pytest

from analytics.consumo_uso import SobreInvalido, aplicar
from analytics.models import SuscripcionObservada, UsoMensual, UsoProyectado

pytestmark = pytest.mark.django_db

ORG = "11111111-1111-1111-1111-111111111111"
SUSC = "33333333-3333-3333-3333-333333333333"


def sobre_uso(*, minutos=30, fecha="2026-10-03", id_=None, org=ORG, susc=SUSC):
    return {
        "evento": "uso.registrado",
        "version": 1,
        "id": id_ or str(uuid.uuid4()),
        "ocurrido_en": "2026-10-03T12:00:00Z",
        "correlation_id": str(uuid.uuid4()),
        "organizacion_id": org,
        "datos": {
            "suscripcion_id": susc,
            "minutos": minutos,
            "fecha": fecha,
            "fuente": "gmail",
        },
    }


def sobre_creada(*, ocurrido="2026-01-15T08:30:00Z", nombre="Netflix", susc=SUSC):
    return {
        "evento": "suscripcion.creada",
        "version": 2,
        "id": str(uuid.uuid4()),
        "ocurrido_en": ocurrido,
        "correlation_id": str(uuid.uuid4()),
        "organizacion_id": ORG,
        "datos": {"suscripcion_id": susc, "nombre": nombre, "monto": "9990.00"},
    }


class TestSuscripcionCreada:
    @pytest.mark.parametrize("sobre", [sobre_creada(), sobre_uso()])
    def test_evento_tardio_no_recrea_datos_de_organizacion_eliminada(self, sobre):
        from shared.borrado.models import EstadoOrganizacion

        EstadoOrganizacion.objects.create(organizacion_id=ORG, eliminada=True)
        assert aplicar(sobre) is False
        assert not SuscripcionObservada.objects.exists()
        assert not UsoProyectado.objects.exists()
        assert not UsoMensual.objects.exists()

    def test_deja_constancia_de_que_existe_y_desde_cuando(self):
        assert aplicar(sobre_creada()) is True
        fila = SuscripcionObservada.objects.get()
        assert fila.suscripcion_id == uuid.UUID(SUSC)
        assert fila.observada_desde == dt.date(2026, 1, 15)
        assert fila.nombre == "Netflix"

    def test_usa_la_fecha_del_hecho_no_la_de_hoy(self):
        """Si usara hoy, reprocesar los eventos movería la fecha y una
        suscripción vieja parecería recién creada."""
        aplicar(sobre_creada(ocurrido="2025-03-02T00:00:00Z"))
        assert SuscripcionObservada.objects.get().observada_desde == dt.date(2025, 3, 2)

    def test_reprocesarla_no_duplica_la_fila(self):
        sobre = sobre_creada()
        aplicar(sobre)
        aplicar(sobre)
        assert SuscripcionObservada.objects.count() == 1


class TestUsoRegistrado:
    def test_proyecta_el_uso_y_arma_el_agregado(self):
        assert aplicar(sobre_uso(minutos=45)) is True
        assert UsoProyectado.objects.count() == 1
        assert UsoMensual.objects.get().minutos == 45

    def test_el_mismo_evento_dos_veces_no_suma_dos_veces(self):
        """La llave es el `id` del sobre, que el catálogo designa para esto."""
        sobre = sobre_uso(minutos=45)
        assert aplicar(sobre) is True
        assert aplicar(sobre) is False
        assert UsoMensual.objects.get().minutos == 45

    def test_dos_eventos_distintos_del_mismo_dia_suman(self):
        aplicar(sobre_uso(minutos=10))
        aplicar(sobre_uso(minutos=20))
        assert UsoMensual.objects.get().minutos == 30

    def test_cero_minutos_es_un_dato_valido(self):
        """Un uso de cero minutos es información: dice que hubo un reporte."""
        assert aplicar(sobre_uso(minutos=0)) is True
        assert UsoMensual.objects.get().minutos == 0


class TestSobresRotos:
    def test_sin_organizacion_se_descarta(self):
        """Regla 4 del catálogo. Meterlo en la organización equivocada sería
        peor que descartarlo."""
        sobre = sobre_uso()
        del sobre["organizacion_id"]
        with pytest.raises(SobreInvalido):
            aplicar(sobre)
        assert not UsoProyectado.objects.exists()

    def test_una_organizacion_que_no_es_uuid_se_descarta(self):
        with pytest.raises(SobreInvalido):
            aplicar(sobre_uso(org="la-organizacion"))

    def test_sin_suscripcion_se_descarta(self):
        sobre = sobre_uso()
        del sobre["datos"]["suscripcion_id"]
        with pytest.raises(SobreInvalido):
            aplicar(sobre)

    def test_una_fecha_imposible_se_descarta(self):
        with pytest.raises(SobreInvalido):
            aplicar(sobre_uso(fecha="2026-13-45"))

    def test_minutos_negativos_se_descartan(self):
        with pytest.raises(SobreInvalido):
            aplicar(sobre_uso(minutos=-5))

    def test_minutos_de_texto_se_descartan(self):
        with pytest.raises(SobreInvalido):
            aplicar(sobre_uso(minutos="treinta"))

    def test_un_booleano_no_cuenta_como_un_minuto(self):
        """`bool` es subclase de `int` en Python: sin la guarda, True pasaría
        como 1 minuto y nadie se enteraría."""
        with pytest.raises(SobreInvalido):
            aplicar(sobre_uso(minutos=True))

    def test_datos_que_no_son_objeto_se_descartan(self):
        sobre = sobre_uso()
        sobre["datos"] = "no soy un objeto"
        with pytest.raises(SobreInvalido):
            aplicar(sobre)

    def test_un_sobre_que_no_es_objeto_se_descarta(self):
        with pytest.raises(SobreInvalido):
            aplicar(["esto", "es", "una", "lista"])


class TestEventosQueNoEscucha:
    def test_un_evento_ajeno_se_ignora_sin_romper(self):
        sobre = sobre_uso()
        sobre["evento"] = "alerta.activada"
        assert aplicar(sobre) is False
        assert not UsoProyectado.objects.exists()

    def test_un_evento_ajeno_con_datos_rotos_igual_se_ignora(self):
        """Primero se mira el nombre: validar un evento que no nos toca sería
        rechazar mensajes de otros por nuestras propias reglas."""
        assert aplicar({"evento": "cobro.registrado", "datos": None}) is False

    def test_sin_nombre_de_evento_se_ignora(self):
        assert aplicar({"organizacion_id": ORG}) is False
