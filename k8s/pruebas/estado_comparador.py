"""Respaldo durable en metadata del Deployment; no modifica el pod template."""
import json
import re
import shlex
import uuid

ANOTACION = 'ojoalgasto.cl/comparador-original'
RUTA_ANOTACION = '/metadata/annotations/' + ANOTACION.replace('~', '~0').replace('/', '~1')


def bandera(api):
    return next((e for c in api['spec']['template']['spec']['containers'] if c['name'] == 'subscriptions'
                 for e in c.get('env', []) if e['name'] == 'EVENTOS_ASINCRONOS'), None)


class EstadoComparador:
    def __init__(self, k):
        self.k, self.datos, self.adquirido = k, None, False

    def comprobar_limpio(self, api):
        if ANOTACION in api['metadata'].get('annotations', {}):
            raise RuntimeError('Hay una comparación pendiente. Ejecutar comparar-cola.sh --restaurar antes de otra corrida.')

    def guardar(self, api, hpas):
        self.comprobar_limpio(api)
        datos = dict(version=1, id=str(uuid.uuid4()), uid=api['metadata']['uid'], api=bandera(api),
                     hpas=[dict(nombre=h['metadata']['name'], uid=h['metadata']['uid'],
                                spec={k: h['spec'].get(k, 1) for k in ('minReplicas', 'maxReplicas')}) for h in hpas])
        self._validar(datos, api)
        anotaciones = dict(api['metadata'].get('annotations') or {})
        anotaciones[ANOTACION] = json.dumps(datos, separators=(',', ':'))
        parche = [dict(op='test', path='/metadata/resourceVersion', value=api['metadata']['resourceVersion']),
                  dict(op='add', path='/metadata/annotations', value=anotaciones)]
        self.datos = datos
        try:
            self.k('patch', 'deployment/subscriptions', '--type=json', '-p', json.dumps(parche))
            self.adquirido = True
        except RuntimeError:
            # La respuesta puede perderse después de guardar: comprobar propiedad.
            actual = json.loads(self.k('get', 'deployment/subscriptions', '-o', 'json'))
            valor = actual['metadata'].get('annotations', {}).get(ANOTACION)
            self.adquirido = bool(valor and json.loads(valor).get('id') == datos['id'])
            raise

    def _validar(self, datos, api):
        def exigir(condicion):
            if not condicion:
                raise ValueError('Esquema de respaldo inválido')
        try:
            exigir(type(datos['version']) is int and datos['version'] == 1 and datos['uid'] == api['metadata']['uid'])
            uuid.UUID(datos['id'])
            original = datos['api']
            exigir(original is None or (isinstance(original, dict) and original['name'] == 'EVENTOS_ASINCRONOS'
                   and set(original) <= {'name', 'value', 'valueFrom'}
                   and ('value' in original) != ('valueFrom' in original)))
            nombres = set()
            exigir(isinstance(datos['hpas'], list))
            for h in datos['hpas']:
                exigir(re.fullmatch(r'[a-z0-9]([a-z0-9.-]*[a-z0-9])?', h['nombre']) is not None)
                exigir(h['nombre'] not in nombres)
                nombres.add(h['nombre'])
                uuid.UUID(h['uid'])
                exigir(set(h['spec']) == {'minReplicas', 'maxReplicas'})
                exigir(all(type(n) is int for n in h['spec'].values()))
                exigir(1 <= h['spec']['minReplicas'] <= h['spec']['maxReplicas'])
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            raise RuntimeError('Respaldo del comparador inválido o Deployment reemplazado; no se sobrescribe la configuración.') from error

    def cargar(self):
        api = json.loads(self.k('get', 'deployment/subscriptions', '-o', 'json'))
        raw = api['metadata'].get('annotations', {}).get(ANOTACION)
        if raw is None:
            return False
        try:
            datos = json.loads(raw)
        except (ValueError, TypeError) as error:
            raise RuntimeError('Respaldo del comparador corrupto; revisar la anotación antes de recuperar.') from error
        self._validar(datos, api)
        self.datos, self.adquirido = datos, True
        return True

    def _comando_api(self):
        if self.datos['api'] is None:
            return ['set', 'env', 'deployment/subscriptions', '--containers=subscriptions', 'EVENTOS_ASINCRONOS-']
        entrada = dict(name='EVENTOS_ASINCRONOS', value=None, valueFrom=None)
        entrada.update(self.datos['api'])
        parche = {'spec': {'template': {'spec': {'containers': [{'name': 'subscriptions', 'env': [entrada]}]}}}}
        return ['patch', 'deployment/subscriptions', '--type=strategic', '-p', json.dumps(parche)]

    def comandos(self, prefijo):
        if not self.datos:
            return []
        comandos = [self._comando_api(), ['rollout', 'status', 'deployment/subscriptions', '--timeout=180s']]
        comandos.extend(['patch', 'hpa', h['nombre'], '--type=merge', '-p', json.dumps({'spec': h['spec']})]
                         for h in self.datos['hpas'])
        return [shlex.join(prefijo + c) for c in comandos]

    def restaurar(self):
        if not self.adquirido:
            return
        fallos = []
        try:
            api = json.loads(self.k('get', 'deployment/subscriptions', '-o', 'json'))
            self._validar(self.datos, api)
            raw = api['metadata'].get('annotations', {}).get(ANOTACION)
            if raw is None or json.loads(raw) != self.datos:
                raise RuntimeError('La marca de recuperación cambió; no se restaura otro proceso.')
        except (RuntimeError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError('No se pudo restaurar: comprobar respaldo y UID del Deployment.') from error
        try:
            self.k(*self._comando_api())
            self.k('rollout', 'status', 'deployment/subscriptions', '--timeout=180s')
            comprobado = json.loads(self.k('get', 'deployment/subscriptions', '-o', 'json'))
            if bandera(comprobado) != self.datos['api']:
                raise RuntimeError('Bandera no restaurada')
        except RuntimeError:
            fallos.append('deployment/subscriptions')
        for h in self.datos['hpas']:
            try:
                actual = json.loads(self.k('get', 'hpa/' + h['nombre'], '-o', 'json'))
                if actual['metadata']['uid'] != h['uid']:
                    raise RuntimeError('HPA reemplazado')
                self.k('patch', 'hpa', h['nombre'], '--type=merge', '-p', json.dumps({'spec': h['spec']}))
                actual = json.loads(self.k('get', 'hpa/' + h['nombre'], '-o', 'json'))
                if any(actual['spec'].get(k) != v for k, v in h['spec'].items()):
                    raise RuntimeError('HPA no restaurado')
            except RuntimeError:
                fallos.append('hpa/' + h['nombre'])
        if fallos:
            raise RuntimeError('No se pudo restaurar: ' + ', '.join(fallos) + '. Se conserva el respaldo; usar --restaurar.')
        # Retirar solamente nuestra marca y solo tras verificar API y HPA.
        api = json.loads(self.k('get', 'deployment/subscriptions', '-o', 'json'))
        raw = api['metadata']['annotations'][ANOTACION]
        if json.loads(raw) != self.datos:
            raise RuntimeError('La marca cambió antes de limpiar: se conserva para revisión.')
        self.k('patch', 'deployment/subscriptions', '--type=json', '-p', json.dumps([
            dict(op='test', path='/metadata/resourceVersion', value=api['metadata']['resourceVersion']),
            dict(op='test', path=RUTA_ANOTACION, value=raw), dict(op='remove', path=RUTA_ANOTACION)]))
        self.adquirido = False
