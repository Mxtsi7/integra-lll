"""Política común de RF-01.1 para registro y restablecimiento."""

from rest_framework import serializers


def validar_password(value):
    if len(value) < 8 or not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
        raise serializers.ValidationError(
            "La contraseña debe tener al menos 8 caracteres, una letra y un número."
        )
    return value
