"""Snapshot del comparador: una página que se ve en vivo y queda guardada.

Mientras corre la comparación, el HTML se recarga solo cada pocos segundos
(meta refresh, sin servidor ni internet) y va llenando rondas, gráficos y el
autoscaling. Al terminar queda fijo como evidencia, junto a un JSON con los
mismos datos. Los dos van a k8s/pruebas/resultados/, que git ignora. Nunca se
guardan tokens ni identificadores de organización.

El muestreador lee `kubectl get hpa` cada pocos segundos: la CPU promedio por
pod contra el objetivo, las réplicas reales y las que pide (o pediría) el HPA.
Con AUTOESCALADO=fijo el comparador congela el HPA para que los dos modos
corran con las mismas réplicas; ahí "pediría" es una estimación con la fórmula
del controlador sobre los límites originales, sin sus ventanas de estabilización.
"""
import html
import json
import math
import os
import sys
import threading
import time
import webbrowser
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from metricas_comparador import percentil

RESULTADOS = Path(__file__).resolve().parent / 'resultados'
INTERVALO_S = 5
TOLERANCIA_HPA = 0.1  # La misma tolerancia por defecto del controlador.
NOMBRES = ('SIN RabbitMQ', 'CON RabbitMQ')


def milicores(cantidad):
    """Cantidad de CPU de Kubernetes ('35m', '1', '1500000n') a milicores."""
    if cantidad is None:
        return None
    texto, factor = str(cantidad).strip(), 1000.0
    for sufijo, valor in (('n', 1e-6), ('u', 1e-3), ('m', 1.0)):
        if texto.endswith(sufijo):
            texto, factor = texto[:-1], valor
            break
    try:
        resultado = float(texto) * factor
    except ValueError:
        return None
    return resultado if math.isfinite(resultado) and resultado >= 0 else None


def leer_hpa(h):
    spec, status = h.get('spec') or {}, h.get('status') or {}

    def cpu(metricas, campo):
        for m in metricas or []:
            recurso = m.get('resource') or {}
            if m.get('type') == 'Resource' and recurso.get('name') == 'cpu':
                return milicores((recurso.get(campo) or {}).get('averageValue'))
        return None
    return dict(minimo=spec.get('minReplicas', 1), maximo=spec.get('maxReplicas'),
                objetivo_m=cpu(spec.get('metrics'), 'target'),
                cpu_m=cpu(status.get('currentMetrics'), 'current'),
                actuales=status.get('currentReplicas'), deseadas=status.get('desiredReplicas'))


def estimar_replicas(actuales, cpu, objetivo, minimo, maximo):
    """Fórmula del HPA: ceil(réplicas × uso / objetivo), con tolerancia y límites."""
    if not actuales or cpu is None or not objetivo or maximo is None:
        return None
    razon = cpu / objetivo
    deseadas = actuales if abs(razon - 1) <= TOLERANCIA_HPA else math.ceil(actuales * razon)
    return max(minimo, min(maximo, deseadas))


def resumir(resultados):
    def tres(valores):
        return dict(minimo=min(valores), p50=percentil(valores, 50), maximo=max(valores)) if valores else None
    modos = [dict(operaciones=len(r['latencias']), http_p50=percentil(r['latencias'], 50),
                  http_p95=percentil(r['latencias'], 95), lote=tres(r['totales'])) for r in resultados]
    con = resultados[1]
    return dict(modos=modos, outbox=tres(con['outbox']), posterior=tres(con['posterior']),
                solapados=con['solapados'])


class RegistroNulo:
    """Para las pruebas y para quien llama a comparar() sin snapshot."""

    def iniciar(self):
        pass

    def originales(self, _hpas):
        pass

    @contextmanager
    def fase(self, *_):
        yield

    def ronda(self, *_):
        pass

    def detener(self):
        pass

    def lineas_hpa(self):
        return []


class Registro:
    """Junta lo que pasa en la comparación y lo escribe como snapshot."""

    def __init__(self, cfg, muestrear=None, directorio=RESULTADOS, abrir=True,
                 intervalo=INTERVALO_S, reloj=time.monotonic, ahora=datetime.now):
        self._muestrear, self._intervalo, self._reloj, self._abrir = muestrear, intervalo, reloj, abrir
        self._candado = threading.RLock()
        self._parar = threading.Event()
        self._iniciado = self._avisado = False
        self._origen = reloj()
        inicio = ahora()
        base = Path(directorio) / ('comparacion-' + inicio.strftime('%Y%m%d-%H%M%S'))
        self.html, self.json = base.with_suffix('.html'), base.with_suffix('.json')
        # Solo campos elegidos uno por uno: cfg también trae los tokens.
        self.datos = dict(
            version=1, inicio=inicio.isoformat(timespec='seconds'), estado='en_curso', error=None,
            duracion_s=0, config=dict(
                host=urlsplit(cfg['url']).hostname, operaciones=cfg['operaciones'],
                repeticiones=cfg['repeticiones'], conexiones=cfg['conexiones'],
                semilla=cfg['semilla'], calentamiento=cfg.get('calentamiento', 0),
                autoescalado=cfg.get('autoescalado', 'fijo')),
            hpa_original={}, fases=[], rondas=[], muestras=[], resumen=None)

    def _t(self):
        return round(self._reloj() - self._origen, 2)

    def iniciar(self):
        self._iniciado = True
        self.muestrear()
        self.guardar()
        print(f'Snapshot en vivo: {self.html}', flush=True)
        if self._abrir:
            try:
                webbrowser.open(self.html.resolve().as_uri())
            except Exception:  # Sin navegador (SSH, CI): el archivo igual queda.
                pass
        if self._muestrear:
            threading.Thread(target=self._bucle, name='muestreo-hpa', daemon=True).start()

    def _bucle(self):
        while not self._parar.wait(self._intervalo):
            self.muestrear()
            self.guardar()

    def muestrear(self, final=False):
        if not self._muestrear or (self._parar.is_set() and not final):
            return
        try:
            lecturas = {h['spec']['scaleTargetRef']['name']: leer_hpa(h)
                        for h in json.loads(self._muestrear())['items']}
        except (RuntimeError, ValueError, KeyError, TypeError):
            lecturas = None  # Un hueco en el gráfico, no una comparación fallida.
        with self._candado:
            for nombre, lectura in (lecturas or {}).items():
                lectura['pide'] = self._pide(nombre, lectura)
            self.datos['muestras'].append(dict(t=self._t(), final=final, hpas=lecturas))

    def _pide(self, nombre, lectura):
        if self.datos['config']['autoescalado'] == 'activo':
            return lectura['deseadas']
        original = self.datos['hpa_original'].get(nombre, lectura)
        return estimar_replicas(lectura['actuales'], lectura['cpu_m'],
                                original['objetivo_m'] or lectura['objetivo_m'],
                                original['minimo'], original['maximo'])

    def originales(self, hpas):
        if isinstance(hpas, dict):
            with self._candado:
                self.datos['hpa_original'] = {
                    n: dict(minimo=h['minimo'], maximo=h['maximo'], objetivo_m=h['objetivo_m'])
                    for n, h in hpas.items()}

    @contextmanager
    def fase(self, tipo, ronda, modo):
        desde = self._t()
        try:
            yield
        finally:
            with self._candado:
                self.datos['fases'].append(dict(tipo=tipo, ronda=ronda, modo=modo,
                                                desde=desde, hasta=self._t()))

    def ronda(self, ronda, modo, latencias, lote_s, replicas):
        with self._candado:
            self.datos['rondas'].append(dict(
                ronda=ronda, modo=modo, latencias=[round(x, 1) for x in latencias],
                p50=percentil(latencias, 50), p95=percentil(latencias, 95), lote_s=lote_s,
                replicas=replicas if isinstance(replicas, dict) else None))
        self.guardar()

    def lineas_hpa(self):
        with self._candado:
            ultima = next((m['hpas'] for m in reversed(self.datos['muestras']) if m['hpas']), None)
        verbo = 'pide' if self.datos['config']['autoescalado'] == 'activo' else 'pediría'
        lineas = []
        for nombre in sorted(ultima or {}):
            h = ultima[nombre]
            cpu = 'sin métrica todavía' if h['cpu_m'] is None or not h['objetivo_m'] else \
                f'CPU {h["cpu_m"]:.0f}m de {h["objetivo_m"]:.0f}m'
            pide = '?' if h['pide'] is None else h['pide']
            lineas.append(f'HPA {nombre}: {h["actuales"]} réplica(s) · {cpu} · {verbo} {pide}')
        return lineas

    def detener(self):
        self._parar.set()

    def terminar(self, resultados=None, error=None):
        if not self._iniciado:
            return None
        self.detener()
        self.muestrear(final=True)  # Después de restaurar: deja constancia del HPA devuelto.
        with self._candado:
            self.datos['duracion_s'] = self._t()
            if error is None:
                self.datos['estado'], self.datos['resumen'] = 'terminada', resumir(resultados)
            else:
                self.datos['estado'] = 'invalida'
                self.datos['error'] = str(error) or 'Interrumpida antes de terminar.'
        self.guardar()
        return self.html

    def guardar(self):
        with self._candado:
            if self.datos['estado'] == 'en_curso':
                self.datos['duracion_s'] = self._t()
            contenido = (pagina(self.datos), json.dumps(self.datos, ensure_ascii=False, indent=1))
            try:
                self.html.parent.mkdir(parents=True, exist_ok=True)
                for ruta, texto in zip((self.html, self.json), contenido):
                    _escribir(ruta, texto)
            except OSError:
                if not self._avisado:
                    self._avisado = True
                    print(f'AVISO: no se pudo escribir el snapshot en {self.html.parent}; '
                          'la comparación sigue.', file=sys.stderr)


def _escribir(ruta, texto):
    # Reemplazo atómico: el navegador nunca recarga un archivo a medio escribir.
    temporal = ruta.with_name(ruta.name + '.tmp')
    temporal.write_text(texto, encoding='utf-8')
    for intento in range(5):
        try:
            os.replace(temporal, ruta)
            return
        except PermissionError:
            # Windows rechaza el reemplazo si justo otro proceso tiene el archivo abierto.
            if intento == 4:
                raise
            time.sleep(0.2)


# ── Página ──────────────────────────────────────────────────────────────────
# SVG escrito a mano: la página tiene que abrir sin internet en la sala.
# SIN y CON se distinguen por rótulo y leyenda, nunca solo por color.

ANCHO = 720


def _e(texto):
    return html.escape(str(texto), quote=True)


def _fmt(valor):
    return f'{valor:.0f}' if abs(valor - round(valor)) < 1e-9 else f'{valor:.2f}'.rstrip('0').rstrip('.')


def _mmss(segundos):
    segundos = int(round(segundos))
    return f'{segundos // 60}:{segundos % 60:02d}'


def _ticks(maximo, partes=4):
    """Ticks limpios desde 0; el último cubre el máximo."""
    if not maximo or maximo <= 0:
        maximo = 1
    crudo = maximo / partes
    potencia = 10 ** math.floor(math.log10(crudo))
    paso = next(f * potencia for f in (1, 2, 2.5, 5, 10) if f * potencia >= crudo - 1e-12)
    return [paso * i for i in range(math.ceil(maximo / paso - 1e-9) + 1)]


def _diferencia(sin, con):
    if not sin:
        return 'N/D'
    cambio = (con - sin) / sin * 100
    return f'CON tarda {abs(cambio):.0f} % {"menos" if cambio < 0 else "más"}'


def _franja(filas, unidad, marcas):
    """Una fila por modo; cada punto es una medición y las marcas son percentiles."""
    valores = [v for fila in filas for v, _ in fila]
    if not valores:
        return '<p class="vacio">Todavía no hay mediciones.</p>'
    izq, der, arriba, alto_fila = 120, 28, 10, 70
    ticks = _ticks(max(valores))
    tope = ticks[-1]

    def x(v):
        return izq + (ANCHO - izq - der) * v / tope
    alto = arriba + alto_fila * len(filas) + 26
    partes = [f'<svg viewBox="0 0 {ANCHO} {alto}" role="img" aria-label="Mediciones en {unidad} por modo">']
    for t in ticks:
        partes.append(f'<line class="rejilla" x1="{x(t):.1f}" x2="{x(t):.1f}" y1="{arriba}" '
                      f'y2="{arriba + alto_fila * len(filas)}"/>'
                      f'<text class="eje" x="{x(t):.1f}" y="{alto - 8}" text-anchor="middle">{_fmt(t)}</text>')
    for modo, fila in enumerate(filas):
        centro = arriba + alto_fila * modo + alto_fila / 2
        partes.append(f'<circle class="m{modo}" cx="12" cy="{centro:.1f}" r="5"/>'
                      f'<text class="rotulo" x="24" y="{centro + 4:.1f}">{NOMBRES[modo]}</text>')
        for i, (v, etiqueta) in enumerate(fila):
            dy = ((i * 7) % 9 - 4) * 3  # Dispersión fija para que los puntos no se tapen.
            partes.append(f'<circle class="punto m{modo}" cx="{x(v):.1f}" cy="{centro + dy:.1f}" r="4">'
                          f'<title>{NOMBRES[modo]} · {_e(etiqueta)} · {v:.1f} {unidad}</title></circle>')
        if fila:
            for posicion, (nombre, p) in enumerate(marcas):
                v = percentil([v for v, _ in fila], p)
                y_texto = centro - 22 if posicion == 0 else centro + 32
                partes.append(f'<line class="marca" x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{centro - 18:.1f}" '
                              f'y2="{centro + 18:.1f}"/><text class="valor" x="{x(v):.1f}" y="{y_texto:.1f}" '
                              f'text-anchor="middle">{nombre} {_fmt(round(v, 1))} {unidad}</text>')
    partes.append('</svg>')
    return ''.join(partes)


def _bandas(fases, x, arriba, abajo, rotular):
    partes, borde_rotulo = [], -1e9
    for f in fases:
        x0, x1 = x(f['desde']), x(max(f['hasta'], f['desde']))
        ancho = max(x1 - x0, 1.5)
        if f['tipo'] == 'reinicio':
            clase = 'banda-reinicio'
            titulo = f'Reinicio de la API para pasar a {NOMBRES[f["modo"]]} · ronda {f["ronda"]}'
        else:
            clase = f'banda-m{f["modo"]}' + (' calentamiento' if f['tipo'] == 'calentamiento' else '')
            titulo = (f'{"Calentamiento" if f["tipo"] == "calentamiento" else "POST medidos"} '
                      f'{NOMBRES[f["modo"]]} · ronda {f["ronda"]}')
        titulo += f' · {f["hasta"] - f["desde"]:.1f} s'
        partes.append(f'<rect class="{clase}" x="{x0:.1f}" y="{arriba}" width="{ancho:.1f}" '
                      f'height="{abajo - arriba}"><title>{_e(titulo)}</title></rect>')
        centro = x0 + ancho / 2
        # Rótulo corto sobre cada franja medida, salvo que choque con el anterior.
        if rotular and f['tipo'] == 'http' and centro - 13 > borde_rotulo:
            partes.append(f'<text class="eje" x="{centro:.1f}" y="{arriba - 5}" text-anchor="middle">'
                          f'{NOMBRES[f["modo"]].split()[0]}</text>')
            borde_rotulo = centro + 13
    return ''.join(partes)


def _ejes_tiempo(fin, x, y, arriba, abajo):
    paso = next((p for p in (10, 15, 30, 60, 120, 300, 600, 900) if fin / p <= 8), 1800)
    partes = []
    t = 0
    while t <= fin + 1e-9:
        partes.append(f'<line class="rejilla" x1="{x(t):.1f}" x2="{x(t):.1f}" y1="{arriba}" y2="{abajo}"/>'
                      f'<text class="eje" x="{x(t):.1f}" y="{y}" text-anchor="middle">{_mmss(t)}</text>')
        t += paso
    return ''.join(partes)


def _escalon(puntos, x, y):
    """Camino en escalón: las réplicas cambian de golpe, no en rampa."""
    tramos, actual = [], []
    for t, v in puntos:
        if v is None:
            if actual:
                tramos.append(actual)
            actual = []
            continue
        if actual:
            actual.append(f'H{x(t):.1f}V{y(v):.1f}')
        else:
            actual = [f'M{x(t):.1f} {y(v):.1f}']
    if actual:
        tramos.append(actual)
    return ''.join(''.join(tramo) for tramo in tramos)


def _graficos_hpa(datos, nombre):
    muestras = [(m['t'], (m['hpas'] or {}).get(nombre)) for m in datos['muestras']]
    if not any(h for _, h in muestras):
        return '<p class="vacio">Sin lecturas de este HPA.</p>'
    fin = max([datos['duracion_s'], 1] + [t for t, _ in muestras] + [f['hasta'] for f in datos['fases']])
    izq, der = 56, 28

    def x(t):
        return izq + (ANCHO - izq - der) * t / fin
    original = datos['hpa_original'].get(nombre, {})
    objetivo = original.get('objetivo_m') or next((h['objetivo_m'] for _, h in muestras if h and h['objetivo_m']), None)
    cpus = [h['cpu_m'] for _, h in muestras if h and h['cpu_m'] is not None]

    # CPU por pod contra el objetivo.
    arriba, abajo, alto = 22, 150, 176
    ticks = _ticks(max(cpus + [objetivo * 1.25 if objetivo else 1]))

    def y(v):
        return abajo - (abajo - arriba) * v / ticks[-1]
    partes = [f'<svg viewBox="0 0 {ANCHO} {alto}" role="img" aria-label="CPU promedio por pod de {_e(nombre)}">',
              _bandas(datos['fases'], x, arriba, abajo, True), _ejes_tiempo(fin, x, alto - 6, arriba, abajo)]
    for t in ticks:
        partes.append(f'<text class="eje" x="{izq - 8}" y="{y(t) + 4:.1f}" text-anchor="end">{_fmt(t)}m</text>')
    partes.append(f'<line class="base" x1="{izq}" x2="{ANCHO - der}" y1="{abajo}" y2="{abajo}"/>')
    if objetivo:
        partes.append(f'<line class="umbral" x1="{izq}" x2="{ANCHO - der}" y1="{y(objetivo):.1f}" y2="{y(objetivo):.1f}"/>'
                      f'<text class="valor" x="{ANCHO - der}" y="{y(objetivo) - 6:.1f}" text-anchor="end">'
                      f'objetivo del HPA {_fmt(objetivo)}m por pod</text>')
    partes.append(f'<path class="linea-cpu" d="{_tramos([(t, h["cpu_m"] if h else None) for t, h in muestras], x, y)}"/>')
    for t, h in muestras:
        if h and h['cpu_m'] is not None:
            partes.append(f'<circle class="golpe" cx="{x(t):.1f}" cy="{y(h["cpu_m"]):.1f}" r="7">'
                          f'<title>{_mmss(t)} · CPU {h["cpu_m"]:.0f}m por pod · {h["actuales"]} réplica(s)</title></circle>')
    partes.append('</svg>')

    # Réplicas reales y las que pide o pediría el HPA.
    arriba, abajo, alto = 10, 92, 118
    maximo = max([2, original.get('maximo') or 0] + [v for _, h in muestras if h
                                                       for v in (h['actuales'], h['pide']) if v])

    def yr(v):
        return abajo - (abajo - arriba) * v / maximo
    partes.append(f'<svg viewBox="0 0 {ANCHO} {alto}" role="img" aria-label="Réplicas de {_e(nombre)}">')
    partes.append(_bandas(datos['fases'], x, arriba, abajo, False))
    partes.append(_ejes_tiempo(fin, x, alto - 6, arriba, abajo))
    for v in range(maximo + 1):
        partes.append(f'<text class="eje" x="{izq - 8}" y="{yr(v) + 4:.1f}" text-anchor="end">{v}</text>')
    partes.append(f'<line class="base" x1="{izq}" x2="{ANCHO - der}" y1="{abajo}" y2="{abajo}"/>')
    partes.append(f'<path class="linea-pide" d="{_escalon([(t, h["pide"] if h else None) for t, h in muestras], x, yr)}"/>')
    partes.append(f'<path class="linea-reales" d="{_escalon([(t, h["actuales"] if h else None) for t, h in muestras], x, yr)}"/>')
    partes.append('</svg>')
    return ''.join(partes)


def _tramos(puntos, x, y):
    camino, abierto = [], False
    for t, v in puntos:
        if v is None:
            abierto = False
            continue
        camino.append(f'{"L" if abierto else "M"}{x(t):.1f} {y(v):.1f}')
        abierto = True
    return ''.join(camino)


def _rango(minimo, maximo):
    return f'{minimo}–{maximo}' if minimo is not None and maximo is not None else '?'


def _tabla_hpa(datos):
    nombres = sorted({n for m in datos['muestras'] for n in (m['hpas'] or {})})
    filas = []
    for nombre in nombres:
        lecturas = [(m, m['hpas'][nombre]) for m in datos['muestras'] if m['hpas'] and nombre in m['hpas']]
        durante = [h for m, h in lecturas[1:] if not m['final']] or [h for _, h in lecturas]
        final = next((h for m, h in reversed(lecturas) if m['final']), None)
        original = datos['hpa_original'].get(nombre) or lecturas[0][1]
        cpus = [h['cpu_m'] for h in durante if h['cpu_m'] is not None]
        reales = [h['actuales'] for h in durante if h['actuales']]
        pide = [h['pide'] for h in durante if h['pide']]
        filas.append(
            f'<tr><th scope="row">{_e(nombre)}</th><td>{_rango(original["minimo"], original["maximo"])}</td>'
            f'<td>{", ".join(sorted({_rango(h["minimo"], h["maximo"]) for h in durante}))}</td>'
            f'<td>{_fmt(original["objetivo_m"]) + "m" if original["objetivo_m"] else "?"}</td>'
            f'<td>{_fmt(round(max(cpus))) + "m" if cpus else "sin métrica"}</td>'
            f'<td>{max(reales) if reales else "?"}</td><td>{max(pide) if pide else "?"}</td>'
            f'<td>{_rango(final["minimo"], final["maximo"]) if final else "pendiente"}</td></tr>')
    return ('<table><thead><tr><th>HPA</th><th>Límites originales</th><th>Durante la prueba</th>'
            '<th>Objetivo CPU</th><th>CPU máx. observada</th><th>Réplicas máx.</th>'
            '<th>Máx. que pediría</th><th>Al terminar</th></tr></thead><tbody>'
            + ''.join(filas) + '</tbody></table>')


def _tiles(rondas):
    latencias = [[x for r in rondas if r['modo'] == m for x in r['latencias']] for m in (0, 1)]
    lotes = [[r['lote_s'] for r in rondas if r['modo'] == m] for m in (0, 1)]
    if not all(latencias):
        return ''
    tiles = []
    for titulo, valores, unidad, decimales in (('Respuesta HTTP p50', latencias, 'ms', 0),
                                              ('Del primer evento al resumen, p50 por ronda', lotes, 's', 2)):
        sin, con = (percentil(v, 50) for v in valores)
        tiles.append(
            f'<div class="tile"><p class="tile-titulo">{titulo}</p><p class="tile-cifras">'
            f'<span><i class="clave m0"></i>SIN <b>{sin:.{decimales}f} {unidad}</b></span>'
            f'<span><i class="clave m1"></i>CON <b>{con:.{decimales}f} {unidad}</b></span></p>'
            f'<p class="tile-delta">{_diferencia(sin, con)}</p></div>')
    return '<div class="tiles">' + ''.join(tiles) + '</div>'


def _tabla_rondas(rondas):
    nombres = sorted({n for r in rondas for n in (r['replicas'] or {})})
    cabecera = ''.join(f'<th>Réplicas {_e(n)}</th>' for n in nombres)
    filas = ''.join(
        f'<tr><td>{r["ronda"]}</td><td class="izq"><i class="clave m{r["modo"]}"></i>{NOMBRES[r["modo"]]}</td>'
        f'<td>{r["p50"]:.1f}</td><td>{r["p95"]:.1f}</td><td>{r["lote_s"]:.2f}</td>'
        + ''.join(f'<td>{(r["replicas"] or {}).get(n, "?")}</td>' for n in nombres) + '</tr>'
        for r in rondas)
    return ('<table><thead><tr><th>Ronda</th><th class="izq">Modo</th><th>HTTP p50 (ms)</th><th>HTTP p95 (ms)</th>'
            f'<th>Evento→resumen (s)</th>{cabecera}</tr></thead><tbody>{filas}</tbody></table>')


def _tabla_final(resumen):
    sin, con = resumen['modos']
    filas = [('Respuesta HTTP p50 (ms)', sin['http_p50'], con['http_p50']),
             ('Respuesta HTTP p95 (ms)', sin['http_p95'], con['http_p95'])]
    for clave, etiqueta in (('p50', 'p50'), ('minimo', 'mínimo'), ('maximo', 'máximo')):
        filas.append((f'Lote eventos→resumen BD {etiqueta} (s)', sin['lote'][clave], con['lote'][clave]))
    cuerpo = ''.join(f'<tr><th scope="row">{e}</th><td>{a:.2f}</td><td>{b:.2f}</td><td>{_diferencia(a, b)}</td></tr>'
                     for e, a, b in filas)
    cuerpo += (f'<tr><th scope="row">Operaciones medidas</th><td>{sin["operaciones"]}</td>'
               f'<td>{con["operaciones"]}</td><td></td></tr>'
               '<tr><th scope="row">Errores</th><td>0</td><td>0</td><td></td></tr>')
    etapas = ''.join(
        f'<tr><th scope="row">{e}</th><td>{v["minimo"]:.2f}</td><td>{v["p50"]:.2f}</td><td>{v["maximo"]:.2f}</td></tr>'
        for e, v in (('Outbox/Beat→marca de publicación', resumen['outbox']),
                     ('Marca de publicación→evidencia*', resumen['posterior'])) if v)
    return ('<table><thead><tr><th>Métrica</th><th>SIN RabbitMQ</th><th>CON RabbitMQ</th><th>Diferencia</th>'
            f'</tr></thead><tbody>{cuerpo}</tbody></table>'
            '<h3>Etapas por evento CON RabbitMQ (ms)</h3>'
            '<table><thead><tr><th>Etapa</th><th>Mínimo</th><th>p50</th><th>Máximo</th></tr></thead>'
            f'<tbody>{etapas}</tbody></table>'
            f'<p class="nota">* Desfase firmado, no latencia AMQP pura: {resumen["solapados"]} eventos con '
            'evidencia anterior a la marca de publicación.</p>')


ESTILO = '''
:root{color-scheme:light;--fondo:#f9f9f7;--superficie:#fcfcfb;--tinta:#0b0b0b;--tinta2:#52514e;
--tenue:#898781;--rejilla:#e1e0d9;--eje:#c3c2b7;--m0:#2a78d6;--m1:#eb6834;--cpu:#1baf7a;
--gris:#e1e0d9;--borde:rgba(11,11,11,.10);--critico:#d03b3b;--bien:#006300}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--fondo:#0d0d0d;
--superficie:#1a1a19;--tinta:#f0efec;--tinta2:#c3c2b7;--tenue:#898781;--rejilla:#2c2c2a;--eje:#383835;
--m0:#3987e5;--m1:#d95926;--cpu:#199e70;--gris:#383835;--borde:rgba(255,255,255,.10);--critico:#e66767;--bien:#0ca30c}}
:root[data-theme="dark"]{color-scheme:dark;--fondo:#0d0d0d;--superficie:#1a1a19;--tinta:#f0efec;
--tinta2:#c3c2b7;--tenue:#898781;--rejilla:#2c2c2a;--eje:#383835;--m0:#3987e5;--m1:#d95926;
--cpu:#199e70;--gris:#383835;--borde:rgba(255,255,255,.10);--critico:#e66767;--bien:#0ca30c}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--tinta);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:800px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px}h3{font-size:16px;margin:20px 0 6px}
p{margin:6px 0}.sub,.nota,.vacio{color:var(--tinta2)}.nota{font-size:13px}
.estado{display:inline-flex;gap:8px;align-items:center;margin:12px 0;padding:6px 12px;border-radius:8px;
border:1px solid var(--borde);background:var(--superficie);font-weight:600}
.estado.invalida{border-color:var(--critico)}.estado.invalida .icono{color:var(--critico)}
.estado.terminada .icono{color:var(--bien)}
section,.tile{background:var(--superficie);border:1px solid var(--borde);border-radius:12px;padding:16px;margin:12px 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.tile{margin:0}
.tile-titulo{color:var(--tinta2);font-size:13px}.tile-cifras{display:flex;gap:20px;flex-wrap:wrap;font-size:18px}
.tile-cifras b{font-size:24px}.tile-delta{color:var(--tinta2)}
.clave{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:baseline}
.leyenda{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--tinta2);margin:4px 0}
.trazo{display:inline-block;width:22px;height:0;border-top:2px solid;vertical-align:middle;margin-right:6px}
.franja-clave{display:inline-block;width:14px;height:10px;margin-right:6px;vertical-align:baseline}
svg{display:block;width:100%;height:auto;margin:6px 0}
svg text{font:12px system-ui,-apple-system,"Segoe UI",sans-serif}
.eje{fill:var(--tenue)}.rotulo{fill:var(--tinta)}.valor{fill:var(--tinta2)}
.rejilla{stroke:var(--rejilla);stroke-width:1}.base{stroke:var(--eje);stroke-width:1}
.m0{background:var(--m0);fill:var(--m0)}.m1{background:var(--m1);fill:var(--m1)}
.punto{fill-opacity:.65;stroke:var(--superficie);stroke-width:2}
.marca{stroke:var(--tinta);stroke-width:2;stroke-linecap:round}
.banda-m0{fill:var(--m0);fill-opacity:.14}.banda-m1{fill:var(--m1);fill-opacity:.14}
.calentamiento{fill-opacity:.06}.banda-reinicio{fill:var(--gris);fill-opacity:.7}
.umbral{stroke:var(--tinta2);stroke-width:1.5}
.linea-cpu,.linea-reales{fill:none;stroke:var(--cpu);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.linea-pide{fill:none;stroke:var(--tinta2);stroke-width:2;stroke-dasharray:5 4}
.golpe{fill:transparent}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--rejilla)}
th:first-child,td:first-child,.izq{text-align:left}.izq{white-space:nowrap}
thead th{color:var(--tinta2);font-weight:600;vertical-align:bottom}
.tabla{overflow-x:auto}
@media (forced-colors:active){.punto,.clave{forced-color-adjust:none}}
'''


def pagina(datos):
    cfg, rondas = datos['config'], datos['rondas']
    en_curso = datos['estado'] == 'en_curso'
    if en_curso:
        estado = (f'<p class="estado en-curso"><span class="icono">●</span>En curso · se actualiza cada '
                  f'{INTERVALO_S} s · {_mmss(datos["duracion_s"])} transcurridos</p>')
    elif datos['estado'] == 'terminada':
        estado = (f'<p class="estado terminada"><span class="icono">✓</span>Terminada en '
                  f'{_mmss(datos["duracion_s"])} · cero errores</p>')
    else:
        estado = (f'<p class="estado invalida"><span class="icono">✕</span>Comparación inválida: '
                  f'{_e(datos["error"])} No usar estos números como resultado.</p>')
    fijo = cfg['autoescalado'] == 'fijo'
    if fijo:
        explicacion_hpa = ('Durante la medición el HPA queda fijado en las réplicas que había, para que SIN y '
                           'CON corran con la misma cantidad de pods. La línea punteada es lo que habría pedido '
                           f'con la fórmula del HPA: réplicas × CPU por pod ÷ objetivo, redondeado hacia arriba, '
                           f'con tolerancia del {TOLERANCIA_HPA:.0%} y dentro de los límites originales. No '
                           'considera la ventana de estabilización de bajada.')
    else:
        explicacion_hpa = ('El HPA estuvo libre durante la prueba (AUTOESCALADO=activo). La línea punteada son '
                           'las réplicas que pidió el controlador y la continua las que tenía el Deployment. Si '
                           'un modo corrió con más pods, la tabla de rondas lo muestra.')
    hpas = sorted({n for m in datos['muestras'] for n in (m['hpas'] or {})})
    graficos = ''.join(f'<h3>{_e(n)}</h3>{_graficos_hpa(datos, n)}' for n in hpas) or \
        '<p class="vacio">No se pudo leer el HPA con kubectl.</p>'
    http = _franja([[(x, f'ronda {r["ronda"]}') for r in rondas if r['modo'] == m for x in r['latencias']]
                    for m in (0, 1)], 'ms', (('p50', 50), ('p95', 95)))
    lote = _franja([[(r['lote_s'], f'ronda {r["ronda"]}') for r in rondas if r['modo'] == m] for m in (0, 1)],
                   's', (('p50', 50),))
    leyenda_modos = ('<p class="leyenda"><span><i class="clave m0"></i>SIN RabbitMQ: el recálculo dentro del POST</span>'
                     '<span><i class="clave m1"></i>CON RabbitMQ: el recálculo en el consumidor</span></p>')
    recarga = f'<meta http-equiv="refresh" content="{INTERVALO_S}">' if en_curso else ''
    tabla_rondas = _tabla_rondas(rondas) if rondas else '<p class="vacio">Todavía no termina ninguna ronda.</p>'
    final = (f'<section><h2>Resultado final</h2><div class="tabla">{_tabla_final(datos["resumen"])}</div></section>'
             if datos['resumen'] else '')
    return f'''<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
{recarga}
<title>Comparación RabbitMQ y autoscaling</title><style>{ESTILO}</style></head>
<body><main>
<h1>Comparación con y sin RabbitMQ</h1>
<p class="sub">{_e(cfg["host"])} · iniciada {_e(datos["inicio"].replace("T", " "))} · {cfg["operaciones"]} operaciones × {cfg["repeticiones"]}
rondas por modo · {cfg["conexiones"]} conexiones · {cfg["semilla"]} suscripciones iniciales ·
{cfg["calentamiento"]} POST de calentamiento · HPA {"fijo" if fijo else "activo"}</p>
{estado}
{_tiles(rondas)}
<section><h2>Respuesta HTTP por petición</h2>
<p class="sub">Cada punto es un POST medido desde este computador, en milisegundos. Incluye la red, el gateway y,
SIN RabbitMQ, el recálculo del resumen.</p>{leyenda_modos}{http}</section>
<section><h2>Del primer evento al resumen actualizado</h2>
<p class="sub">Un punto por ronda, en segundos, con las marcas guardadas en la base: desde el primer
<code>ocurrido_en</code> hasta el último <code>hecho_en</code>. CON RabbitMQ incluye la espera de Beat, que
despacha el outbox cada 10 s.</p>{leyenda_modos}{lote}</section>
<section><h2>Rondas</h2><div class="tabla">{tabla_rondas}</div></section>
{final}
<section><h2>Autoscaling de Kubernetes (HPA)</h2>
<p class="sub">{explicacion_hpa}</p>
<div class="tabla">{_tabla_hpa(datos) if hpas else ''}</div>
<p class="leyenda"><span><i class="franja-clave" style="background:var(--m0);opacity:.35"></i>POST SIN RabbitMQ</span>
<span><i class="franja-clave" style="background:var(--m1);opacity:.35"></i>POST CON RabbitMQ</span>
<span><i class="franja-clave" style="background:var(--gris)"></i>reinicio de la API al cambiar de modo</span></p>
<p class="leyenda"><span><i class="trazo" style="border-color:var(--cpu)"></i>CPU promedio por pod (arriba) y réplicas reales (abajo)</span>
<span><i class="trazo" style="border-color:var(--tinta2);border-top-style:dashed"></i>réplicas que {"pediría" if fijo else "pidió"} el HPA</span></p>
{graficos}
<p class="nota">El HPA lee la CPU de metrics-server y se actualiza cada ~15 s, así que una ráfaga corta puede no
alcanzar a verse. Las muestras se toman cada {INTERVALO_S} s con <code>kubectl get hpa</code>.</p></section>
<section><h2>Cómo leer esto</h2>
<p class="nota">Los dos modos hacen el mismo recálculo; cambia quién espera. El outbox y RabbitMQ siguen activos
para los demás eventos del contrato: no es una aplicación sin broker ni una prueba de caída. Las marcas de la base
las generan procesos de la aplicación y requieren relojes sincronizados. Esta prueba no mide ahorro de RAM.
Esta página no contiene tokens ni identificadores de organización.</p></section>
</main></body></html>
'''
