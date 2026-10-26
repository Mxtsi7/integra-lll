from django.core.exceptions import ValidationError
from django.db import models

from shared.tenant.base import ModeloBase


class OpcionesQuerySet(models.QuerySet):
    def delete(self):
        raise ValidationError("Los catálogos se desactivan; no se eliminan.")

    def update(self, **kwargs):
        if "codigo" in kwargs:
            raise ValidationError({"codigo": "El código del catálogo es inmutable."})
        return super().update(**kwargs)


class OpcionCatalogo(ModeloBase):
    codigo = models.CharField(max_length=20, unique=True)
    nombre = models.CharField(max_length=150)
    activo = models.BooleanField(default=True)
    orden = models.PositiveIntegerField(default=0)
    objects = OpcionesQuerySet.as_manager()

    class Meta:
        abstract = True
        ordering = ["orden", "nombre", "codigo"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            anterior = type(self).objects.using(kwargs.get("using") or self._state.db).get(pk=self.pk)
            if anterior.codigo != self.codigo:
                raise ValidationError({"codigo": "El código es inmutable; cambia el nombre o desactiva la opción."})
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Los catálogos se desactivan; no se eliminan.")

    def __str__(self):
        return self.nombre


def validar_asignacion(modelo, codigo, anterior=None, using=None):
    opcion = modelo.objects.using(using).filter(codigo=codigo).first()
    if opcion is None or (not opcion.activo and codigo != anterior):
        raise ValidationError("Selecciona una opción activa del catálogo.")


class ReferenciasCatalogo:
    """Valida también escrituras por ORM/comandos, no solo por serializers.

    Las actualizaciones masivas y SQL directo deben pasar por una herramienta
    controlada; como en el plan, no se agregan FK en esta primera entrega.
    """

    def catalogos(self):
        raise NotImplementedError

    def save(self, *args, **kwargs):
        using = kwargs.get("using") or self._state.db
        campos = self.catalogos()
        if kwargs.get("update_fields") is not None:
            campos = {k: v for k, v in campos.items() if k in kwargs["update_fields"]}
        anterior = None
        if campos and not self._state.adding:
            anterior = type(self).objects.using(using).filter(pk=self.pk).values(*campos).first()
        errores = {}
        for campo, modelo in campos.items():
            codigo = getattr(self, campo)
            try:
                validar_asignacion(modelo, codigo, anterior.get(campo) if anterior else None, using)
            except ValidationError as error:
                errores[campo] = error.messages
        if errores:
            raise ValidationError(errores)
        return super().save(*args, **kwargs)
