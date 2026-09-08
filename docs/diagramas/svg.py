import io, zlib, base64, urllib.request, re, os
_STD = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
_PML = b'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
def cod(t):
    c = zlib.compress(t.encode('utf-8'))[2:-4]
    return base64.b64encode(c).translate(bytes.maketrans(_STD, _PML)).decode().rstrip('=')
src = io.open('mer-corregido.puml', encoding='utf-8').read()
u = 'https://www.plantuml.com/plantuml/svg/' + cod(src)
r = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
svg = urllib.request.urlopen(r, timeout=120).read()
os.makedirs('png', exist_ok=True)
open('png/mer-corregido.svg', 'wb').write(svg)
m = re.search(rb'<svg[^>]*width="(\d+)"[^>]*height="(\d+)"', svg)
print('svg guardado:', len(svg), 'bytes | tamano real:', m.group(1).decode(), 'x', m.group(2).decode() if m else '?')
