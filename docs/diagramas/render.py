# -*- coding: utf-8 -*-
"""
Renderiza los diagramas .puml de esta carpeta contra el servidor de PlantUML.

    python render.py

Deja los PNG en png/ y escribe png/enlaces.md con los enlaces directos.
No requiere Java ni PlantUML instalado: codifica el diagrama en la URL.
"""
import base64
import io
import os
import urllib.request
import zlib

BASE = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(BASE, 'png')
SERVIDOR = 'https://www.plantuml.com/plantuml'

DIAGRAMAS = {
    'arquitectura-componentes': 'Diagrama de componentes',
    'arquitectura-despliegue': 'Diagrama de despliegue',
    'casos-de-uso': 'Diagrama de casos de uso',
    'modelo-datos': 'Modelo entidad-relación',
    'mer-corregido': 'MER corregido (56 hallazgos aplicados)',
}

_STD = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
_PML = b'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'


def codificar(texto):
    """Compresión deflate cruda + base64 con el alfabeto propio de PlantUML."""
    crudo = zlib.compress(texto.encode('utf-8'))[2:-4]
    return base64.b64encode(crudo).translate(
        bytes.maketrans(_STD, _PML)).decode().rstrip('=')


def bajar(url):
    # El servidor rechaza el User-Agent por defecto de urllib con un 403.
    pet = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(pet, timeout=90) as r:
        return r.read()


def main():
    os.makedirs(SALIDA, exist_ok=True)
    enlaces = []
    fallos = 0

    for nombre, titulo in DIAGRAMAS.items():
        fuente = os.path.join(BASE, nombre + '.puml')
        if not os.path.exists(fuente):
            print(f'  {nombre}: no existe el .puml, se omite')
            continue

        cod = codificar(io.open(fuente, encoding='utf-8').read())

        # La salida de texto delata los errores de sintaxis
        txt = bajar(f'{SERVIDOR}/txt/{cod}').decode('utf-8', 'replace')
        error = 'syntax error' in txt.lower()

        destino = os.path.join(SALIDA, nombre + '.png')
        png = bajar(f'{SERVIDOR}/png/{cod}')
        with open(destino, 'wb') as f:
            f.write(png)

        try:
            from PIL import Image
            an, al = Image.open(destino).size
            medida = f'{an} x {al} px   ratio {an / al:.2f}'
        except Exception:
            medida = f'{len(png)} bytes'

        estado = 'ERROR DE SINTAXIS' if error else 'ok'
        if error:
            fallos += 1
        print(f'  {nombre:28s} {estado:18s} {medida}')

        enlaces.append((nombre, titulo, cod))

    escribir_enlaces(enlaces)
    print('\nListo.' if not fallos else f'\n{fallos} diagrama(s) con errores.')


def escribir_enlaces(enlaces):
    doc = [
        '# Diagramas — enlaces de render',
        '',
        'Generado por `render.py`. Los PNG de esta carpeta ya están al día.',
        '',
        'Los enlaces llevan **el diagrama codificado en la propia URL**: se abren',
        'directo, sin pegar nada. Cambiar `/png/` por `/svg/` entrega vectorial,',
        'que escala mejor para imprimir.',
        '',
        '> Si editan un `.puml`, vuelvan a ejecutar `python render.py`:',
        '> estos enlaces quedan obsoletos.',
        '',
        '⚠️ Si prefieren pegar el `.puml` a mano en plantuml.com, verifiquen que',
        'el editor reciba **el archivo completo**. Un pegado truncado produce un',
        '«Syntax Error» que parece un problema del diagrama y no lo es.',
        '',
    ]
    for nombre, titulo, cod in enlaces:
        doc += [
            f'## {titulo}',
            '',
            f'- Fuente: `{nombre}.puml`',
            f'- Imagen: `png/{nombre}.png`',
            f'- [Abrir render PNG]({SERVIDOR}/png/{cod})',
            f'- [Abrir en el editor]({SERVIDOR}/uml/{cod})',
            '',
        ]
    io.open(os.path.join(SALIDA, 'enlaces.md'), 'w',
            encoding='utf-8').write('\n'.join(doc))


if __name__ == '__main__':
    print('Renderizando diagramas...')
    main()
