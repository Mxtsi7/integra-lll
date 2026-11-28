"""Detección de anomalías de cobro (VI-19 / RF-07 / CU-30).

Reglas implementadas, tomadas de RF-07 y de la tarjeta VI-19:

* **Alza de tarifa**: el monto del cobro nuevo supera en *más de* 5 % el
  promedio de los últimos 3 meses del mismo servicio. Se necesitan al menos
  2 cobros previos; el primer cobro (o el segundo) nunca genera un alza.
  El umbral es estricto: 10.000 → 10.500 no alerta, 10.000 → 10.600 sí.
* **Posible doble cobro**: hay otro cobro del mismo servicio a menos de 5
  días. El límite también es estricto: día 1 y día 5 alertan (4 días de
  diferencia), día 1 y día 6 no (5 días).

La detección se ejecuta automáticamente al crear un :class:`~app.models.Cobro`
(señal ``post_save``) y también puede invocarse de forma explícita desde una
importación o un comando. Los hallazgos se persisten con una clave de
deduplicación por tenant, de modo que reprocesar el mismo cobro no duplica
alertas.

Este módulo no cambia el estado de la suscripción: una alerta es evidencia
para el usuario, no una transición de la máquina de estados.

Un posible doble cobro se resuelve de dos maneras, las dos explícitas:
``marcar_hallazgo_revisado`` («lo vi, son dos cargos») deja los dos cobros, y
``conciliar_doble_cobro`` («es el mismo cargo») deja uno solo con los orígenes
de los dos (RF-14: el mismo cargo que llegó por correo y por la cartola).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.utils import timezone

from shared.bloqueo import bloquear

from app.models import CandidatoAplicado, Cobro, HallazgoCobro


# ── parámetros de negocio ────────────────────────────────────────────

UMBRAL_ALZA = Decimal("0.05")
MESES_PROMEDIO = 3
MIN_COBROS_PREVIOS = 2
DIAS_DOBLE_COBRO = 5
MONTO_CERO = Decimal("0.00")


# ── utilidades ───────────────────────────────────────────────────────


def _restar_meses(fecha: date, meses: int) -> date:
    """Resta meses calendario conservando el día cuando existe.

    Si el día no existe en el mes destino (31 de mayo − 3 meses), se usa el
    último día de ese mes (28/29 de febrero). No se usan bloques fijos de 30
    días para que el borde de la ventana coincida con lo que un usuario
    entiende por "los últimos 3 meses".
    """
    indice = fecha.year * 12 + fecha.month - 1 - meses
    anio, mes_base = divmod(indice, 12)
    mes = mes_base + 1
    dia = min(fecha.day, monthrange(anio, mes)[1])
    return date(anio, mes, dia)


def _promedio(montos: list[Decimal]) -> Decimal:
    if not montos:
        return MONTO_CERO
    return (sum(montos, MONTO_CERO) / Decimal(len(montos))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def _decimal_legible(valor: Decimal) -> str:
    """Representa un ``Decimal`` sin ceros sobrantes y con al menos 2 decimales.

    El umbral exacto puede tener más de dos decimales (por ejemplo 10.49475);
    se conserva esa precisión en la evidencia, pero un valor exacto como
    10500.0000 se muestra como 10500.00.
    """
    texto = format(valor, "f")
    if "." not in texto:
        return f"{texto}.00"
    entero, decimales = texto.split(".", 1)
    decimales = decimales.rstrip("0") or "00"
    if len(decimales) < 2:
        decimales = decimales.ljust(2, "0")
    return f"{entero}.{decimales}"


def _cobros_previos(cobro: Cobro) -> list[Cobro]:
    """Cobros del mismo servicio y **misma moneda** anteriores al cobro.

    Se ordenan del más reciente al más antiguo y se usan como máximo 3. La
    suscripción representa al servicio: los cargos de otra suscripción no
    entran en el promedio aunque compartan nombre, para no mezclar planes.

    La moneda es parte de la comparabilidad: sin una tasa de cambio no se
    puede comparar un importe en CLP con uno en USD. Un antecedente en otra
    moneda no cuenta para el mínimo de evidencia ni entra en el promedio.
    """
    desde = _restar_meses(cobro.fecha, MESES_PROMEDIO)
    return list(
        Cobro.objects.filter(
            organizacion_id=cobro.organizacion_id,
            suscripcion_id=cobro.suscripcion_id,
            moneda=cobro.moneda,
            fecha__gte=desde,
            fecha__lt=cobro.fecha,
        )
        .order_by("-fecha", "-id")[:3]
    )


# ── evaluación pura (sin persistencia) ───────────────────────────────


def evaluar_alza_tarifa(cobro: Cobro) -> dict[str, Any] | None:
    """Devuelve la evidencia del alza o ``None`` si no corresponde alertar.

    No escribe en la base. Es la pieza que se puede probar con un cobro
    construido en memoria, sin depender de la señal ni de la tabla de
    hallazgos.
    """
    previos = _cobros_previos(cobro)
    if len(previos) < MIN_COBROS_PREVIOS:
        return None

    montos = [previo.monto for previo in previos]
    cantidad = len(montos)
    suma = sum(montos, MONTO_CERO)
    if suma <= MONTO_CERO:
        return None

    # La comparación es exacta: promedio * (1 + 5 %). No se redondea ni el
    # promedio ni el umbral antes de decidir, porque eso ocultaba alzas
    # legítimas (con antecedentes 9,99 y 10,00, un cobro de 10,50 supera el
    # 5 % real pero el promedio redondeado a 10,00 lo escondía).
    #   monto > (suma / cantidad) * 1,05
    # equivale, sin división, a:
    #   monto * cantidad > suma * 1,05
    if cobro.monto * cantidad <= suma * (Decimal("1") + UMBRAL_ALZA):
        return None

    promedio_exacto = suma / cantidad
    # Estos dos valores sí son representaciones/persistencia: el promedio se
    # guarda en ``monto_referencia`` (2 decimales) y la variación en el campo
    # porcentual. El umbral del detalle conserva la precisión del cálculo.
    promedio = _promedio(montos)
    umbral = promedio_exacto * (Decimal("1") + UMBRAL_ALZA)
    variacion = (
        ((cobro.monto - promedio_exacto) / promedio_exacto) * Decimal("100")
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return {
        "promedio": promedio,
        "umbral": umbral,
        "porcentaje_variacion": variacion,
        "cantidad_previos": len(previos),
        "cobros_previos": [
            {
                "id": str(previo.id),
                "fecha": previo.fecha.isoformat(),
                "monto": str(previo.monto),
            }
            for previo in previos
        ],
    }


def evaluar_doble_cobro(cobro: Cobro) -> dict[str, Any] | None:
    """Busca otro cobro del mismo servicio a menos de 5 días.

    Devuelve el candidato más cercano (y, a igual distancia, el de menor
    fecha/id) o ``None``. No escribe en la base.
    """
    margen = timedelta(days=DIAS_DOBLE_COBRO - 1)
    candidatos = (
        Cobro.objects.filter(
            organizacion_id=cobro.organizacion_id,
            suscripcion_id=cobro.suscripcion_id,
            fecha__range=(cobro.fecha - margen, cobro.fecha + margen),
        )
        .exclude(pk=cobro.pk)
    )

    mejor: tuple[int, date, str, Cobro] | None = None
    for candidato in candidatos:
        diferencia = abs((candidato.fecha - cobro.fecha).days)
        # Estricto: 5 días de diferencia ya no es "menos de 5 días".
        if diferencia >= DIAS_DOBLE_COBRO:
            continue
        clave = (diferencia, candidato.fecha, str(candidato.id), candidato)
        if mejor is None or clave[:3] < mejor[:3]:
            mejor = clave

    if mejor is None:
        return None

    relacionado = mejor[3]
    return {
        "cobro_relacionado": relacionado,
        "dias_diferencia": mejor[0],
        "fecha_relacionada": relacionado.fecha,
        "monto_relacionado": relacionado.monto,
    }


# ── persistencia de hallazgos ────────────────────────────────────────


def _clave_alza(cobro: Cobro) -> str:
    return f"alza:{cobro.pk}"


def _clave_doble(primero: Cobro, segundo: Cobro) -> str:
    ids = sorted((str(primero.pk), str(segundo.pk)))
    return f"doble:{ids[0]}:{ids[1]}"


def _persistir(
    *,
    cobro: Cobro,
    tipo: str,
    clave: str,
    monto_referencia: Decimal | None,
    porcentaje_variacion: Decimal | None,
    cobro_relacionado: Cobro | None,
    fecha_referencia: date | None,
    detalle: dict[str, Any],
) -> tuple[HallazgoCobro, bool]:
    return HallazgoCobro.objects.get_or_create(
        organizacion_id=cobro.organizacion_id,
        clave_deduplicacion=clave,
        defaults={
            "tipo": tipo,
            "suscripcion_id": cobro.suscripcion_id,
            "cobro_id": cobro.pk,
            "cobro_relacionado_id": cobro_relacionado.pk if cobro_relacionado else None,
            "monto": cobro.monto,
            "monto_referencia": monto_referencia,
            "moneda": cobro.moneda,
            "porcentaje_variacion": porcentaje_variacion,
            "fecha_cobro": cobro.fecha,
            "fecha_referencia": fecha_referencia,
            "detalle": detalle,
        },
    )


def detectar_anomalias_cobro(cobro: Cobro) -> list[HallazgoCobro]:
    """Analiza un cobro y persiste los hallazgos que correspondan.

    Es idempotente: la clave única por tenant evita duplicados si la misma
    importación se reprocesa. Devuelve los hallazgos vigentes para ese cobro
    (creados ahora o ya existentes), ordenados por tipo.
    """
    if cobro.pk is None:
        raise ValueError("El cobro debe estar persistido antes de analizarlo.")

    hallazgos: list[HallazgoCobro] = []
    with transaction.atomic():
        alza = evaluar_alza_tarifa(cobro)
        if alza is not None:
            hallazgo, _ = _persistir(
                cobro=cobro,
                tipo=HallazgoCobro.Tipo.ALZA_TARIFA,
                clave=_clave_alza(cobro),
                monto_referencia=alza["promedio"],
                porcentaje_variacion=alza["porcentaje_variacion"],
                cobro_relacionado=None,
                fecha_referencia=None,
                detalle={
                    "promedio": str(alza["promedio"]),
                    "umbral": _decimal_legible(alza["umbral"]),
                    "cantidad_previos": alza["cantidad_previos"],
                    "cobros_previos": alza["cobros_previos"],
                },
            )
            hallazgos.append(hallazgo)

        doble = evaluar_doble_cobro(cobro)
        if doble is not None:
            relacionado: Cobro = doble["cobro_relacionado"]
            hallazgo, _ = _persistir(
                cobro=cobro,
                tipo=HallazgoCobro.Tipo.DOBLE_COBRO,
                clave=_clave_doble(cobro, relacionado),
                monto_referencia=doble["monto_relacionado"],
                porcentaje_variacion=None,
                cobro_relacionado=relacionado,
                fecha_referencia=doble["fecha_relacionada"],
                detalle={"dias_diferencia": doble["dias_diferencia"]},
            )
            hallazgos.append(hallazgo)

    return hallazgos


# Alias corto para consumidores que ya hablan de "anomalías" (RF-07).
def detectar_anomalias(cobro: Cobro) -> list[HallazgoCobro]:
    return detectar_anomalias_cobro(cobro)


def marcar_hallazgo_revisado(
    hallazgo: HallazgoCobro,
    *,
    usuario_id: int | None = None,
    cuando=None,
) -> HallazgoCobro:
    """Marca una alerta como revisada sin tocar el estado de la suscripción."""
    if hallazgo.estado == HallazgoCobro.Estado.REVISADA:
        return hallazgo

    hallazgo.estado = HallazgoCobro.Estado.REVISADA
    hallazgo.revisado_en = cuando or timezone.now()
    hallazgo.revisado_por = usuario_id
    hallazgo.save(
        update_fields=("estado", "revisado_en", "revisado_por", "actualizado_en")
    )
    return hallazgo


# ── conciliar un posible doble cobro (RF-14) ─────────────────────────

#: Lo que queda en ``detalle["resolucion"]`` de un doble cobro conciliado.
MISMO_CARGO = "mismo_cargo"

# Por qué no se concilia. Códigos estables: la API responde con ellos.
NO_ES_DOBLE_COBRO = "no_es_doble_cobro"
SIN_COBRO_RELACIONADO = "sin_cobro_relacionado"
IMPORTES_DISTINTOS = "importes_distintos"


class ConciliacionRechazada(ValueError):
    """No se puede conciliar este hallazgo. ``codigo`` es estable."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


def conciliar_doble_cobro(
    hallazgo: HallazgoCobro,
    *,
    usuario_id: int | None = None,
    cuando=None,
) -> HallazgoCobro:
    """«Es el mismo cargo»: deja UN cobro con los orígenes de los dos.

    Es la otra salida de un posible doble cobro (la primera es marcarlo
    revisado: «son dos»). El sistema no lo decide solo porque fecha, importe y
    moneda iguales no prueban identidad; lo decide la persona, y esto hace que
    su decisión quede en los datos y no solo en el estado de la alerta:

      · queda el cobro de fecha MÁS TEMPRANA (la cartola suele asentar
        después del correo: la fecha del cargo es la primera); a igual
        fecha, el que se registró primero;
      · las filas de ``CandidatoAplicado`` del otro se mueven al que queda,
        así que su origen y su identificador se conservan (RN-DAT-004) y la
        exportación lo informa como ``correo+csv``;
      · el otro cobro se borra: deja de contar en el gasto, el calendario y
        la exportación. Lo que se borró queda escrito en el ``detalle`` del
        hallazgo, que pasa a revisado con ``resolucion = mismo_cargo``;
      · se vuelve a analizar el cobro que queda: si el que se borró era
        también el par de un TERCER cobro cercano, ese posible doble cobro
        no desaparece con él.

    Solo con el mismo importe y la misma moneda: con montos distintos no es
    el mismo cargo, y juntarlos haría desaparecer la diferencia.

    Idempotente: conciliar un hallazgo ya conciliado lo devuelve igual. Uno
    marcado revisado («son dos») sí se puede conciliar después: la persona
    puede cambiar de opinión, y la decisión explícita más reciente manda.
    """
    with transaction.atomic():
        # El mismo lock que toman las órdenes de connectors: una orden que
        # llega mientras se concilia no ve un cobro a medio borrar.
        bloquear("ordenes_de_cobro", hallazgo.organizacion_id)
        hallazgo = HallazgoCobro.objects.select_for_update().get(pk=hallazgo.pk)

        if hallazgo.tipo != HallazgoCobro.Tipo.DOBLE_COBRO:
            raise ConciliacionRechazada(
                NO_ES_DOBLE_COBRO,
                "Solo un posible doble cobro se puede conciliar.",
            )
        if hallazgo.detalle.get("resolucion") == MISMO_CARGO:
            return hallazgo
        if hallazgo.cobro_relacionado_id is None:
            raise ConciliacionRechazada(
                SIN_COBRO_RELACIONADO,
                "El hallazgo no tiene el segundo cobro del par.",
            )

        par = list(
            Cobro.objects.select_for_update()
            .filter(pk__in=(hallazgo.cobro_id, hallazgo.cobro_relacionado_id))
        )
        primero, segundo = par
        if (primero.monto, primero.moneda) != (segundo.monto, segundo.moneda):
            raise ConciliacionRechazada(
                IMPORTES_DISTINTOS,
                "Los dos cobros tienen importes o monedas distintos: no son el "
                "mismo cargo. Si de verdad uno sobra, hay que corregirlo a mano.",
            )

        queda, sobra = sorted(par, key=lambda c: (c.fecha, c.creado_en, str(c.pk)))
        origenes = list(
            CandidatoAplicado.objects.filter(cobro=sobra)
            .order_by("creado_en", "id")
            .values("origen", "identificador_origen", "candidato_id")
        )
        CandidatoAplicado.objects.filter(cobro=sobra).update(cobro=queda)

        hallazgo.cobro = queda
        hallazgo.cobro_relacionado = None
        hallazgo.fecha_cobro = queda.fecha
        hallazgo.fecha_referencia = sobra.fecha
        hallazgo.estado = HallazgoCobro.Estado.REVISADA
        hallazgo.revisado_en = cuando or timezone.now()
        hallazgo.revisado_por = usuario_id
        hallazgo.detalle = {
            **hallazgo.detalle,
            "resolucion": MISMO_CARGO,
            "cobro_conciliado": {
                "id": str(sobra.pk),
                "fecha": sobra.fecha.isoformat(),
                "monto": str(sobra.monto),
                "moneda": sobra.moneda,
                "origenes": [
                    {
                        "origen": fila["origen"],
                        "identificador_origen": fila["identificador_origen"],
                        "candidato_id": str(fila["candidato_id"]),
                    }
                    for fila in origenes
                ],
            },
        }
        # Antes de borrar: el hallazgo apunta al cobro que sobra, y su FK es
        # CASCADE. Si se borrara primero, se llevaría la decisión con él.
        hallazgo.save()
        sobra.delete()
        detectar_anomalias_cobro(queda)

    return hallazgo

