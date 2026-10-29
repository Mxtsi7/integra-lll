"""Jobs de análisis basados en snapshots confiables de suscripciones."""

from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from uuid import NAMESPACE_URL, UUID, uuid5
from urllib.parse import urlparse

from django.utils import timezone

VENTANA_SIN_USO_DIAS = 45
CENTAVO = Decimal("0.01")


def _texto(valor, campo: str) -> str:
    if not isinstance(valor, str) or not valor.strip():
        raise ValueError(f"{campo} es obligatorio.")
    return valor.strip()


def _fecha(valor, campo: str, *, opcional: bool = False) -> date | None:
    if valor is None and opcional:
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str):
        try:
            return date.fromisoformat(valor)
        except ValueError as exc:
            raise ValueError(f"{campo} debe tener formato YYYY-MM-DD.") from exc
    raise ValueError(f"{campo} debe tener formato YYYY-MM-DD.")


def _monto(valor, campo: str) -> Decimal:
    try:
        monto = Decimal(str(valor))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{campo} debe ser un monto decimal válido.") from exc
    if not monto.is_finite() or monto <= 0:
        raise ValueError(f"{campo} debe ser mayor que cero.")
    return monto


def _url_evidencia(valor, campo: str) -> str:
    url = _texto(valor, campo)
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{campo} debe ser un enlace HTTPS.")
    return url


def generar_recomendaciones_consolidacion(
    *,
    organizacion_id: str,
    suscripciones: Sequence[Mapping],
    solapamientos: Sequence[Mapping],
    fecha_referencia: date | None = None,
) -> list[dict]:
    """Genera sugerencias de consolidación solo con solapamiento explícito.

    Cada candidato debe tener más de 45 días de historial observado sin uso
    registrado y otro servicio del mismo solapamiento debe tener uso reciente.
    El ahorro es el costo mensual normalizado del candidato, no una promesa de
    ahorro ni una afirmación de equivalencia entre proveedores.
    """
    if not isinstance(suscripciones, Sequence) or isinstance(suscripciones, (str, bytes)):
        raise ValueError("suscripciones debe ser una lista.")
    if not isinstance(solapamientos, Sequence) or isinstance(solapamientos, (str, bytes)):
        raise ValueError("solapamientos debe ser una lista.")

    organizacion_id = _texto(organizacion_id, "organizacion_id")
    hoy = (
        _fecha(fecha_referencia, "fecha_referencia")
        if fecha_referencia is not None
        else timezone.localdate()
    )
    corte = hoy - timedelta(days=VENTANA_SIN_USO_DIAS)
    por_id = {}

    for indice, suscripcion in enumerate(suscripciones):
        prefijo = f"suscripciones[{indice}]"
        if not isinstance(suscripcion, Mapping):
            raise ValueError(f"{prefijo} debe ser un objeto.")
        identificador = _texto(suscripcion.get("id"), f"{prefijo}.id")
        if identificador in por_id:
            raise ValueError(f"El id de suscripción {identificador} está duplicado.")
        tenant_id = _texto(
            suscripcion.get("organizacion_id"),
            f"{prefijo}.organizacion_id",
        )
        if tenant_id != organizacion_id:
            raise ValueError(
                f"{prefijo}.organizacion_id no coincide con el tenant del job."
            )

        monto = _monto(suscripcion.get("monto"), f"{prefijo}.monto")
        frecuencia = _texto(suscripcion.get("frecuencia"), f"{prefijo}.frecuencia")
        if frecuencia not in ("mensual", "anual"):
            raise ValueError(f"{prefijo}.frecuencia debe ser mensual o anual.")
        observada_desde = _fecha(
            suscripcion.get("uso_observado_desde"),
            f"{prefijo}.uso_observado_desde",
        )
        ultimo_uso = _fecha(
            suscripcion.get("ultimo_uso"),
            f"{prefijo}.ultimo_uso",
            opcional=True,
        )
        if ultimo_uso is not None and ultimo_uso < observada_desde:
            raise ValueError(f"{prefijo}.ultimo_uso no puede preceder a la observación.")
        if observada_desde > hoy or (ultimo_uso is not None and ultimo_uso > hoy):
            raise ValueError(f"{prefijo} no puede contener fechas futuras.")

        moneda = _texto(suscripcion.get("moneda"), f"{prefijo}.moneda")
        categoria = _texto(suscripcion.get("categoria"), f"{prefijo}.categoria")
        nombre = _texto(suscripcion.get("nombre"), f"{prefijo}.nombre")
        estado = _texto(suscripcion.get("estado"), f"{prefijo}.estado")
        activa = suscripcion.get("activa")
        if not isinstance(activa, bool):
            raise ValueError(f"{prefijo}.activa debe ser booleano.")

        por_id[identificador] = {
            "id": identificador,
            "nombre": nombre,
            "categoria": categoria,
            "estado": estado,
            "activa": activa,
            "monto": monto,
            "moneda": moneda,
            "frecuencia": frecuencia,
            "uso_observado_desde": observada_desde,
            "ultimo_uso": ultimo_uso,
        }

    recomendaciones = []
    evidencias_vistas = set()
    for indice, solapamiento in enumerate(solapamientos):
        prefijo = f"solapamientos[{indice}]"
        if not isinstance(solapamiento, Mapping):
            raise ValueError(f"{prefijo} debe ser un objeto.")
        evidencia_id = _texto(solapamiento.get("evidencia_id"), f"{prefijo}.evidencia_id")
        if evidencia_id in evidencias_vistas:
            raise ValueError(f"El id de evidencia {evidencia_id} está duplicado.")
        evidencias_vistas.add(evidencia_id)

        categoria = _texto(solapamiento.get("categoria"), f"{prefijo}.categoria")
        evidencia_url = _url_evidencia(
            solapamiento.get("evidencia_url"),
            f"{prefijo}.evidencia_url",
        )
        evidencia_descripcion = _texto(
            solapamiento.get("evidencia_descripcion"),
            f"{prefijo}.evidencia_descripcion",
        )
        ids = solapamiento.get("suscripcion_ids")
        if (
            not isinstance(ids, Sequence)
            or isinstance(ids, (str, bytes))
            or len(ids) < 2
        ):
            raise ValueError(f"{prefijo}.suscripcion_ids debe incluir al menos dos ids.")
        ids_limpios = [_texto(item, f"{prefijo}.suscripcion_ids") for item in ids]
        if len(set(ids_limpios)) != len(ids_limpios):
            raise ValueError(f"{prefijo}.suscripcion_ids no puede repetir ids.")

        grupo = []
        for suscripcion_id in ids_limpios:
            suscripcion = por_id.get(suscripcion_id)
            if suscripcion is None:
                raise ValueError(
                    f"{prefijo} referencia una suscripción fuera del snapshot: "
                    f"{suscripcion_id}."
                )
            if suscripcion["categoria"] != categoria:
                raise ValueError(
                    f"{prefijo} no coincide con la categoría de {suscripcion_id}."
                )
            grupo.append(suscripcion)

        pares = []
        for candidata in grupo:
            if (
                not candidata["activa"]
                or candidata["estado"] not in ("activo", "fantasma")
                or candidata["categoria"] == "otro"
                or candidata["uso_observado_desde"] > corte
                or (
                    candidata["ultimo_uso"] is not None
                    and candidata["ultimo_uso"] >= corte
                )
            ):
                continue

            usadas_recientemente = [
                par
                for par in grupo
                if par["id"] != candidata["id"]
                and par["activa"]
                and par["estado"] in ("activo", "fantasma")
                and par["ultimo_uso"] is not None
                and par["ultimo_uso"] >= corte
            ]
            if usadas_recientemente:
                pares.append((candidata, usadas_recientemente))

        for candidata, alternativas_usadas in pares:
            ahorro_mensual = candidata["monto"]
            if candidata["frecuencia"] == "anual":
                ahorro_mensual /= Decimal("12")
            ahorro_mensual = ahorro_mensual.quantize(
                CENTAVO,
                rounding=ROUND_HALF_UP,
            )
            if ahorro_mensual <= 0:
                continue

            alternativas = [
                {"id": alternativa["id"], "nombre": alternativa["nombre"]}
                for alternativa in alternativas_usadas
            ]
            base = (
                f"monto recurrente {candidata['monto']} {candidata['moneda']} "
                f"{candidata['frecuencia']}"
            )
            calculo = (
                f"{candidata['monto']} {candidata['moneda']} anual / 12"
                if candidata["frecuencia"] == "anual"
                else base
            )
            if candidata["ultimo_uso"] is None:
                uso = (
                    "sin uso registrado desde "
                    f"{candidata['uso_observado_desde'].isoformat()}"
                )
            else:
                uso = (
                    "último uso registrado el "
                    f"{candidata['ultimo_uso'].isoformat()}"
                )
            nombres_alternativas = ", ".join(
                alternativa["nombre"]
                for alternativa in alternativas_usadas
            )
            motivo = (
                f"Posible consolidación a revisar en {categoria}: "
                f"{candidata['nombre']} tiene {uso} "
                f"durante más de {VENTANA_SIN_USO_DIAS} días; "
                f"{nombres_alternativas} registra uso en el mismo período. "
                "La recomendación se apoya en un solapamiento explícito y no "
                f"afirma equivalencia entre servicios. Ahorro potencial "
                f"{ahorro_mensual} {candidata['moneda']} al mes, calculado "
                f"como {calculo}."
            )
            recomendaciones.append(
                {
                    "organizacion_id": organizacion_id,
                    "tipo": "consolidacion_categoria",
                    "categoria": categoria,
                    "suscripcion_candidata": {
                        "id": candidata["id"],
                        "nombre": candidata["nombre"],
                    },
                    "suscripciones_relacionadas": alternativas,
                    "motivo": motivo,
                    "ahorro_potencial": {
                        "monto_mensual": str(ahorro_mensual),
                        "moneda": candidata["moneda"],
                        "base_calculo": calculo,
                    },
                    "evidencia": {
                        "id": evidencia_id,
                        "url": evidencia_url,
                        "descripcion": evidencia_descripcion,
                    },
                }
            )

    return recomendaciones


def procesar_evento_solapamiento(evento: Mapping) -> list[dict]:
    """Consume un evento v2 de solapamiento y construye eventos de salida."""
    if not isinstance(evento, Mapping):
        raise ValueError("El evento debe ser un objeto.")
    if evento.get("evento") != "solapamiento.detectado":
        raise ValueError("El evento debe ser solapamiento.detectado.")
    if type(evento.get("version")) is not int or evento["version"] != 2:
        raise ValueError("solapamiento.detectado requiere la versión 2.")

    evento_id = _texto(evento.get("id"), "evento.id")
    organizacion_id = _texto(evento.get("organizacion_id"), "evento.organizacion_id")
    correlacion_id = _texto(evento.get("correlation_id"), "evento.correlation_id")
    try:
        UUID(evento_id)
        UUID(organizacion_id)
        UUID(correlacion_id)
    except ValueError as exc:
        raise ValueError(
            "evento.id, evento.organizacion_id y evento.correlation_id "
            "deben ser UUID válidos."
        ) from exc

    ocurrido_en = _texto(evento.get("ocurrido_en"), "evento.ocurrido_en")
    try:
        fecha_evento = datetime.fromisoformat(ocurrido_en.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("evento.ocurrido_en debe ser una fecha ISO-8601.") from exc
    if fecha_evento.utcoffset() is None:
        raise ValueError("evento.ocurrido_en debe incluir zona horaria.")
    fecha_snapshot = timezone.localtime(fecha_evento).date()

    datos = evento.get("datos")
    if not isinstance(datos, Mapping):
        raise ValueError("evento.datos debe ser un objeto.")
    suscripciones = datos.get("suscripciones")
    ids = datos.get("suscripcion_ids")
    if (
        not isinstance(ids, Sequence)
        or isinstance(ids, (str, bytes))
        or not isinstance(suscripciones, Sequence)
        or isinstance(suscripciones, (str, bytes))
    ):
        raise ValueError("evento.datos requiere listas de suscripcion_ids y suscripciones.")
    ids_evento = [_texto(item, "evento.datos.suscripcion_ids") for item in ids]
    try:
        for suscripcion_id in ids_evento:
            UUID(suscripcion_id)
    except ValueError as exc:
        raise ValueError("evento.datos.suscripcion_ids debe contener UUID válidos.") from exc
    ids_snapshot = []
    for indice, suscripcion in enumerate(suscripciones):
        if not isinstance(suscripcion, Mapping):
            raise ValueError(f"evento.datos.suscripciones[{indice}] debe ser un objeto.")
        ids_snapshot.append(
            _texto(suscripcion.get("id"), f"evento.datos.suscripciones[{indice}].id")
        )
    if set(ids_evento) != set(ids_snapshot) or len(ids_evento) != len(ids_snapshot):
        raise ValueError(
            "evento.datos.suscripciones debe coincidir exactamente con suscripcion_ids."
        )

    solapamiento = {
        "evidencia_id": datos.get("evidencia_id"),
        "evidencia_url": datos.get("evidencia_url"),
        "evidencia_descripcion": datos.get("evidencia_descripcion"),
        "categoria": datos.get("categoria"),
        "suscripcion_ids": ids_evento,
    }
    recomendaciones = generar_recomendaciones_consolidacion(
        organizacion_id=organizacion_id,
        suscripciones=suscripciones,
        solapamientos=[solapamiento],
        fecha_referencia=fecha_snapshot,
    )

    eventos_generados = []
    for recomendacion in recomendaciones:
        datos_salida = {
            llave: valor
            for llave, valor in recomendacion.items()
            if llave != "organizacion_id"
        }
        datos_salida["evento_origen_id"] = evento_id
        # El id de salida incluye el id del evento de entrada y, por tanto,
        # cambia con cada reentrega. La fecha del snapshot permite consolidar
        # el mismo hallazgo y descartar entregas fuera de orden.
        datos_salida["ocurrido_en_origen"] = ocurrido_en
        candidata_id = recomendacion["suscripcion_candidata"]["id"]
        salida_id = uuid5(
            NAMESPACE_URL,
            f"integra-lll:{evento_id}:{candidata_id}:{solapamiento['evidencia_id']}",
        )
        eventos_generados.append(
            {
                "evento": "recomendacion.consolidacion_generada",
                "version": 1,
                "id": str(salida_id),
                "ocurrido_en": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "correlation_id": correlacion_id,
                "organizacion_id": organizacion_id,
                "datos": datos_salida,
            }
        )
    return eventos_generados
