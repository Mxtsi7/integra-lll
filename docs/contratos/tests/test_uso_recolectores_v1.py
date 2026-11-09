"""Verifica cálculos y coherencia de fixtures; no implementa ni llama un endpoint."""

import json
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

EJEMPLOS = json.loads((Path(__file__).parents[1] / "uso-recolectores-v1.ejemplos.json").read_text())


def instante(texto):
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))


def dia_local(evento):
    zona = ZoneInfo(evento["zona_horaria"])
    return instante(evento["inicio"]).astimezone(zona).date()


def interseccion_ms(inicio, fin, tramo):
    desde = max(inicio, instante(tramo["inicio"]))
    hasta = min(fin, instante(tramo["fin"]))
    return max(0, int((hasta - desde).total_seconds() * 1000))


def duracion_union_ms(tramos):
    intervalos = sorted((instante(tramo["inicio"]), instante(tramo["fin"])) for tramo in tramos)
    unidos = []
    for inicio, fin in intervalos:
        if unidos and inicio <= unidos[-1][1]:
            unidos[-1] = (unidos[-1][0], max(unidos[-1][1], fin))
        else:
            unidos.append((inicio, fin))
    return sum(int((fin - inicio).total_seconds() * 1000) for inicio, fin in unidos)


class EjemplosContratoUso(unittest.TestCase):
    def test_android_y_navegador_comparten_significado_y_destino(self):
        android, navegador = (EJEMPLOS[origen] for origen in ("android", "navegador"))
        self.assertEqual(android["suscripcion_id"], navegador["suscripcion_id"])
        for campo in ("inicio", "fin", "duracion_ms", "zona_horaria", "cobertura", "estado"):
            self.assertEqual(android["evento"][campo], navegador["evento"][campo])

    def test_pendientes_tienen_destino_id_unico_y_un_solo_dia_local(self):
        pendientes = [EJEMPLOS[origen] for origen in ("android", "navegador", "sin_medicion")]
        pendientes += EJEMPLOS["medianoche"]["pendientes"] + EJEMPLOS["precision"]["pendientes"]
        pendientes += [EJEMPLOS[caso]["pendiente"] for caso in ("cero_observado", "ausencia_medicion")]
        identidades = set()
        for pendiente in pendientes:
            evento = pendiente["evento"]
            UUID(pendiente["suscripcion_id"])
            identidad = (UUID(evento["recolector_id"]), UUID(evento["event_id"]))
            self.assertNotIn(identidad, identidades)
            identidades.add(identidad)
            inicio, fin = (instante(evento[campo]) for campo in ("inicio", "fin"))
            self.assertLess(inicio, fin)
            self.assertGreaterEqual(evento["duracion_ms"], 0)
            self.assertLessEqual(evento["duracion_ms"], (fin - inicio).total_seconds() * 1000)
            ultimo_instante = fin - timedelta(microseconds=1)
            ultimo_dia = ultimo_instante.astimezone(ZoneInfo(evento["zona_horaria"])).date()
            self.assertEqual(dia_local(evento), ultimo_dia)

    def test_medianoche_asigna_actividad_real_y_no_reparto_proporcional(self):
        ejemplo = EJEMPLOS["medianoche"]
        asignacion = {}
        for pendiente in ejemplo["pendientes"]:
            evento = pendiente["evento"]
            inicio, fin = (instante(evento[campo]) for campo in ("inicio", "fin"))
            actividad_ms = sum(interseccion_ms(inicio, fin, tramo) for tramo in ejemplo["actividad"])
            self.assertEqual(evento["duracion_ms"], actividad_ms)
            asignacion[str(dia_local(evento))] = actividad_ms
        self.assertEqual(asignacion, ejemplo["esperado_ms_por_dia"])
        self.assertEqual(sum(asignacion.values()), 15000)
        self.assertEqual([10000, 5000], list(asignacion.values()))

    def test_dos_tramos_de_30_s_conservan_residuo_y_suman_un_minuto(self):
        ejemplo = EJEMPLOS["precision"]
        total_ms = minutos_previos = 0
        for indice, pendiente in enumerate(ejemplo["pendientes"]):
            total_ms += pendiente["evento"]["duracion_ms"]
            minutos, residuo = divmod(total_ms, 60000)
            self.assertEqual(total_ms, ejemplo["esperado_total_ms_por_paso"][indice])
            self.assertEqual(minutos, ejemplo["esperado_minutos_enteros_por_paso"][indice])
            self.assertEqual(residuo, ejemplo["esperado_residuo_ms_por_paso"][indice])
            self.assertEqual(minutos - minutos_previos, ejemplo["esperado_incrementos_minutos"][indice])
            minutos_previos = minutos
        self.assertEqual(total_ms / 60000, 1)
        self.assertFalse(ejemplo["acredita_dia_completo"])

    def test_cero_observado_y_dato_ausente_no_son_equivalentes(self):
        cero, ausente = (EJEMPLOS[caso] for caso in ("cero_observado", "ausencia_medicion"))
        self.assertEqual(cero["pendiente"]["evento"]["duracion_ms"], 0)
        self.assertEqual(ausente["pendiente"]["evento"]["duracion_ms"], 0)
        self.assertEqual(cero["pendiente"]["evento"]["cobertura"], "completa")
        self.assertEqual(ausente["pendiente"]["evento"]["cobertura"], "sin_medicion")
        self.assertEqual(cero["esperado"]["uso_real_ms"], 0)
        self.assertIsNone(ausente["esperado"]["uso_real_ms"])
        self.assertTrue(cero["esperado"]["acredita_dia_completo"])
        self.assertFalse(ausente["esperado"]["acredita_dia_completo"])
        for caso in (cero, ausente):
            evento = caso["pendiente"]["evento"]
            zona = ZoneInfo(evento["zona_horaria"])
            inicio, fin = (instante(evento[campo]).astimezone(zona) for campo in ("inicio", "fin"))
            self.assertEqual((inicio.hour, inicio.minute, inicio.second), (0, 0, 0))
            self.assertEqual((fin.hour, fin.minute, fin.second), (0, 0, 0))
            self.assertEqual(fin.date(), inicio.date() + timedelta(days=1))
            self.assertFalse(caso["esperado"]["crea_uso_positivo"])
            self.assertFalse(caso["esperado"]["actualiza_ultima_actividad"])

    def test_reintento_conserva_destino_y_acuse_otro_destino_conflicta(self):
        ejemplos = EJEMPLOS["duplicados"]
        primero, repetido, cambiado = (ejemplos[caso] for caso in ("primer_envio", "reintento", "otro_destino_autorizado"))
        self.assertEqual([primero["http_esperado"], repetido["http_esperado"], cambiado["http_esperado"]], [201, 200, 409])
        self.assertEqual(primero["pendiente"], repetido["pendiente"])
        self.assertEqual(primero["ruta_destino"], repetido["ruta_destino"])
        self.assertNotEqual(primero["ruta_destino"], cambiado["ruta_destino"])
        self.assertIn(cambiado["ruta_destino"], EJEMPLOS["destinos_autorizados"])
        for campo in ("event_id", "suscripcion_id", "recibido_en"):
            self.assertEqual(primero["acuse"][campo], repetido["acuse"][campo])
        self.assertEqual(primero["acuse"]["suscripcion_id"], EJEMPLOS[primero["pendiente"]]["suscripcion_id"])

    def test_solapamientos_cuentan_tiempo_de_suscripcion_no_suma_de_recolectores(self):
        for nombre, caso in EJEMPLOS["solapamientos"].items():
            with self.subTest(caso=nombre):
                eventos = [pendiente["evento"] for pendiente in caso["pendientes"]]
                tramos = [tramo for evento in eventos for tramo in evento["tramos_actividad"]]
                for evento in eventos:
                    self.assertEqual(duracion_union_ms(evento["tramos_actividad"]), evento["duracion_ms"])
                self.assertEqual(sum(evento["duracion_ms"] for evento in eventos), caso["esperado_suma_recolectores_ms"])
                esperado = caso["esperado_uso_suscripcion_ms"]
                self.assertEqual(duracion_union_ms(tramos), esperado)
                self.assertEqual(duracion_union_ms(list(reversed(tramos)) + tramos), esperado)

    def test_todos_los_eventos_conservan_detalle_y_duracion_coherentes(self):
        def recorrer(nodo):
            if isinstance(nodo, dict):
                if "evento" in nodo:
                    yield nodo["evento"]
                else:
                    for valor in nodo.values():
                        yield from recorrer(valor)
            elif isinstance(nodo, list):
                for valor in nodo:
                    yield from recorrer(valor)
        for evento in recorrer(EJEMPLOS):
            self.assertEqual(duracion_union_ms(evento["tramos_actividad"]), evento["duracion_ms"])
            for tramo in evento["tramos_actividad"]:
                self.assertLess(instante(tramo["inicio"]), instante(tramo["fin"]))
                self.assertGreaterEqual(instante(tramo["inicio"]), instante(evento["inicio"]))
                self.assertLessEqual(instante(tramo["fin"]), instante(evento["fin"]))
