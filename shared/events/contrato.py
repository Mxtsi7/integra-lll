"""El nombre del exchange y la regla de la routing key. UNA sola vez.

Son las dos cosas del transporte que, escritas en cada servicio, se
desincronizan sin que nada avise. Ya pasó una vez dentro de Subscriptions:
`topologia.py` enlazaba la cola a `suscripcion.creada` mientras el publicador
mandaba a `suscripcion.creada.v2`. En un exchange topic ese enlace exacto no
coincide con esa clave, así que la publicación fallaba por no enrutable y el
resumen no llegaba nunca. La prueba no lo vio porque comparaba la constante de
`topologia` contra el propio `topologia`.

Con dos servicios hablando (Subscriptions publica, Notifications consume) el
mismo error vuelve a estar disponible, y esta vez en silencio del otro lado de
una frontera de servicio: un consumidor enlazado a una clave que nadie usa no
falla, simplemente no recibe nada nunca.

Vive en `shared/` por eso, al lado del [catálogo](catalogo.md) y del
[esquema](mx21-v2.schema.json), que ya son compartidos por la misma razón.
`shared/` NO es una excepción a ADR-002: lo que se comparte es el contrato,
no la base. Cada servicio sigue con su esquema y nadie consulta el del otro.
"""

#: El exchange de todo el catálogo. El nombre es histórico —también transporta
#: alertas, no solo suscripciones— y MX-21 decidió conservarlo para no abrir
#: un segundo exchange y migrar bindings ajenos.
EXCHANGE = "suscripciones"


def routing_key(evento) -> str:
    """La clave de ruteo de un evento. ES PARTE DEL CONTRATO (MX-21).

    Recibe cualquier cosa con `.evento` y `.version`: una fila de outbox al
    publicar, o el objeto mínimo que arma una topología para preguntar cuál es
    la clave sin tener que crear una fila.

    La versión va en la clave a propósito. Un enlace a la versión EXACTA
    (`...v2`) y no a `suscripcion.creada.*` significa que una v3 —que por
    definición del catálogo rompe el esquema— no llega a un consumidor escrito
    para v2. Consumirla en silencio sería peor que no recibirla.
    """
    return f"{evento.evento}.v{evento.version}"
