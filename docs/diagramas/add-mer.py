import io
R = 'render.py'
s = io.open(R, encoding='utf-8').read()
viejo = "    'modelo-datos': 'Modelo entidad-relación',\n}"
nuevo = "    'modelo-datos': 'Modelo entidad-relación',\n    'mer-corregido': 'MER corregido (56 hallazgos aplicados)',\n}"
if 'mer-corregido' in s:
    print('ya estaba')
elif viejo not in s:
    raise SystemExit('NO ENCONTRADO')
else:
    io.open(R, 'w', encoding='utf-8').write(s.replace(viejo, nuevo))
    print('ok')
