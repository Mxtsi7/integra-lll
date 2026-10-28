"""Uso por periodo (FE-28) y puntaje de bajo uso (FE-29).

Dos cosas separadas a propósito:

**FE-28 — la proyección.** Copia acá los registros de uso que vienen por
evento desde Subscriptions y mantiene el agregado mensual. No decide nada:
solo cuenta lo que pasó.

**FE-29 — el puntaje.** Mira el agregado y dice si parece haber bajo uso. No
escribe nada: es una función pura de lo proyectado, así que el mismo conjunto
de registros siempre da el mismo puntaje.

Tenerlas separadas es lo que permite cambiar la fórmula del puntaje sin tocar
los datos, y recalcular puntajes viejos con la fórmula nueva.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass

from django.conf import settings
from django.db import IntegrityError, transaction

from shared.bloqueo import bloquear
from django.db.models import Count, Max, Sum

from analytics.models import SuscripcionObservada, UsoMensual, UsoProyectado


# ═══════════════════════════════════════════════════════════════════
# FE-28 — la proyección
# ═══════════════════════════════════════════════════════════════════


def primer_dia(fecha: dt.date) -> dt.date:
    """El día 1 del mes de `fecha`. El mes se guarda siempre así."""
    return fecha.replace(day=1)


def mes_siguiente(mes: dt.date) -> dt.date:
    """El día 1 del mes que sigue. Sumar 31 días se salta febrero."""
    if mes.month == 12:
        return dt.date(mes.year + 1, 1, 1)
    return dt.date(mes.year, mes.month + 1, 1)


def meses_hacia_atras(mes: dt.date, cantidad: int) -> list[dt.date]:
    """Los `cantidad` meses que terminan en `mes`, del más viejo al más nuevo.

    Se calcula con aritmética de enteros sobre (año*12 + mes) en vez de restar
    días: restar 30 días a un 31 de marzo cae en febrero y se salta un mes.
    """
    base = mes.year * 12 + (mes.month - 1)
    salida = []
    for desplazamiento in range(cantidad - 1, -1, -1):
        indice = base - desplazamiento
        salida.append(dt.date(indice // 12, indice % 12 + 1, 1))
    return salida


def registrar_suscripcion(
    *, organizacion_id, suscripcion_id, observada_desde: dt.date, nombre: str = ""
) -> SuscripcionObservada:
    """Deja constancia de que esta suscripción existe y desde cuándo.

    Idempotente: si ya estaba, conserva la fecha original. Reprocesar el
    evento `suscripcion.creada` no puede mover la fecha hacia adelante, o una
    suscripción vieja parecería recién creada y su bajo uso dejaría de poder
    afirmarse.
    """
    fila, creada = SuscripcionObservada.objects.get_or_create(
        organizacion_id=organizacion_id,
        suscripcion_id=suscripcion_id,
        defaults={"observada_desde": observada_desde, "nombre": nombre},
    )
    if not creada and nombre and fila.nombre != nombre:
        # El nombre sí se actualiza: es solo para mostrar.
        fila.nombre = nombre
        fila.save(update_fields=["nombre", "actualizado_en"])
    return fila


def registrar_cobertura(
    *, organizacion_id, suscripcion_id, desde: dt.date, hasta: dt.date
) -> SuscripcionObservada | None:
    """Acredita que el uso de ese periodo llegó COMPLETO.

    Solo puede llamarla quien de verdad lo sepa: el proceso de sincronización
    con la fuente, cuando esta confirma haber entregado un rango. **No** se
    deduce de que hayan llegado algunos eventos: que lleguen tres usos de
    octubre no prueba que octubre esté completo.

    Por eso hoy no la llama nadie todavía: el consumidor de `uso.registrado`
    no está cableado y la fuente no publica un marcador de sincronización. La
    consecuencia correcta es que `puntuar` responda `sin_datos`, no que
    invente un cero.

    La cobertura se EXTIENDE, nunca se encoge: un rango nuevo que empieza
    antes o termina después amplía el acreditado; uno más chico no lo recorta,
    porque acreditar menos de lo que ya se sabía no es información nueva.
    """
    fila = SuscripcionObservada.objects.filter(
        organizacion_id=organizacion_id, suscripcion_id=suscripcion_id
    ).first()
    if fila is None:
        return None
    cambios = []
    if fila.cobertura_desde is None or desde < fila.cobertura_desde:
        fila.cobertura_desde = desde
        cambios.append("cobertura_desde")
    if fila.cobertura_hasta is None or hasta > fila.cobertura_hasta:
        fila.cobertura_hasta = hasta
        cambios.append("cobertura_hasta")
    if cambios:
        fila.save(update_fields=cambios + ["actualizado_en"])
    return fila


def _bloquear_agregado(organizacion_id, suscripcion_id, mes: dt.date) -> None:
    """Serializa el recálculo de un (tenant, suscripción, mes).

    La implementación vive en `shared/bloqueo.py`: es el MISMO patrón que
    Subscriptions necesitó para el resumen por organización, y dos copias del
    mismo lock se desincronizan igual que dos copias de una routing key.
    Acá queda solo el nombre de la clave.
    """
    bloquear("uso_mensual", organizacion_id, suscripcion_id, f"{mes:%Y-%m}")


def proyectar_uso(
    *, organizacion_id, suscripcion_id, evento_id, fecha: dt.date, minutos: int
) -> bool:
    """Copia un registro de uso y recalcula su mes. True si era nuevo.

    Devuelve False cuando el registro ya estaba: es un reproceso, y no hace
    nada, porque no cambió nada que recalcular.

    ── Las dos escrituras van en UNA transacción ────────────────────────────
    Antes el atomic cerraba después de insertar y el recálculo quedaba afuera.
    Si el recálculo fallaba, el registro quedaba guardado sin agregado, y la
    reentrega del mismo evento devolvía False por la restricción única **sin
    reparar el mes**: esos minutos no se agregaban nunca más. Lo reprodujo la
    revisión de la PR.

    Ahora o entran las dos cosas o no entra ninguna, así que una reentrega
    siempre encuentra el trabajo por hacer.

    El atomic de adentro es un savepoint y existe solo para que el
    `IntegrityError` del duplicado no deje rota la transacción exterior.
    """
    with transaction.atomic():
        try:
            with transaction.atomic():
                UsoProyectado.objects.create(
                    organizacion_id=organizacion_id,
                    suscripcion_id=suscripcion_id,
                    evento_id=evento_id,
                    fecha=fecha,
                    minutos=minutos,
                )
        except IntegrityError:
            # Un IntegrityError NO prueba por sí solo que sea el mismo evento:
            # podría venir de otra restricción. Se comprueba que la fila exista
            # con este evento_id antes de darlo por reproceso; si no está, el
            # error es otro y tiene que subir.
            if not UsoProyectado.objects.filter(evento_id=evento_id).exists():
                raise
            return False

        recalcular_mes(
            organizacion_id=organizacion_id,
            suscripcion_id=suscripcion_id,
            mes=primer_dia(fecha),
        )
    return True


def recalcular_mes(
    *, organizacion_id, suscripcion_id, mes: dt.date, hasta: dt.date | None = None
) -> UsoMensual:
    """Reconstruye el agregado del mes desde los registros proyectados.

    Función pura de `UsoProyectado`: no suma sobre lo que había. Por eso el
    agregado siempre coincide con los registros fuente del periodo, que es el
    primer criterio de FE-28, y por eso los datos tardíos no necesitan nada
    especial.

    `hasta` acota hasta qué día se cuenta, para poder reconstruir el agregado
    de un mes en curso sin incluir días posteriores al corte. Sin `hasta` se
    cuenta el mes completo, que es lo correcto para un mes cerrado.

    Toma un lock de la clave del agregado ANTES de leer la fuente: ver
    `_bloquear_agregado`.
    """
    fin = mes_siguiente(mes)
    if hasta is not None and hasta < fin:
        # +1 día porque el filtro es `< fin`, y `hasta` es inclusivo.
        fin = min(fin, hasta + dt.timedelta(days=1))

    with transaction.atomic():
        _bloquear_agregado(organizacion_id, suscripcion_id, mes)
        registros = UsoProyectado.objects.filter(
            organizacion_id=organizacion_id,
            suscripcion_id=suscripcion_id,
            fecha__gte=mes,
            fecha__lt=fin,
        )
        resumen = registros.aggregate(
            minutos=Sum("minutos"),
            dias=Count("fecha", distinct=True),
            ultimo=Max("fecha"),
        )
        fila, _ = UsoMensual.objects.update_or_create(
            organizacion_id=organizacion_id,
            suscripcion_id=suscripcion_id,
            mes=mes,
            defaults={
                "minutos": resumen["minutos"] or 0,
                "dias_con_uso": resumen["dias"] or 0,
                "ultimo_uso": resumen["ultimo"],
            },
        )
    return fila


# ═══════════════════════════════════════════════════════════════════
# FE-29 — el puntaje
# ═══════════════════════════════════════════════════════════════════


class Clasificacion:
    """Los cuatro desenlaces posibles. `SIN_DATOS` no es un error: es la
    respuesta honesta cuando todavía no se puede afirmar nada."""

    SIN_DATOS = "sin_datos"
    BAJO = "bajo"
    NORMAL = "normal"
    ALTO = "alto"


@dataclass(frozen=True)
class Puntaje:
    """El resultado, con su evidencia. Es lo que consume Recommendations (VI-17)."""

    suscripcion_id: str
    mes_final: str
    meses_evaluados: int
    minutos_totales: int
    minutos_por_mes: float
    dias_con_uso: int
    puntaje: int
    clasificacion: str
    #: Por qué dio eso. Sin esto, Recommendations tendría que confiar a ciegas.
    evidencia: dict

    def como_dict(self) -> dict:
        return asdict(self)


def _umbral_minutos() -> int:
    """Minutos al mes por debajo de los cuales se considera bajo uso."""
    return int(getattr(settings, "UMBRAL_BAJO_USO_MINUTOS", 60))


def _dias_minimos() -> int:
    """Cuánto hay que haber observado una suscripción antes de opinar."""
    return int(getattr(settings, "UMBRAL_DIAS_OBSERVACION", 30))


def _meses_ventana() -> int:
    """Cuántos meses mira la fórmula."""
    return int(getattr(settings, "MESES_VENTANA_USO", 3))


def puntuar(
    *, organizacion_id, suscripcion_id, mes_final: dt.date, hasta: dt.date | None = None
) -> Puntaje:
    """Calcula el puntaje de uso de una suscripción.

    ── La fórmula ───────────────────────────────────────────────────────────
    Ventana: los últimos `MESES_VENTANA_USO` meses terminando en `mes_final`
    (3 por omisión). Se promedian los minutos sobre los meses de la ventana
    que caen dentro del periodo observado —no sobre los 3 siempre, porque una
    suscripción de dos meses se vería a la mitad de lo que se usa.

        minutos_por_mes = minutos_totales / meses_observados
        puntaje         = min(100, round(100 * minutos_por_mes / UMBRAL))

    El puntaje es 0–100 y está normalizado contra el umbral: **100 significa
    que llega al umbral**, no que sea un uso perfecto. Por encima se recorta,
    porque "usa el triple de lo mínimo" y "usa el décuplo" no son distintos
    para lo que esto decide.

    ── Determinismo ─────────────────────────────────────────────────────────
    `mes_final` y `hasta` son parámetros, nunca `date.today()` adentro. El
    mismo conjunto de registros da siempre el mismo puntaje —criterio de
    FE-29—, y eso es lo que permite recalcular un mes viejo y comparar.
    `hasta` es el día contra el que se mide cuánto se observó; por omisión,
    el último día del mes final.

    ── Falta de datos ≠ uso cero ────────────────────────────────────────────
    Si la suscripción no está observada, o se observa hace menos de
    `UMBRAL_DIAS_OBSERVACION` días, la clasificación es `sin_datos` y el
    puntaje viene en 0 **pero no se afirma bajo uso**. Quien lo consuma tiene
    que mirar `clasificacion`, no el número: es el segundo criterio de FE-29.

    Una suscripción observada hace rato y con cero minutos SÍ es bajo uso, y
    se distingue por `uso_cero_real` en la evidencia.
    """
    mes_final = primer_dia(mes_final)
    umbral = _umbral_minutos()
    cantidad_meses = _meses_ventana()
    ventana = meses_hacia_atras(mes_final, cantidad_meses)

    ultimo_del_mes = mes_siguiente(mes_final) - dt.timedelta(days=1)
    if hasta is None:
        hasta = ultimo_del_mes
    else:
        # El corte NUNCA puede pasar del mes pedido: si lo pasara, un GET del
        # mes de marzo hecho en octubre contaría como observados los meses de
        # abril a octubre.
        hasta = min(hasta, ultimo_del_mes)

    observada = SuscripcionObservada.objects.filter(
        organizacion_id=organizacion_id, suscripcion_id=suscripcion_id
    ).first()

    filas = {
        fila.mes: fila
        for fila in UsoMensual.objects.filter(
            organizacion_id=organizacion_id,
            suscripcion_id=suscripcion_id,
            mes__in=ventana,
        )
    }
    # ── Por qué el último mes no se lee del agregado ──────────────────────
    # `UsoMensual` tiene el mes COMPLETO. Si el corte cae a mitad de mes, un
    # uso del día 20 seguiría contando aunque `hasta` sea el día 2: el
    # agregado no sabe nada del corte. Lo reprodujo la revisión de la PR.
    #
    # Para el mes del corte se cuenta desde los registros, acotados a `hasta`.
    # Los meses anteriores ya están cerrados y el agregado sirve tal cual, que
    # es justamente para lo que existe.
    mes_abierto = hasta < ultimo_del_mes

    def _del_mes(mes: dt.date) -> dict:
        if mes == mes_final and mes_abierto:
            crudo = UsoProyectado.objects.filter(
                organizacion_id=organizacion_id,
                suscripcion_id=suscripcion_id,
                fecha__gte=mes,
                fecha__lte=hasta,
            ).aggregate(
                minutos=Sum("minutos"), dias=Count("fecha", distinct=True)
            )
            return {
                "mes": f"{mes:%Y-%m}",
                "minutos": crudo["minutos"] or 0,
                "dias_con_uso": crudo["dias"] or 0,
                "proyectado": mes in filas,
                "mes_en_curso": True,
                "contado_hasta": f"{hasta:%Y-%m-%d}",
            }
        return {
            "mes": f"{mes:%Y-%m}",
            "minutos": filas[mes].minutos if mes in filas else 0,
            "dias_con_uso": filas[mes].dias_con_uso if mes in filas else 0,
            "proyectado": mes in filas,
        }

    por_mes = [_del_mes(mes) for mes in ventana]
    minutos_totales = sum(item["minutos"] for item in por_mes)
    dias_totales = sum(item["dias_con_uso"] for item in por_mes)

    dias_observados = (hasta - observada.observada_desde).days if observada else 0
    # Solo cuentan los meses de la ventana que la suscripción llegó a vivir.
    # Solo los meses de la ventana que la suscripción llegó a vivir Y que ya
    # empezaron a la fecha de corte. Sin lo segundo, un GET del mes en curso
    # promediaba sobre meses que todavía no pasaron.
    meses_observados = (
        len([
            m for m in ventana
            if observada
            and m >= primer_dia(observada.observada_desde)
            and m <= primer_dia(hasta)
        ])
        if observada
        else 0
    )

    evidencia = {
        "umbral_minutos_al_mes": umbral,
        "dias_minimos_de_observacion": _dias_minimos(),
        "dias_observados": dias_observados,
        "observada_desde": (
            f"{observada.observada_desde:%Y-%m-%d}" if observada else None
        ),
        "medido_hasta": f"{hasta:%Y-%m-%d}",
        "mes_en_curso": mes_abierto,
        "meses": por_mes,
        "meses_observados_en_la_ventana": meses_observados,
        "uso_cero_real": False,
        "motivo": "",
    }

    if observada is None:
        evidencia["motivo"] = (
            "Analytics no tiene registrada esta suscripción: no se puede "
            "distinguir si no se usa o si todavía no llegan sus datos."
        )
        return Puntaje(
            suscripcion_id=str(suscripcion_id),
            mes_final=f"{mes_final:%Y-%m}",
            meses_evaluados=0,
            minutos_totales=0,
            minutos_por_mes=0.0,
            dias_con_uso=0,
            puntaje=0,
            clasificacion=Clasificacion.SIN_DATOS,
            evidencia=evidencia,
        )

    # ── La cobertura, antes que los días ────────────────────────────────────
    # `dias_observados` cuenta desde que NACIÓ la suscripción, no desde que
    # tenemos su uso. Una creación vieja que llega hoy daba 56 días y
    # clasificación `bajo` con `uso_cero_real`, sin que nada acreditara que la
    # proyección recibió ese periodo. Lo reprodujo la revisión de la PR.
    cubierto_desde = observada.cobertura_desde
    cubierto_hasta = observada.cobertura_hasta
    # El periodo que habría que tener acreditado: desde el inicio de la
    # ventana (o desde que nació, lo que sea más tarde) hasta el corte.
    necesario_desde = max(ventana[0], primer_dia(observada.observada_desde))
    evidencia["cobertura_desde"] = (
        f"{cubierto_desde:%Y-%m-%d}" if cubierto_desde else None
    )
    evidencia["cobertura_hasta"] = (
        f"{cubierto_hasta:%Y-%m-%d}" if cubierto_hasta else None
    )
    evidencia["cobertura_necesaria_desde"] = f"{necesario_desde:%Y-%m-%d}"

    sin_cobertura = (
        cubierto_hasta is None
        or cubierto_desde is None
        or cubierto_desde > necesario_desde
        or cubierto_hasta < hasta
    )
    if sin_cobertura:
        if cubierto_hasta is None:
            evidencia["motivo"] = (
                "No hay cobertura acreditada: Analytics tiene la suscripción "
                "registrada pero nadie confirmó que su uso del periodo haya "
                "llegado completo. La antigüedad de la suscripción no lo "
                "demuestra."
            )
        else:
            evidencia["motivo"] = (
                f"Cobertura incompleta: acreditado "
                f"{cubierto_desde:%Y-%m-%d}…{cubierto_hasta:%Y-%m-%d}, "
                f"hace falta {necesario_desde:%Y-%m-%d}…{hasta:%Y-%m-%d}."
            )
        return Puntaje(
            suscripcion_id=str(suscripcion_id),
            mes_final=f"{mes_final:%Y-%m}",
            meses_evaluados=0,
            minutos_totales=minutos_totales,
            minutos_por_mes=0.0,
            dias_con_uso=dias_totales,
            puntaje=0,
            clasificacion=Clasificacion.SIN_DATOS,
            evidencia=evidencia,
        )

    if dias_observados < _dias_minimos():
        evidencia["motivo"] = (
            f"Observada hace {dias_observados} días, menos de los "
            f"{_dias_minimos()} necesarios para afirmar bajo uso."
        )
        return Puntaje(
            suscripcion_id=str(suscripcion_id),
            mes_final=f"{mes_final:%Y-%m}",
            meses_evaluados=meses_observados,
            minutos_totales=minutos_totales,
            minutos_por_mes=0.0,
            dias_con_uso=dias_totales,
            puntaje=0,
            clasificacion=Clasificacion.SIN_DATOS,
            evidencia=evidencia,
        )

    divisor = max(1, meses_observados)
    minutos_por_mes = minutos_totales / divisor
    puntaje = min(100, round(100 * minutos_por_mes / umbral)) if umbral else 100

    if minutos_totales == 0:
        # Acá sí: lleva observada el tiempo suficiente y no registró nada.
        evidencia["uso_cero_real"] = True
        evidencia["motivo"] = (
            f"Sin un solo minuto de uso en {divisor} mes(es) observado(s)."
        )
        clasificacion = Clasificacion.BAJO
    elif minutos_por_mes < umbral:
        evidencia["motivo"] = (
            f"{minutos_por_mes:.1f} minutos al mes, bajo el umbral de {umbral}."
        )
        clasificacion = Clasificacion.BAJO
    elif puntaje >= 100:
        evidencia["motivo"] = (
            f"{minutos_por_mes:.1f} minutos al mes, en o sobre el umbral de {umbral}."
        )
        clasificacion = Clasificacion.ALTO if minutos_por_mes >= umbral * 2 else Clasificacion.NORMAL
    else:
        evidencia["motivo"] = f"{minutos_por_mes:.1f} minutos al mes."
        clasificacion = Clasificacion.NORMAL

    return Puntaje(
        suscripcion_id=str(suscripcion_id),
        mes_final=f"{mes_final:%Y-%m}",
        meses_evaluados=divisor,
        minutos_totales=minutos_totales,
        minutos_por_mes=round(minutos_por_mes, 2),
        dias_con_uso=dias_totales,
        puntaje=puntaje,
        clasificacion=clasificacion,
        evidencia=evidencia,
    )


def puntuar_organizacion(*, organizacion_id, mes_final: dt.date, hasta=None) -> list[Puntaje]:
    """El puntaje de cada suscripción observada de la organización.

    Recorre `SuscripcionObservada` y no `UsoMensual` a propósito: las que no
    tienen ni una fila de uso son justamente las que más interesan, y por
    `UsoMensual` no aparecerían.
    """
    observadas = SuscripcionObservada.objects.filter(
        organizacion_id=organizacion_id
    ).order_by("nombre", "suscripcion_id")
    return [
        puntuar(
            organizacion_id=organizacion_id,
            suscripcion_id=fila.suscripcion_id,
            mes_final=mes_final,
            hasta=hasta,
        )
        for fila in observadas
    ]
