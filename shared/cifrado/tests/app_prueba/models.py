"""Modelo de prueba: existe solo para ejercitar CampoCifrado contra una base real."""

from django.db import models

from shared.cifrado import CampoCifrado


class CuentaDePrueba(models.Model):
    nombre = models.CharField(max_length=50)
    token = CampoCifrado(null=True, blank=True)
    otro_secreto = CampoCifrado(null=True, blank=True)

    class Meta:
        app_label = "app_prueba"
