"""Doble del directorio de auth para las pruebas (S3-FE-21).

Reemplaza `notifications.directorio.destinatarios`, que en producción hace
`GET /internal/organizaciones/<org>/destinatarios/` a auth. Devuelve lo mismo
que esa vista: `{usuario_id: email}` de las personas activas de la
organización. La forma está atada a la vista real por
`services/auth/tests/test_directorio_s3_fe_21.py::test_la_respuesta_tiene_la_forma_del_contrato`
y por `tests/test_directorio_s3_fe_21.py` de este servicio, que prueba el
cliente HTTP con la respuesta que da auth.

── Quiénes son miembros ─────────────────────────────────────────────────
- los que se agregan con `agregar(org, usuario, email)`;
- y, mientras `con_preferencias_como_miembros` esté encendido (lo normal),
  cualquiera con fila de `PreferenciaNotificacion` en esa organización, con
  el correo `<usuario>@miembro.test`. En producción tener preferencias
  implica ser miembro: así las pruebas que solo crean preferencias siguen
  probando lo suyo sin tener que repetir la membresía en cada una.

`quitar(org, usuario)` lo saca de las dos fuentes: es «dejó la organización».
`caido = True` simula que auth no responde.
"""

from __future__ import annotations

from notifications.directorio import DirectorioNoDisponible


class DirectorioFalso:
    def __init__(self):
        self.reiniciar()

    def reiniciar(self):
        self.explicitos: dict[tuple[str, str], str] = {}
        self.quitados: set[tuple[str, str]] = set()
        self.con_preferencias_como_miembros = True
        self.caido = False
        self.consultas: list[str] = []

    def agregar(self, organizacion_id, usuario_id, email):
        clave = (str(organizacion_id), str(usuario_id))
        self.quitados.discard(clave)
        self.explicitos[clave] = email

    def quitar(self, organizacion_id, usuario_id):
        clave = (str(organizacion_id), str(usuario_id))
        self.explicitos.pop(clave, None)
        self.quitados.add(clave)

    def destinatarios(self, organizacion_id) -> dict[str, str]:
        org = str(organizacion_id)
        self.consultas.append(org)
        if self.caido:
            raise DirectorioNoDisponible("sin_conexion", "ConnectionError")
        resultado = {}
        if self.con_preferencias_como_miembros:
            from notifications.models import PreferenciaNotificacion

            for usuario in PreferenciaNotificacion.objects.filter(organizacion_id=org).values_list(
                "usuario_id", flat=True
            ):
                resultado[usuario] = f"{usuario}@miembro.test"
        for (o, usuario), email in self.explicitos.items():
            if o == org:
                resultado[usuario] = email
        for o, usuario in self.quitados:
            if o == org:
                resultado.pop(usuario, None)
        return resultado


DIRECTORIO = DirectorioFalso()
