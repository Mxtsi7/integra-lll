import io, zlib, base64, urllib.request, os, glob
_STD = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
_PML = b'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
def cod(t):
    c = zlib.compress(t.encode('utf-8'))[2:-4]
    return base64.b64encode(c).translate(bytes.maketrans(_STD, _PML)).decode().rstrip('=')
def baja(u):
    r = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
    return urllib.request.urlopen(r, timeout=120).read()
os.makedirs('png', exist_ok=True)
for f in sorted(glob.glob('cu-*.puml')):
    n = f[:-5]
    c = cod(io.open(f, encoding='utf-8').read())
    txt = baja(f'https://www.plantuml.com/plantuml/txt/{c}').decode('utf-8', 'replace')
    err = 'syntax error' in txt.lower()
    open(f'png/{n}.png', 'wb').write(baja(f'https://www.plantuml.com/plantuml/png/{c}'))
    try:
        from PIL import Image
        s = Image.open(f'png/{n}.png').size
    except Exception:
        s = '?'
    print(f'{n:22} {"ERROR SINTAXIS" if err else "ok":16} {s}')
