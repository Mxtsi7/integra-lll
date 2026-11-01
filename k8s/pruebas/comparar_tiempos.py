"""Comparación local y acotada del recálculo directo frente al consumidor AMQP."""
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


class SinRedireccion(HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None  # No reenviar Authorization ni convertir POST en GET.


def percentil(valores, porcentaje):
    ordenados = sorted(valores)
    posicion = (len(ordenados) - 1) * porcentaje / 100
    inferior = math.floor(posicion)
    superior = math.ceil(posicion)
    return ordenados[inferior] + (ordenados[superior] - ordenados[inferior]) * (posicion - inferior)


def diferencia(sin, con):
    return f'{(con - sin) / sin * 100:+.1f}%' if sin else 'N/D'


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
    ):
        valor = int(os.environ.get(nombre, str(defecto)))
        if not minimo <= valor <= maximo:
            raise ValueError(f'{nombre} debe estar entre {minimo} y {maximo}.')
        cfg[nombre.lower()] = valor
    return cfg


def carga(url, token, correlacion, cantidad, conexiones):
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
        return codigo, (time.monotonic() - inicio) * 1000

    with ThreadPoolExecutor(max_workers=conexiones) as pool:
        return list(pool.map(peticion, range(cantidad)))


def comando(argumentos, entrada=None, timeout=190):
    try:
        return subprocess.run(argumentos, input=entrada, text=True, capture_output=True,
                              check=True, timeout=timeout).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        # stderr puede incluir datos de sesión. No imprimirlo ni mostrar stdin.
        raise RuntimeError('Falló kubectl: comprobar conexión, permisos y estado del clúster.') from error


class Cluster:
    def __init__(self):
        contexto = comando(['kubectl', 'config', 'current-context']).strip()
        ns = comando(['kubectl', '--context', contexto, 'config', 'view', '--minify',
                      '-o', 'jsonpath={..namespace}']).strip() or 'default'
        self.prefijo = ['kubectl', '--context', contexto, '-n', ns]
        self.hpas, self.cambio_api, self.original = [], False, None
        self.recursos = {}

    def k(self, *argumentos, entrada=None, timeout=190):
        return comando(self.prefijo + list(argumentos), entrada, timeout)

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

    def preparar(self):
        despliegues = json.loads(self.k('get', 'deployments', '-o', 'json'))['items']
        por_nombre = {d['metadata']['name']: d for d in despliegues}
        for nombre in ('gateway', 'subscriptions', 'subscriptions-beat', 'subscriptions-worker', 'rabbitmq'):
            d = por_nombre[nombre]
            replicas = d['spec']['replicas']
            if replicas < 1 or any(d['status'].get(c, 0) != replicas for c in
                                    ('readyReplicas', 'updatedReplicas', 'availableReplicas')):
                raise RuntimeError(f'{nombre} debe estar estable y activo, incluido Beat.')
        api = por_nombre['subscriptions']['spec']['template']['spec']['containers']
        self.original = next((e for c in api if c['name'] == 'subscriptions'
                              for e in c.get('env', []) if e['name'] == 'EVENTOS_ASINCRONOS'), None)
        for nombre in ('gateway', 'subscriptions'):
            self.recursos[nombre] = por_nombre[nombre]['spec']
        # Guardar antes de cada escritura permite restaurar incluso una respuesta ambigua.
        for hpa in json.loads(self.k('get', 'hpa', '-o', 'json'))['items']:
            objetivo = hpa['spec']['scaleTargetRef']['name']
            if objetivo in self.recursos:
                nombre = hpa['metadata']['name']
                original = {k: hpa['spec'].get(k) for k in ('minReplicas', 'maxReplicas')}
                self.hpas.append((nombre, original))
                n = self.recursos[objetivo]['replicas']
                self.k('patch', 'hpa', nombre, '--type=merge', '-p',
                       json.dumps({'spec': dict(minReplicas=n, maxReplicas=n)}))
        self.drenar()

    def drenar(self):
        pendientes = self.db('print("COMPARADOR=" + json.dumps('
                            'OutboxEvento.objects.filter(publicado_en__isnull=True).count()))')
        colas = self.k('exec', 'deployment/rabbitmq', '--', 'rabbitmqctl',
                       'list_queues', 'name', 'messages', '--quiet')
        resumen = [l.split()[1] for l in colas.splitlines()
                   if len(l.split()) == 2 and l.split()[0] == 'subscriptions.resumen']
        if pendientes != 0 or resumen != ['0']:
            raise RuntimeError('Esperar al drenaje de outbox y subscriptions.resumen antes de comparar.')

    def sembrar(self, organizacion, cantidad):
        self.db('from datetime import date\nfrom decimal import Decimal\n'
                f'Subscription.objects.bulk_create([Subscription(organizacion_id={organizacion!r}, '
                'nombre=f"Semilla {i}", monto=Decimal("1000"), moneda="CLP", frecuencia="mensual", '
                'fecha_proximo_cobro=date.today(), categoria="streaming", estado="activo") '
                f'for i in range({cantidad})], batch_size=100)\nprint("COMPARADOR=null")')

    def modo(self, modo):
        self.cambio_api = True
        self.k('set', 'env', 'deployment/subscriptions', '--containers=subscriptions',
               f'EVENTOS_ASINCRONOS={modo}')
        self.k('rollout', 'status', 'deployment/subscriptions', '--timeout=180s')
        self.drenar()

    def verificar(self):
        for nombre, original in self.recursos.items():
            actual = json.loads(self.k('get', 'deployment/' + nombre, '-o', 'json'))
            if (actual['spec']['replicas'] != original['replicas'] or
                    actual['status'].get('availableReplicas') != original['replicas'] or
                    [(c['name'], c.get('resources'), c['image']) for c in actual['spec']['template']['spec']['containers']]
                    != [(c['name'], c.get('resources'), c['image']) for c in original['template']['spec']['containers']]):
                raise RuntimeError('Cambiaron réplicas, recursos o imágenes: comparación inválida.')

    def esperar(self, org, correlacion, cantidad, total, operaciones, modo, espera):
        limite, fin = time.monotonic() + espera, None
        autor = 'consumidor' if modo else 'api'
        while True:
            restante = limite - time.monotonic()
            if restante <= 0:
                raise RuntimeError('No se pudo acreditar todo el trabajo dentro del plazo.')
            estado = self.db(
                f'e = OutboxEvento.objects.filter(organizacion_id={org!r}, correlation_id={correlacion!r}, evento="suscripcion.creada")\n'
                't = TrabajoDerivado.objects.filter(evento_id__in=e.values("id"), trabajo="resumen_organizacion")\n'
                f'r = ResumenOrganizacion.objects.filter(organizacion_id={org!r})\n'
                'print("COMPARADOR=" + json.dumps(dict(eventos=e.count(), hechos=t.count(), '
                f'incorrectos=t.exclude(hecho_por={autor!r}).count(), '
                'pendientes=e.filter(publicado_en__isnull=True).count(), '
                f'cantidad=Subscription.objects.filter(organizacion_id={org!r}).count(), '
                'resumen=list(r.values("moneda", "cantidad_activas", "total_mensual"))), default=str))', timeout=restante)
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
            if completo and fin is None:
                fin = observado
            if fin is not None and estado['pendientes'] == 0:
                return fin
            time.sleep(min(1, limite - observado))

    def restaurar(self):
        # Una señal durante la limpieza se atiende después de restaurar TODO.
        anteriores, recibidas = {}, []
        def diferir(*_):
            recibidas.append(True)
        try:
            for senal in (signal.SIGINT, signal.SIGTERM):
                anteriores[senal] = signal.signal(senal, diferir)
            self._restaurar()
        finally:
            for senal, manejador in anteriores.items():
                signal.signal(senal, manejador)
        if recibidas:
            raise KeyboardInterrupt()

    def _restaurar(self):
        fallos = []
        if self.cambio_api:
            try:
                if self.original is None:
                    self.k('set', 'env', 'deployment/subscriptions', '--containers=subscriptions', 'EVENTOS_ASINCRONOS-')
                else:
                    entrada = dict(name='EVENTOS_ASINCRONOS', value=None, valueFrom=None)
                    entrada.update(self.original)
                    parche = {'spec': {'template': {'spec': {'containers': [
                        {'name': 'subscriptions', 'env': [entrada]}]}}}}
                    self.k('patch', 'deployment/subscriptions', '--type=strategic', '-p', json.dumps(parche))
                self.k('rollout', 'status', 'deployment/subscriptions', '--timeout=180s')
            except RuntimeError:
                fallos.append('deployment/subscriptions (EVENTOS_ASINCRONOS)')
        for nombre, spec in reversed(self.hpas):
            try:
                self.k('patch', 'hpa', nombre, '--type=merge', '-p', json.dumps({'spec': spec}))
            except RuntimeError:
                fallos.append('hpa/' + nombre)
        if fallos:
            raise RuntimeError('No se pudo restaurar: ' + ', '.join(fallos) + '. Revisar antes de volver a ejecutar.')


def comparar(cfg, cluster, generador=carga):
    resultados = [dict(latencias=[], totales=[]), dict(latencias=[], totales=[])]
    try:
        organizaciones = cluster.organizaciones(cfg['tokens'])
        cluster.preparar()
        for org in organizaciones:
            cluster.sembrar(org, cfg['semilla'])
        for ronda in range(cfg['repeticiones']):
            for modo in ((0, 1) if ronda % 2 == 0 else (1, 0)):
                cluster.modo(modo)
                cluster.verificar()
                correlacion = str(uuid.uuid4())
                print(f'Ronda {ronda + 1}/{cfg["repeticiones"]}: ' +
                      ('CON RabbitMQ' if modo else 'SIN RabbitMQ en el recálculo'), flush=True)
                inicio = time.monotonic()
                respuestas = generador(cfg['url'], cfg['tokens'][modo], correlacion,
                                        cfg['operaciones'], cfg['conexiones'])
                codigos = Counter(r[0] for r in respuestas)
                if codigos != {201: cfg['operaciones']}:
                    raise RuntimeError(f'Comparación inválida: respuestas HTTP {dict(codigos)}; no se sigue.')
                cantidad = cfg['semilla'] + (ronda + 1) * cfg['operaciones']
                total = cfg['semilla'] * 1000 + (ronda + 1) * cfg['operaciones'] * 9990
                fin = cluster.esperar(organizaciones[modo], correlacion, cantidad, total,
                                      cfg['operaciones'], modo, cfg['espera'])
                cluster.verificar()
                resultados[modo]['latencias'].extend(r[1] for r in respuestas)
                resultados[modo]['totales'].append(fin - inicio)
    finally:
        cluster.restaurar()
    return resultados


def mostrar(resultados):
    sin, con = resultados
    print('\nMétrica                             SIN RabbitMQ   CON RabbitMQ   Diferencia')
    for etiqueta, a, b in (
        ('Respuesta HTTP p50 (ms)', percentil(sin['latencias'], 50), percentil(con['latencias'], 50)),
        ('Respuesta HTTP p95 (ms)', percentil(sin['latencias'], 95), percentil(con['latencias'], 95)),
        ('Trabajo completo p50 por ronda (s)', percentil(sin['totales'], 50), percentil(con['totales'], 50)),
    ):
        print(f'{etiqueta:<37}{a:>11.2f}{b:>15.2f}{diferencia(a, b):>13}')
    print(f'Operaciones completadas              {len(sin["latencias"]):>11}{len(con["latencias"]):>15}')
    print('Errores                                        0              0')
    print('Diferencia = (CON - SIN) / SIN; negativo significa menor tiempo.')
    print('Total observado hasta acreditar el resumen; incluye comprobación/sondeo de 1 s.')
    print('El broker sigue activo para otros eventos. Esta prueba no mide ahorro de RAM.')


def main():
    try:
        cfg = configuracion()
        print('Comparador local: no crea pods. Mantener una ventana sin tráfico ni despliegues ajenos.')
        print('Se conservan los datos sintéticos; usar organizaciones descartables.')
        print(f'{cfg["operaciones"]} operaciones × {cfg["repeticiones"]} rondas por modo; '
              f'{cfg["conexiones"]} conexiones, {cfg["semilla"]} suscripciones iniciales.')
        resultados = comparar(cfg, Cluster())
        mostrar(resultados)  # Solo después de restaurar correctamente.
        return 0
    except (ValueError, RuntimeError, KeyError, StopIteration) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Comparación interrumpida; se intentó restaurar API y HPA.', file=sys.stderr)
        return 130


def interrumpir(*_):
    raise KeyboardInterrupt()


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrumpir)
    sys.exit(main())
