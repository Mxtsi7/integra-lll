import io
R = 'mer-corregido.md'
s = io.open(R, encoding='utf-8').read()

# 1. La afirmacion "todos los dominios quedan cerrados" era falsa: faltaban diez campos.
a = 'Todos los dominios quedan cerrados (M-16, M-46, M-53). Antes eran cadenas libres.'
b = 'Todos los campos de dominio cerrado del modelo, incluidos los seis que nombra M-16 y los de M-53. Antes eran cadenas libres.'
assert a in s
s = s.replace(a, b)

a = '| `INTENTO_ACCESO_CRUZADO.resultado` | `denegado` · `no_existe` |'
b = '''| `INTENTO_ACCESO_CRUZADO.resultado` | `denegado` · `no_existe` |
| `USUARIO.plan` | `gratuito` · `premium` |
| `NOTIFICACION.tipo` | `proximo_cobro` · `fin_prueba` · `alza_tarifa` · `doble_cobro` · `presupuesto` |
| `NOTIFICACION.estado` | `programada` · `enviada` · `fallida` · `cancelada` |
| `MOVIMIENTO.origen` | `manual` · `csv` · `pdf` · `correo` · `conector` |
| `CONECTOR.estado` | `conectado` · `expirado` · `revocado` · `con_error` |
| `RECOMENDACION.tipo` | `cancelar` · `solapamiento` · `cambio_plan` |
| `RECOMENDACION.estado` | `pendiente` · `aceptada` · `descartada` |
| `DISPOSITIVO.plataforma` | `android` · `ios` · `web` |
| `CONFIGURACION_ALERTA.canal` | `correo` · `push` · `in_app` |
| `HISTORIAL_ESTADO.motivo` | Las causas de RN-15 y RN-17 a RN-21: `fin_prueba` · `sin_uso_45d` · `sin_cobro_60d` · `sin_cobro_90d` · `cobro_detectado` · `baja_manual` · `pausa_manual` |'''
assert a in s
s = s.replace(a, b)

# 2. La anonimizacion dejaba intacto id_usuario, que es justo lo que RF-01.7 manda borrar.
a = '| `HISTORIAL_ESTADO` | **Se anonimiza**: `id_suscripcion` a nulo, se llenan `seudonimo` y `fecha_eliminacion_cuenta`. Purga a los 12 meses por esa fecha |'
b = '| `HISTORIAL_ESTADO` | **Se anonimiza**: `id_usuario` **y** `id_suscripcion` a nulo —ambos son identificadores reidentificables— y se llenan `seudonimo` y `fecha_eliminacion_cuenta`. Desde ese momento el filtro de la sección 5.4 opera sobre `seudonimo`. Purga a los 12 meses por esa fecha |'
assert a in s
s = s.replace(a, b)

# 3. PLAN_CONTRATADO tenia FK dura y ninguna columna de purga: los 6 anios eran imposibles.
a = '| `PLAN_CONTRATADO` | Comprobantes disociados; se conservan por obligación tributaria |'
b = '''| `PLAN_CONTRATADO`, registro operativo | `id_usuario` **a nulo** a las 72 h. No hay clave foránea dura a `USUARIO`: con cascada se destruiría la evidencia tributaria, y con clave foránea viva no se podría eliminar la cuenta |
| `PLAN_CONTRATADO`, comprobante | **Sobrevive disociado** por `seudonimo_titular`. `fecha_eliminacion_cuenta` marca desde cuándo se cuentan los 6 años y `purga_en` fija la eliminación definitiva |'''
assert a in s
s = s.replace(a, b)

a = '**Nunca almacena datos de tarjeta**: solo `referencia_pasarela`, el identificador que devuelve el proveedor de pago. Los comprobantes sobreviven disociados 6 años a la eliminación de la cuenta, mediante `seudonimo_titular` como en `CONSENTIMIENTO`.'
b = '''**Nunca almacena datos de tarjeta**: solo `referencia_pasarela`, el identificador que devuelve el proveedor de pago.

Como `CONSENTIMIENTO`, **no lleva clave foránea dura a `USUARIO`**: `id_usuario` admite nulo y se vacía al eliminar la cuenta, momento en que `seudonimo_titular` toma su lugar. `fecha_eliminacion_cuenta` y `purga_en` son las columnas sobre las cuales se ejecuta la purga: sin ellas, el plazo de conservación no tendría desde cuándo contarse.'''
assert a in s
s = s.replace(a, b)

io.open(R, 'w', encoding='utf-8').write(s)
print('md: ok')
