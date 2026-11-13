# S3-FE-08 — Recibo pagado, aviso de cobro futuro o pago fallido

**Qué hace.** Decide qué clase de correo es, con la evidencia del propio
mensaje, y cuando no está seguro **lo dice**. No guarda nada.

| Criterio de la tarjeta | Dónde se cumple |
|---|---|
| Un aviso futuro o un fallo no se registra como pago realizado | ante la duda entre «se cobró» y otra cosa, el resultado es incierto, nunca «se cobró» |
| Los casos inciertos quedan para revisión | `tipo=None` con un motivo y la evidencia encontrada |

Los tipos son los del contrato de candidatos (`TipoMensaje`, S3-FE-01):
`cobro_realizado`, `aviso_de_cobro` y `pago_fallido`.

## La evidencia

Frases en español y en inglés, comparadas como **palabras enteras** sobre el
texto sin tildes y en minúsculas. «recibo» no calza dentro de «recibirás» ni
de «recibos».

| Clase | Ejemplos |
|---|---|
| pago fallido | «pago rechazado», «fue rechazado», «no pudimos procesar», «payment failed», «card was declined» |
| cobro que todavía no ocurre | «se cobrará», «te cobraremos», «recordatorio de pago», «will be charged», «upcoming payment», «your trial ends» |
| mención del próximo ciclo | «próximo cobro», «se renovará», «next billing date», «renews on» |
| cobro realizado | «recibo», «hemos recibido tu pago», «gracias por tu pago», «receipt», «payment received», «was charged» |

La **mención del próximo ciclo** no es un tipo: es lo que trae casi todo recibo
al pie («tu próximo cobro será el 1 de noviembre»). Junto a un cobro
realizado no lo contradice; sola, sí es un aviso. En cambio, un **cobro que
todavía no ocurre** («se cobrará el 5») junto a un «recibo» deja el correo
incierto.

## Las reglas

1. **El asunto primero**, porque es lo que el remitente eligió para decir de
   qué se trata. Si decide un tipo, manda. La excepción es cuando el asunto
   dice que se cobró y el cuerpo dice que el pago falló o que el cobro
   todavía no ocurre: entonces queda incierto.
2. **Si el asunto no decide**, deciden asunto y cuerpo juntos:
   - cobro realizado + fallo, o + cobro futuro → **incierto**;
   - cobro realizado (con o sin mención del próximo ciclo) → cobro realizado;
   - fallo (con o sin nuevo intento) → pago fallido;
   - cobro futuro o mención del próximo ciclo → aviso;
   - nada → incierto.

| Asunto | Cuerpo | Resultado |
|---|---|---|
| Tu recibo de Netflix | … tu próximo cobro será el 1 de noviembre | cobro realizado |
| Tu recibo estará disponible pronto | Se cobrará CLP 9.990 el 1 de noviembre | **incierto** |
| Tu suscripción se renovará pronto | Te enviaremos el recibo cuando se cobre | aviso |
| Problema con tu pago | … tu próximo cobro será el 5 | pago fallido |
| Netflix | Tu pago anterior fue rechazado. Hemos recibido tu pago | **incierto** |
| Ofertas de la semana | Descuentos en tecnología | **incierto** |

La quinta fila salió de la primera corrida contra correos de ejemplo:
«fue rechazado» no contaba como fallo y el correo salía como cobro realizado.
Se agregó antes de escribir las pruebas. Quedar incierto es lo prudente: el
cobro pudo haberse hecho, pero no se afirma sin que alguien lo mire.

## Dónde está

| Pieza | Archivo |
|---|---|
| El clasificador | `services/connectors/connectors/tipo_de_aviso.py` |
| Las pruebas | `services/connectors/tests/test_tipo_de_aviso_s3_fe_08.py` (32) |

## Cómo se comprobaron las pruebas

Se rompió el código a propósito 13 veces y cada vez falló al menos una
prueba. Entre otras:

- tomar cobro + fallo o cobro + aviso como cobro;
- dejar que la mención del próximo ciclo contradiga al recibo;
- que el fallo pierda contra el aviso;
- que la mención sola no sea aviso;
- tomar como cobro un correo sin evidencia;
- que el asunto «recibo» ignore el cuerpo;
- que el asunto no mande;
- comparar sin borde de palabra, con tildes o con mayúsculas.

Al principio dos no fallaban: faltaba el recibo cuyo asunto no decide y el
boletín que habla de «recibos» en general.
