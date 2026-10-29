"""Lo que el publicador y los consumidores tienen que decir IGUAL.

Un solo archivo con el nombre del exchange y la regla de la routing key,
porque son las dos cosas que, escritas dos veces, se desincronizan sin que
nada avise.

Ya pasó: `topologia.py` enlazaba la cola a `suscripcion.creada` mientras el
publicador mandaba a `suscripcion.creada.v2`. En un exchange topic ese enlace
exacto no coincide con esa clave, así que la publicación fallaba por no
enrutable y el resumen no llegaba nunca. La prueba no lo vio porque comparaba
la constante de `topologia` contra el propio `topologia`.

Está aparte de `publicador.py` para que `topologia.py` pueda usarlo sin que se
arme un ciclo de imports entre los dos.
"""

EXCHANGE = "suscripciones"


def routing_key(evento) -> str:
    """La clave de ruteo de un evento. ES PARTE DEL CONTRATO (MX-21).

    Recibe cualquier cosa con `.evento` y `.version`: una fila de
    `OutboxEvento` al publicar, o el objeto mínimo que arma `topologia` para
    preguntar cuál es la clave sin tener que crear una fila.
    """
    return f"{evento.evento}.v{evento.version}"
