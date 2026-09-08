import io, zlib, base64, urllib.request
_STD = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
_PML = b'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
def cod(t):
    c = zlib.compress(t.encode('utf-8'))[2:-4]
    return base64.b64encode(c).translate(bytes.maketrans(_STD, _PML)).decode().rstrip('=')
src = io.open('mer-corregido.puml', encoding='utf-8').read()
c = cod(src)
for fmt, dest in (('png', 'png/mer-corregido.png'), ('svg', 'png/mer-corregido.svg')):
    r = urllib.request.Request(f'https://www.plantuml.com/plantuml/{fmt}/{c}',
                               headers={'User-Agent': 'Mozilla/5.0'})
    open(dest, 'wb').write(urllib.request.urlopen(r, timeout=120).read())
from PIL import Image
an, al = Image.open('png/mer-corregido.png').size
print(f'PNG: {an} x {al}', '<- COMPLETO' if an < 4096 else '<- SIGUE CORTADO')
