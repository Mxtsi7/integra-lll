"""Comparación local y acotada del recálculo directo frente al consumidor AMQP."""
import argparse
import base64
import json
import math
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from estado_comparador import EstadoComparador, bandera
from metricas_comparador import metricas_eventos, percentil
from snapshot_comparador import Registro, RegistroNulo, leer_hpa


class SinRedireccion(HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None  # No reenviar Authorization ni convertir POST en GET.


def diferencia(sin, con):
    return f'{(con - sin) / sin * 100:+.1f}%' if sin else 'N/D'


def validar_vigencia(tokens, margen=120):
    # Solo evita empezar con una sesión a punto de expirar; Gateway verifica firma y revocación.
    for token in tokens:
        try:
            payload = token.split('.')[1]
            exp = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['exp']
            if type(exp) not in (int, float) or not math.isfinite(exp) or exp < time.time() + margen:
                raise ValueError()
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise ValueError('Sesión expirada, inválida o con menos de 2 minutos de vigencia; renovar ambos tokens.') from error


def configuracion():
    base = os.environ.get('URL_COMPARACION', '')
    url = urlsplit(base)
    if (not url.hostname or url.username or url.password or url.query or url.fragment
            or url.path not in ('', '/') or url.scheme != 'https'):
        raise ValueError('URL_COMPARACION debe ser el origen HTTPS público de la app, sin credenciales ni ruta.')
    cfg = dict(url=base.rstrip('/') + '/api/suscripciones/', tokens=[])
    for nombre in ('TOKEN_SIN', 'TOKEN_CON'):
        token = os.environ.get(nombre, '')
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token):
            raise ValueError(f'Definir {nombre} con una sesión de prueba vigente.')
        cfg['tokens'].append(token)
    for nombre, defecto, minimo, maximo in (
        ('OPERACIONES', 20, 1, 1000), ('REPETICIONES', 3, 1, 10),
        ('CONEXIONES', 2, 1, 8), ('SEMILLA', 100, 0, 10000), ('ESPERA', 120, 1, 600),
        ('CALENTAMIENTO', 2, 0, 20),
    ):
        valor = int(os.environ.get(nombre, str(defecto)))
        if not minimo <= valor <= maximo:
            raise ValueError(f'{nombre} debe estar entre {minimo} y {maximo}.')
        cfg[nombre.lower()] = valor
    # fijo: mismas réplicas en los dos modos. activo: el HPA puede escalar durante la prueba.
    cfg['autoescalado'] = os.environ.get('AUTOESCALADO', 'fijo').strip().lower()
    if cfg['autoescalado'] not in ('fijo', 'activo'):
        raise ValueError('AUTOESCALADO debe ser fijo o activo.')
    cfg['abrir'] = os.environ.get('ABRIR_SNAPSHOT', '1') != '0'
    validar_vigencia(cfg['tokens'])
    return cfg


def carga(url, token, correlacion, cantidad, conexiones, al_responder=None):
    payload = json.dumps(dict(nombre='Comparador ' + correlacion, monto='9990', moneda='CLP',
                              frecuencia='mensual', fecha_proximo_cobro=date.today().isoformat(),
                              categoria='streaming', estado='activo')).encode()

    def peticion(_):
        inicio = time.monotonic()
        req = Request(url, data=payload, headers={'Authorization': 'Bearer ' + token,
                      'Content-Type': 'application/json', 'X-Correlation-ID': correlacion})
        try:
            with build_opener(SinRedireccion()).open(req, timeout=30) as respuesta:
                codigo = respuesta.status
                datos = json.loads(respuesta.read(65536))
                uuid.UUID(datos['id'])  # Un 201 sin suscripción válida no acredita la operación.
        except HTTPError as error:
            codigo = error.code
            error.close()
        except (URLError, TimeoutError, OSError, ValueError, KeyError, TypeError):
            codigo = 0
        resultado = codigo, (time.monotonic() - inicio) * 1000
        if al_responder:
            al_responder(*resultado)  # El snapshot muestra cada POST apenas responde.
        return resultado

    with ThreadPoolExecutor(max_workers=conexiones) as pool:
        return list(pool.map(peticion, range(cantidad)))


# Ventana de bajada del HPA (120 s) + un paso de su política (60 s) + margen.
BASE_HPA_S = 360


def en_minimo(hpa, despliegue):
    minimo = hpa['spec'].get('minReplicas', 1)
    estado = hpa.get('status') or {}
    return (despliegue is not None and estado.get('currentReplicas') == minimo
            and estado.get('desiredReplicas') == minimo and despliegue['spec']['replicas'] == minimo
            and despliegue['status'].get('availableReplicas') == minimo)


# Cuota del namespace: gateway y subscriptions escalan de 1 a 2 (k8s/30-autoescalado.yaml).
REPLICAS_HPA = (1, 2)


def hpas_medidos(items, servicios):
    """Exactamente un HPA por servicio, de 1 a 2 réplicas: sin eso no hay autoscaling que acreditar."""
    hpas = []
    for nombre in servicios:
        propios = [h for h in items if h['spec']['scaleTargetRef']['name'] == nombre]
        if len(propios) != 1:
            raise RuntimeError(f'{nombre} tiene {len(propios)} HPA y debe tener exactamente uno: '
                               'sin él no se puede acreditar el autoscaling.')
        spec = propios[0]['spec']
        if (spec.get('minReplicas', 1), spec['maxReplicas']) != REPLICAS_HPA:
            raise RuntimeError(f'El HPA de {nombre} debe escalar de 1 a 2 réplicas, como en '
                               'k8s/30-autoescalado.yaml: revisar el clúster antes de medir.')
        hpas.append(propios[0])
    return hpas


def comando(argumentos, entrada=None, timeout=190, aislar=False):
    opciones = {}
    if aislar:
        if os.name == 'nt':
            opciones['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            opciones['start_new_session'] = True
    try:
        return subprocess.run(argumentos, input=entrada, text=True, capture_output=True,
                              check=True, timeout=timeout, **opciones).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        # stderr puede incluir datos de sesión. No imprimirlo ni mostrar stdin.
        raise RuntimeError('Falló kubectl: comprobar conexión, permisos y estado del clúster.') from error


class Cluster:
    hpa_fijo = True
    hpas_originales = None

    def __init__(self):
        contexto = comando(['kubectl', 'config', 'current-context']).strip()
        ns = comando(['kubectl', '--context', contexto, 'config', 'view', '--minify',
                      '-o', 'jsonpath={..namespace}']).strip() or 'default'
        self.prefijo = ['kubectl', '--context', contexto, '-n', ns]
        self.estado = EstadoComparador(self.k)
        self.limpiando = False
        self.recursos = {}

    def k(self, *argumentos, entrada=None, timeout=190):
        return comando(self.prefijo + list(argumentos), entrada, timeout, aislar=self.limpiando)

    def db(self, codigo, timeout=190):
        salida = self.k('exec', '-i', 'deployment/subscriptions', '-c', 'subscriptions', '--',
                        'python', 'manage.py', 'shell', entrada=(
                            'import json\nfrom app.models import Subscription, OutboxEvento, '
                            'TrabajoDerivado, ResumenOrganizacion\n' + codigo + '\n'), timeout=timeout)
        return json.loads(next(linea.removeprefix('COMPARADOR=') for linea in salida.splitlines()
                               if linea.startswith('COMPARADOR=')))

    def organizaciones(self, tokens):
        organizaciones = []
        for token in tokens:
            salida = self.k('exec', '-i', 'deployment/gateway', '-c', 'gateway', '--',
                            'python', 'manage.py', 'shell', '-c',
                            'import sys; from app.identidad import validar; '
                            'print(validar(sys.stdin.read().strip())["organizacion_id"])', entrada=token)
            organizaciones.append(str(uuid.UUID(salida.splitlines()[-1].strip())))
        if len(set(organizaciones)) != 2:
            raise ValueError('Usar dos organizaciones sintéticas distintas y vacías.')
        conteos = self.db(f'print("COMPARADOR=" + json.dumps(['
                          f'Subscription.objects.filter(organizacion_id=o).count() '
                          f'for o in {organizaciones!r}]))')
        if conteos != [0, 0]:
            raise ValueError('Ambas organizaciones deben estar vacías; no se borran datos automáticamente.')
        return organizaciones

    def preparar(self, fijar_hpa=True):
        self.hpa_fijo = fijar_hpa
        despliegues = json.loads(self.k('get', 'deployments', '-o', 'json'))['items']
        por_nombre = {d['metadata']['name']: d for d in despliegues}
        for nombre in ('gateway', 'subscriptions', 'subscriptions-beat', 'subscriptions-worker', 'rabbitmq'):
            d = por_nombre[nombre]
            replicas = d['spec']['replicas']
            if replicas < 1 or any(d['status'].get(c, 0) != replicas for c in
                                    ('readyReplicas', 'updatedReplicas', 'availableReplicas')):
                raise RuntimeError(f'{nombre} debe estar estable y activo, incluido Beat.')
        api = por_nombre['subscriptions']
        self.estado.comprobar_limpio(api)
        original = bandera(api)
        if original and 'value' in original:
            manifiesto = json.loads(api['metadata'].get('annotations', {}).get(
                'kubectl.kubernetes.io/last-applied-configuration', '{}'))
            declarado = bandera(manifiesto) if manifiesto.get('spec') else None
            if original != declarado:
                raise RuntimeError('EVENTOS_ASINCRONOS literal no declarado: revisar configuración o recuperar con --restaurar.')
        for nombre in ('gateway', 'subscriptions'):
            self.recursos[nombre] = por_nombre[nombre]['spec']
        hpas = [h for h in json.loads(self.k('get', 'hpa', '-o', 'json'))['items']
                if h['spec']['scaleTargetRef']['name'] in self.recursos]
        for h in hpas:
            if h['spec'].get('minReplicas', 1) >= h['spec']['maxReplicas']:
                raise RuntimeError('HPA ya fijado: recuperar --restaurar o conciliarlo con el manifiesto antes de medir.')
        if not fijar_hpa:
            # Con el HPA libre se muestra el autoscaling: sin sus dos HPA no hay nada que acreditar.
            hpas_medidos(hpas, self.recursos)
        self.hpas_originales = {h['spec']['scaleTargetRef']['name']: leer_hpa(h) for h in hpas}
        # Toda la configuración queda durable ANTES de congelar HPA o cambiar el modo.
        # Con el HPA activo se respalda igual: la restauración solo reaplica lo mismo.
        self.estado.guardar(api, hpas)
        for h in hpas if fijar_hpa else ():
            n = self.recursos[h['spec']['scaleTargetRef']['name']]['replicas']
            self.k('patch', 'hpa', h['metadata']['name'], '--type=merge', '-p',
                   json.dumps({'spec': dict(minReplicas=n, maxReplicas=n)}))
        self.drenar()

    def drenar(self, espera=120):
        limite = time.monotonic() + espera
        while True:
            restante = limite - time.monotonic()
            if restante <= 0:
                raise RuntimeError('No se drenaron outbox y subscriptions.resumen dentro del plazo.')
            pendientes = self.db('print("COMPARADOR=" + json.dumps('
                                'OutboxEvento.objects.filter(publicado_en__isnull=True).count()))', timeout=restante)
            restante = limite - time.monotonic()
            if restante <= 0:
                raise RuntimeError('No se drenó el outbox dentro del plazo.')
            colas = self.k('exec', 'deployment/rabbitmq', '--', 'rabbitmqctl',
                           'list_queues', 'name', 'messages', '--quiet', timeout=restante)
            resumen = [l.split()[1] for l in colas.splitlines()
                       if len(l.split()) == 2 and l.split()[0] == 'subscriptions.resumen']
            if time.monotonic() < limite and pendientes == 0 and resumen == ['0']:
                return
            time.sleep(min(1, max(0, limite - time.monotonic())))

    def sembrar(self, organizacion, cantidad):
        self.db('from datetime import date\nfrom decimal import Decimal\n'
                f'Subscription.objects.bulk_create([Subscription(organizacion_id={organizacion!r}, '
                'nombre=f"Semilla {i}", monto=Decimal("1000"), moneda="CLP", frecuencia="mensual", '
                'fecha_proximo_cobro=date.today(), categoria="streaming", estado="activo") '
                f'for i in range({cantidad})], batch_size=100)\nprint("COMPARADOR=null")')

    def modo(self, modo):
        self.k('set', 'env', 'deployment/subscriptions', '--containers=subscriptions',
               f'EVENTOS_ASINCRONOS={modo}')
        self.k('rollout', 'status', 'deployment/subscriptions', '--timeout=180s')
        self.drenar()

    def verificar(self):
        replicas = {}
        for nombre, original in self.recursos.items():
            actual = json.loads(self.k('get', 'deployment/' + nombre, '-o', 'json'))
            replicas[nombre] = actual['spec']['replicas']
            if self.hpa_fijo:
                # Los dos modos tienen que medir con las mismas réplicas.
                distinto = (replicas[nombre] != original['replicas'] or
                            actual['status'].get('availableReplicas') != original['replicas'])
            else:
                # El HPA puede cambiar réplicas; basta con que alguna esté atendiendo.
                distinto = not actual['status'].get('availableReplicas')
            if (distinto or
                    [(c['name'], c.get('resources'), c['image']) for c in actual['spec']['template']['spec']['containers']]
                    != [(c['name'], c.get('resources'), c['image']) for c in original['template']['spec']['containers']]):
                raise RuntimeError('Cambiaron réplicas, recursos o imágenes: comparación inválida.')
        return replicas

    def esperar_base(self, espera=BASE_HPA_S):
        """Con el HPA libre, espera a que cada HPA esté en su mínimo de pods.

        Sin esto, el segundo modo heredaría los pods que escaló el primero: el
        HPA tarda en bajar por su ventana de estabilización (k8s/30-autoescalado.yaml).
        Si en la espera falta o sobra un HPA, la comparación se invalida: una lista
        vacía no acredita el mínimo.
        """
        limite = time.monotonic() + espera
        while True:
            hpas = hpas_medidos(json.loads(self.k('get', 'hpa', '-o', 'json'))['items'], self.recursos)
            despliegues = {d['metadata']['name']: d
                           for d in json.loads(self.k('get', 'deployments', '-o', 'json'))['items']}
            if all(en_minimo(h, despliegues.get(h['spec']['scaleTargetRef']['name'])) for h in hpas):
                return
            if time.monotonic() >= limite:
                raise RuntimeError('El HPA no volvió a su mínimo de pods dentro del plazo: revisar si hay otra carga.')
            time.sleep(5)

    def esperar(self, org, correlacion, cantidad, total, operaciones, modo, espera):
        limite = time.monotonic() + espera
        autor = 'consumidor' if modo else 'api'
        while True:
            restante = limite - time.monotonic()
            if restante <= 0:
                raise RuntimeError('No se pudo acreditar todo el trabajo dentro del plazo.')
            estado = self.db(
                f'e = OutboxEvento.objects.filter(organizacion_id={org!r}, correlation_id={correlacion!r}, evento="suscripcion.creada")\n'
                't = TrabajoDerivado.objects.filter(evento_id__in=e.values("id"), trabajo="resumen_organizacion")\n'
                'trabajos = {str(x.evento_id): x.hecho_en for x in t}\n'
                'filas = [dict(evento_id=str(x.id), ocurrido_en=x.ocurrido_en, publicado_en=x.publicado_en, hecho_en=trabajos.get(str(x.id))) for x in e]\n'
                f'r = ResumenOrganizacion.objects.filter(organizacion_id={org!r})\n'
                'print("COMPARADOR=" + json.dumps(dict(eventos=e.count(), hechos=t.count(), '
                f'incorrectos=t.exclude(hecho_por={autor!r}).count(), '
                'pendientes=sum(x.publicado_en is None for x in e), '
                f'cantidad=Subscription.objects.filter(organizacion_id={org!r}).count(), '
                'filas=filas, resumen=list(r.values("moneda", "cantidad_activas", "total_mensual"))), default=str))', timeout=restante)
            observado = time.monotonic()
            if observado >= limite:
                raise RuntimeError('No se pudo acreditar todo el trabajo dentro del plazo.')
            if estado['incorrectos'] or estado['cantidad'] > cantidad or estado['eventos'] > operaciones:
                raise RuntimeError('Trabajo con autor o cantidad incorrectos: comparación inválida.')
            resumen = estado['resumen']
            completo = (estado['eventos'] == estado['hechos'] == operaciones
                        and estado['cantidad'] == cantidad and len(resumen) == 1
                        and resumen[0]['moneda'] == 'CLP' and resumen[0]['cantidad_activas'] == cantidad
                        and Decimal(resumen[0]['total_mensual']) == Decimal(total))
            if completo and estado['pendientes'] == 0:
                return metricas_eventos(estado['filas'], modo)
            time.sleep(min(1, limite - observado))

    def restaurar(self):
        # Una señal durante la limpieza se atiende después de restaurar TODO.
        anteriores, recibidas = {}, []
        def diferir(*_):
            recibidas.append(True)
        try:
            senales = [signal.SIGINT, signal.SIGTERM]
            if hasattr(signal, 'SIGHUP'):
                senales.append(signal.SIGHUP)
            for senal in senales:
                anteriores[senal] = signal.signal(senal, diferir)
            self.limpiando = True
            self.estado.restaurar()
        except RuntimeError:
            print('Recuperación pendiente. Original y comandos exactos (sin tokens):', file=sys.stderr)
            for c in self.estado.comandos(self.prefijo):
                print(c, file=sys.stderr)
            raise
        finally:
            self.limpiando = False
            for senal, manejador in anteriores.items():
                signal.signal(senal, manejador)
        if recibidas:
            raise KeyboardInterrupt()


def comparar(cfg, cluster, generador=carga, registro=None):
    registro = registro or RegistroNulo()
    resultados = [dict(latencias=[], totales=[], outbox=[], posterior=[], solapados=0) for _ in range(2)]
    calentamiento = cfg.get('calentamiento', 0)
    try:
        validar_vigencia(cfg['tokens'])
        organizaciones = cluster.organizaciones(cfg['tokens'])
        registro.iniciar()  # La primera muestra del HPA queda antes de fijarlo.
        cluster.preparar(fijar_hpa=cfg.get('autoescalado', 'fijo') == 'fijo')
        registro.originales(cluster.hpas_originales)
        for org in organizaciones:
            cluster.sembrar(org, cfg['semilla'])
        for ronda in range(cfg['repeticiones']):
            for modo in ((0, 1) if ronda % 2 == 0 else (1, 0)):
                validar_vigencia(cfg['tokens'])
                with registro.fase('reinicio', ronda + 1, modo):
                    cluster.modo(modo)
                cluster.verificar()
                if cfg.get('autoescalado', 'fijo') == 'activo':
                    # Cada modo parte con el mínimo de pods, no con los que escaló el anterior.
                    with registro.fase('enfriamiento', ronda + 1, modo):
                        cluster.esperar_base()
                print(f'Ronda {ronda + 1}/{cfg["repeticiones"]}: ' +
                      ('CON RabbitMQ' if modo else 'SIN RabbitMQ en el recálculo'), flush=True)
                previas = ronda * (cfg['operaciones'] + calentamiento)
                fases = [(calentamiento, False), (cfg['operaciones'], True)] if calentamiento else [(cfg['operaciones'], True)]
                for n, medido in fases:
                    validar_vigencia(cfg['tokens'])
                    correlacion = str(uuid.uuid4())
                    argumentos = (cfg['url'], cfg['tokens'][modo], correlacion, n, cfg['conexiones'])
                    # Cada POST medido aparece en el snapshot al responder; la ronda se acredita después.
                    avisar = registro.avisador(ronda + 1, modo) if medido else None
                    with registro.fase('http' if medido else 'calentamiento', ronda + 1, modo):
                        respuestas = generador(*argumentos, al_responder=avisar) if avisar else generador(*argumentos)
                    codigos = Counter(r[0] for r in respuestas)
                    if codigos != {201: n}:
                        raise RuntimeError(f'Comparación inválida: respuestas HTTP {dict(codigos)}; no se sigue.')
                    previas += n
                    cantidad = cfg['semilla'] + previas
                    total = cfg['semilla'] * 1000 + previas * 9990
                    tiempos = cluster.esperar(organizaciones[modo], correlacion, cantidad, total, n, modo, cfg['espera'])
                    replicas = cluster.verificar()
                    if not medido:
                        cluster.drenar()
                        continue
                    latencias = [r[1] for r in respuestas]
                    r = resultados[modo]
                    r['latencias'].extend(latencias)
                    r['totales'].append(tiempos['lote_s'])
                    r['outbox'].extend(tiempos['outbox_ms'])
                    r['posterior'].extend(tiempos['posterior_ms'])
                    r['solapados'] += tiempos['solapados']
                    registro.ronda(ronda + 1, modo, latencias, tiempos['lote_s'], replicas)
                    avance(ronda + 1, modo, latencias, tiempos['lote_s'], registro.lineas_hpa())
            if ronda + 1 < cfg['repeticiones']:
                mostrar(resultados, parcial=f'Parcial tras la ronda {ronda + 1}/{cfg["repeticiones"]}')
    finally:
        try:
            registro.detener()  # El muestreo solo lee; se corta antes de tocar la configuración.
        finally:
            # detener() puede esperar al muestreo hasta 25 s: un Ctrl+C ahí no se salta la restauración.
            cluster.restaurar()
    return resultados


def imprimir(texto=''):
    # Python de Windows bajo Git Bash escribe en cp1252, que no tiene "→": sin esto,
    # la tabla final cortaba la prueba recién terminada. main() ya fuerza UTF-8.
    try:
        print(texto, flush=True)
    except UnicodeEncodeError:
        codificacion = getattr(sys.stdout, 'encoding', None) or 'ascii'
        print(texto.encode(codificacion, 'replace').decode(codificacion), flush=True)


def avance(ronda, modo, latencias, lote_s, lineas_hpa):
    imprimir(f'  {"CON" if modo else "SIN"} · ronda {ronda}: HTTP p50 {percentil(latencias, 50):.1f} ms, '
             f'p95 {percentil(latencias, 95):.1f} ms · evento→resumen {lote_s:.2f} s')
    for linea in lineas_hpa:
        imprimir('    ' + linea)


def mostrar(resultados, parcial=None):
    sin, con = resultados
    imprimir('\n' + (parcial + '\n' if parcial else '') +
             'Métrica                             SIN RabbitMQ   CON RabbitMQ   Diferencia')
    for etiqueta, a, b in (
        ('Respuesta HTTP p50 (ms)', percentil(sin['latencias'], 50), percentil(con['latencias'], 50)),
        ('Respuesta HTTP p95 (ms)', percentil(sin['latencias'], 95), percentil(con['latencias'], 95)),
        ('Lote eventos→resumen BD p50 (s)', percentil(sin['totales'], 50), percentil(con['totales'], 50)),
        ('Lote eventos→resumen BD mínimo (s)', min(sin['totales']), min(con['totales'])),
        ('Lote eventos→resumen BD máximo (s)', max(sin['totales']), max(con['totales'])),
    ):
        imprimir(f'{etiqueta:<37}{a:>11.2f}{b:>15.2f}{diferencia(a, b):>13}')
    imprimir(f'Operaciones medidas/completadas       {len(sin["latencias"]):>11}{len(con["latencias"]):>15}')
    if parcial:
        return
    imprimir('Errores                                        0              0')
    imprimir('\nEtapas por evento CON RabbitMQ (ms)           mínimo          p50       máximo')
    for nombre, valores in (('Outbox/Beat→marca publicación', con['outbox']),
                             ('Marca publicación→evidencia*', con['posterior'])):
        imprimir(f'{nombre:<40}{min(valores):>10.2f}{percentil(valores, 50):>13.2f}{max(valores):>13.2f}')
    imprimir('Diferencia = (CON - SIN) / SIN; negativo significa menor tiempo.')
    imprimir('BD: max(hecho_en) - min(ocurrido_en) por ronda; el sondeo NO suma tiempo.')
    imprimir('Outbox incluye el ciclo de Beat (cada 10 s), publicación y confirmación.')
    imprimir(f'* Desfase firmado, no latencia AMQP pura: {con["solapados"]} eventos con evidencia anterior a la marca de publicación.')
    imprimir('El publicador guarda publicado_en después del confirm; puede solaparse con el consumidor.')
    imprimir('Las marcas se generan en procesos de app: requieren relojes sincronizados y no son marcas de commit.')
    imprimir('El broker sigue activo para otros eventos. Esta prueba no mide ahorro de RAM.')


def main(argumentos=None):
    parser = argparse.ArgumentParser(description='Comparar tiempos o recuperar configuración pendiente.')
    parser.add_argument('--restaurar', action='store_true')
    parser.add_argument('--si', action='store_true', help='Aceptar los reinicios de API en una ventana controlada.')
    args = parser.parse_args(argumentos)
    try:
        if args.restaurar:
            cluster = Cluster()
            if cluster.estado.cargar():
                cluster.restaurar()
                print('Configuración original restaurada y respaldo retirado.')
            else:
                print('No hay un respaldo pendiente en este contexto y namespace.')
            return 0
        cfg = configuracion()
        print('AVISO: cambiar de modo reinicia la API pública (Recreate), con interrupciones temporales.')
        print('No aumenta pods concurrentes, pero reemplaza el pod. Reservar una ventana sin tráfico ni despliegues.')
        if not args.si:
            if not sys.stdin.isatty() or input('Escribe SI para iniciar la prueba y sus reinicios: ').strip().upper() not in ('SI', 'SÍ'):
                raise ValueError('Prueba cancelada; para ejecución no interactiva autorizada usar --si.')
        print('Los datos sintéticos se conservan; ante un fallo usar cuentas nuevas o el flujo normal de eliminación.')
        print(f'{cfg["operaciones"]} operaciones × {cfg["repeticiones"]} rondas por modo; '
              f'{cfg["conexiones"]} conexiones, {cfg["semilla"]} iniciales, {cfg["calentamiento"]} POST de calentamiento por fase.')
        print(f'Autoescalado {cfg.get("autoescalado", "fijo")}: ' + (
            'el HPA queda fijo en las réplicas actuales mientras se mide.' if cfg.get('autoescalado', 'fijo') == 'fijo'
            else 'el HPA puede escalar durante la prueba; las réplicas de cada ronda quedan en el snapshot.'))
        cluster = Cluster()
        registro = Registro(cfg, muestrear=lambda: cluster.k('get', 'hpa', '-o', 'json', timeout=20),
                            abrir=cfg.get('abrir', True))
        try:
            resultados = comparar(cfg, cluster, registro=registro)
        except BaseException as error:
            registro.terminar(error=error)
            raise
        registro.terminar(resultados)
        mostrar(resultados)
        print(f'\nSnapshot guardado: {registro.html}')
        return 0
    except (ValueError, RuntimeError, KeyError, StopIteration) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Interrumpido; comprobar recuperación. Si quedó pendiente: comparar-cola.sh --restaurar.', file=sys.stderr)
        return 130


def interrumpir(*_):
    raise KeyboardInterrupt()


if __name__ == '__main__':
    # Git Bash entrega una tubería y Python de Windows escribiría en cp1252: acentos rotos.
    for flujo in (sys.stdout, sys.stderr):
        if hasattr(flujo, 'reconfigure'):
            flujo.reconfigure(encoding='utf-8')
    signal.signal(signal.SIGTERM, interrumpir)
    if hasattr(signal, 'SIGHUP'):
        signal.signal(signal.SIGHUP, interrumpir)
    sys.exit(main())
