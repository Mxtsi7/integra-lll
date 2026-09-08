import io
R = 'mer-corregido.puml'
s = io.open(R, encoding='utf-8').read()

# 1. Cardinalidades: el lado padre debe ser opcional donde la FK admite nulo.
#    Con || el diagrama afirma "exactamente uno" y quien implemente pone NOT NULL,
#    reintroduciendo M-08, M-10, M-11, M-21 y M-28.
rel = [
    ('sub  ||--o{ mov  : "genera"',        'sub  |o--o{ mov  : "genera"'),
    ('sub  ||--o{ his  : "audita"',        'sub  |o--o{ his  : "audita"'),
    ('con  ||--o{ mov  : "detecta"',       'con  |o--o{ mov  : "detecta"'),
    ('con  ||--o{ uso  : "sincroniza"',    'con  |o--o{ uso  : "sincroniza"'),
    ('prov ||--o| gui  : "tiene"',         'prov |o--o| gui  : "tiene"'),
    ('prov ||--o{ sub  : "provee"',        'prov |o--o{ sub  : "provee"'),
    ('ano  ||--o{ not  : "origina"',       'ano  |o--o{ not  : "origina"\nsub  |o--o{ not  : "motiva"'),
]
for a, b in rel:
    assert a in s, 'NO ENCONTRADO: ' + a
    s = s.replace(a, b)

# 2. Marcar la nulidad en el campo, para que no dependa de leer la nota.
campos = [
    ('    id_suscripcion : uuid <<FK>>\n    id_conector : uuid\n    monto : decimal(12,2)\n    moneda : char(3)\n    fecha_movimiento',
     '    id_suscripcion : uuid <<FK,NULL>>\n    id_conector : uuid <<NULL>>\n    monto : decimal(12,2)\n    moneda : char(3)\n    fecha_movimiento'),
    ('    id_suscripcion : uuid <<FK>>\n    estado_anterior',
     '    id_suscripcion : uuid <<FK,NULL>>\n    estado_anterior'),
    ('    id_proveedor : uuid <<FK>>\n    es_generica',
     '    id_proveedor : uuid <<FK,NULL>>\n    es_generica'),
    ('    id_suscripcion : uuid <<FK>>\n    id_anomalia : uuid <<FK>>',
     '    id_suscripcion : uuid <<FK,NULL>>\n    id_anomalia : uuid <<FK,NULL>>'),
    ('    id_proveedor : uuid <<FK>>\n    id_categoria : uuid <<FK>>',
     '    id_proveedor : uuid <<FK,NULL>>\n    id_categoria : uuid <<FK>>'),
    ('    id_conector : uuid\n    fecha : date\n    cantidad',
     '    id_conector : uuid <<NULL>>\n    fecha : date\n    cantidad'),
]
for a, b in campos:
    assert a in s, 'NO ENCONTRADO campo: ' + a[:60]
    s = s.replace(a, b)

# 3. PLAN_CONTRATADO: tenia FK dura a USUARIO y ninguna columna de purga, de modo
#    que su supervivencia de 6 anios era imposible. Se desacopla como CONSENTIMIENTO.
a = '''    seudonimo_titular : uuid
    id_usuario : uuid <<FK>>
    plan : varchar(20)'''
b = '''    seudonimo_titular : uuid
    id_usuario : uuid <<NULL>>
    plan : varchar(20)'''
assert a in s
s = s.replace(a, b)

a = '''    monto : decimal(12,2)
    moneda : char(3)
    --
    //NUNCA datos de tarjeta: solo//'''
b = '''    monto : decimal(12,2)
    moneda : char(3)
    fecha_eliminacion_cuenta : date
    purga_en : date
    --
    //id_usuario se pone en NULO al//
    //eliminar la cuenta: sin FK dura,//
    //igual que CONSENTIMIENTO//
    //NUNCA datos de tarjeta: solo//'''
assert a in s
s = s.replace(a, b)

a = 'usr ||--o{ pln   : "contrata"'
b = ''
assert a in s
s = s.replace(a + '\n', '')
s = s.replace('usr .. iac  : "referencia débil"',
              'usr .. iac  : "referencia débil"\nusr .. pln  : "seudónimo, sin FK"')

# 4. Leyenda: faltaba la notacion de nulidad y la de los campos de titular.
a = '  | **id_usuario** en negrita | Campo de titular. Toda consulta filtra por él (RF-20, RNF-19) |'
b = ('  | **id_usuario** en negrita | Campo de titular. Toda consulta filtra por él (RF-20, RNF-19). Cruza servicio: referencia lógica, sin clave foránea del motor (ADR-002) |\n'
     '  | <<NULL>> | El campo admite nulo. En la relación, el lado padre se dibuja |o |')
assert a in s
s = s.replace(a, b)

io.open(R, 'w', encoding='utf-8').write(s)
print('puml: ok')
