"""MX-30 / RF-01.1: política de contraseña centralizada.

Matriz compartida para registro, reset-confirm y cambio: los tres aplican
exactamente la misma política con el mismo mensaje.

Estado de los flujos (ver docstrings en app/serializers.py):
- Registro: integrado (POST /api/auth/register/).
- Reset (recuperación) y cambio: preparados para integración futura
  (serializers reutilizables, sin vista ni ruta todavía).
"""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient
from unittest import mock

from app.serializers import (
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    RegisterSerializer,
    UserSerializer,
)
from app.validators import (
    LONGITUD_MINIMA_CONTRASENA,
    MENSAJE_POLITICA_CONTRASENA,
    ValidadorPoliticaContrasena,
    validador_contrasena,
)

MENSAJE_CLAVE_ACTUAL = "La contraseña actual no es correcta."

CLAVE_INICIAL = "ClaveInicial1"
CLAVE_NUEVA_VALIDA = "NuevaClave99"

VALIDAS = [
    "Abcdef12",  # exactamente 8, letra + número
    "a1b2c3d4",  # minúsculas + números
    "ABCD1234",  # mayúsculas + números
    "ClaveSegura123",
    "P@ssw0rd!",  # especiales permitidos con letra + número
    "  Ab12345  ",  # espacios iniciales/finales (se preservan)
    " Abc123 ",  # exactamente 8 con espacios en los bordes
    "contraseña1A",  # unicode + letra y número ASCII
]

SIN_LETRA = [
    "12345678",
    "123456789012",
    "!!!!!!!!",  # solo especiales
    "        ",  # solo espacios (8)
    "ñáéíóúüñ",  # solo letras no ASCII, ninguna [A-Za-z]
    "ñáéíóúü1",  # número ASCII pero ninguna letra [A-Za-z]
]

SIN_NUMERO = [
    "abcdefgh",
    "ABCDEFGH",
    "Password",
    "sololetras",
    "!@#$%^&*",  # solo especiales
    "Abcdefg١",  # letras ASCII pero ningún número [0-9]
]

CORTAS = [
    "Abc1234",  # 7, con letra y número pero bajo el mínimo
    "A1b2C3d",  # 7
    "a1b2c3",  # 6
    "a1",  # 2
]

DIGITOS_NO_ASCII = [
    "١٢٣٤٥٦٧٨",  # 8 dígitos arábigos, ningún [0-9]
]

INVALIDAS_COMPOSICION = SIN_LETRA + SIN_NUMERO + CORTAS + DIGITOS_NO_ASCII


class TestValidadorUnitario:
    @pytest.mark.parametrize("pwd", VALIDAS)
    def test_acepta_validas(self, pwd):
        validador_contrasena(pwd)  # no debe levantar

    @pytest.mark.parametrize("pwd", INVALIDAS_COMPOSICION)
    def test_rechaza_composicion_con_mensaje_unico(self, pwd):
        with pytest.raises(DjangoValidationError) as exc:
            validador_contrasena(pwd)
        assert MENSAJE_POLITICA_CONTRASENA in exc.value.messages

    @pytest.mark.parametrize("valor", [None, 12345678, b"Abcdef12"])
    def test_rechaza_no_string(self, valor):
        with pytest.raises(DjangoValidationError) as exc:
            validador_contrasena(valor)
        assert MENSAJE_POLITICA_CONTRASENA in exc.value.messages

    def test_mensaje_y_longitud_congelados(self):
        assert LONGITUD_MINIMA_CONTRASENA == 8
        assert (
            MENSAJE_POLITICA_CONTRASENA
            == "La contraseña debe tener al menos 8 caracteres, una letra y un número."
        )

    def test_interfaz_auth_password_validators(self):
        v = ValidadorPoliticaContrasena()
        v.validate("Abcdef12")  # ok
        with pytest.raises(DjangoValidationError):
            v.validate("solo-letras")
        assert v.get_help_text() == MENSAJE_POLITICA_CONTRASENA
        validate_password("Abcdef12")  # vía settings.AUTH_PASSWORD_VALIDATORS
        with pytest.raises(DjangoValidationError):
            validate_password("solo-letras")

    def test_igualdad_para_migraciones(self):
        assert ValidadorPoliticaContrasena() == ValidadorPoliticaContrasena()
        assert ValidadorPoliticaContrasena() != "otra-cosa"


class TestCamposCompartidos:
    """Contrato del campo, sin base de datos."""

    def test_write_only_y_estilo_password(self):
        for campo in (
            UserSerializer().fields["password"],
            RegisterSerializer().fields["password"],
            PasswordResetConfirmSerializer().fields["new_password"],
            PasswordChangeSerializer().fields["new_password"],
        ):
            assert campo.write_only is True
            assert campo.style == {"input_type": "password"}

    def test_los_cuatro_campos_usan_la_misma_instancia(self):
        for campo in (
            UserSerializer().fields["password"],
            RegisterSerializer().fields["password"],
            PasswordResetConfirmSerializer().fields["new_password"],
            PasswordChangeSerializer().fields["new_password"],
        ):
            assert validador_contrasena in campo.validators

    def test_login_no_aplica_la_politica(self):
        # El login solo autentica (TC-02): una clave débil pasa el formato.
        s = LoginSerializer(data={"email": "a@t.cl", "password": "debil"})
        assert s.is_valid(), s.errors

    def test_formulario_con_strip_false_preserva_espacios(self):
        # " Abc123 " tiene exactamente 8 caracteres: debe aceptarse y
        # conservar los espacios, igual que en los serializers DRF.
        from django import forms

        class ClaveForm(forms.Form):
            password = forms.CharField(
                strip=False,
                widget=forms.PasswordInput,
                validators=[validador_contrasena],
            )

        form = ClaveForm(data={"password": " Abc123 "})
        assert form.is_valid(), form.errors
        assert form.cleaned_data["password"] == " Abc123 "

        s = PasswordResetConfirmSerializer(data={"new_password": " Abc123 "})
        assert s.is_valid(), s.errors
        assert s.validated_data["new_password"] == " Abc123 "

    def test_formulario_por_defecto_recorta_y_rechaza(self):
        # Sin strip=False el formulario recorta a "Abc123" (7) antes de
        # validar: por eso el ejemplo documentado lo exige.
        from django import forms

        class ClaveFormEstricto(forms.Form):
            password = forms.CharField(validators=[validador_contrasena])

        form = ClaveFormEstricto(data={"password": " Abc123 "})
        assert not form.is_valid()
        assert form.errors["password"] == [MENSAJE_POLITICA_CONTRASENA]


class TestCambioRechazaParcial:
    """Regresión: partial=True no puede omitir ningún campo (sin BD)."""

    def test_partial_sin_old_password_se_rechaza(self):
        s = PasswordChangeSerializer(
            _usuario_en_memoria(),
            data={"new_password": CLAVE_NUEVA_VALIDA},
            partial=True,
        )
        assert not s.is_valid()
        # Mismo mensaje y código que con campo omitido sin partial.
        assert s.errors["old_password"] == ["Este campo es requerido."]
        assert s.errors["old_password"][0].code == "required"

    def test_partial_sin_new_password_se_rechaza(self):
        s = PasswordChangeSerializer(
            _usuario_en_memoria(),
            data={"old_password": CLAVE_INICIAL},
            partial=True,
        )
        assert not s.is_valid()
        assert s.errors["new_password"] == [MENSAJE_POLITICA_CONTRASENA]

    def test_partial_sin_ambos_se_rechaza(self):
        s = PasswordChangeSerializer(
            _usuario_en_memoria(),
            data={},
            partial=True,
        )
        assert not s.is_valid()
        assert s.errors["old_password"] == ["Este campo es requerido."]
        assert s.errors["new_password"] == [MENSAJE_POLITICA_CONTRASENA]

    def test_partial_con_ambos_campos_es_valido(self):
        s = PasswordChangeSerializer(
            _usuario_en_memoria(),
            data={"old_password": CLAVE_INICIAL, "new_password": CLAVE_NUEVA_VALIDA},
            partial=True,
        )
        assert s.is_valid(), s.errors


class TestContratoSave:
    """save() heredado de DRF en ambos serializers (sin BD).

    Con spies se comprueba que ninguna llamada inválida llega a
    set_password()/save(); el save del modelo se mockea porque es el
    único punto que toca la base de datos (set_password/check_password
    son hashing en memoria).
    """

    def _serializers_validos(self):
        return [
            PasswordChangeSerializer(
                _usuario_en_memoria(),
                data={
                    "old_password": CLAVE_INICIAL,
                    "new_password": CLAVE_NUEVA_VALIDA,
                },
            ),
            PasswordResetConfirmSerializer(
                _usuario_en_memoria(),
                data={"new_password": CLAVE_NUEVA_VALIDA},
            ),
        ]

    def test_save_antes_de_validar_falla_sin_efectos(self):
        for s in self._serializers_validos():
            user = s.instance
            with (
                mock.patch.object(user, "set_password") as sp_set,
                mock.patch.object(user, "save") as sp_save,
            ):
                with pytest.raises(AssertionError, match="is_valid"):
                    s.save()
                sp_set.assert_not_called()
                sp_save.assert_not_called()

    def test_save_despues_de_fallo_rechaza_sin_efectos(self):
        casos = [
            PasswordChangeSerializer(
                _usuario_en_memoria(),
                data={
                    "old_password": "OtraClave99",
                    "new_password": CLAVE_NUEVA_VALIDA,
                },
            ),
            PasswordChangeSerializer(
                _usuario_en_memoria(),
                data={"old_password": CLAVE_INICIAL, "new_password": "solo-letras"},
            ),
            PasswordResetConfirmSerializer(
                _usuario_en_memoria(),
                data={"new_password": "solo-letras"},
            ),
        ]
        for s in casos:
            assert not s.is_valid()
            user = s.instance
            with (
                mock.patch.object(user, "set_password") as sp_set,
                mock.patch.object(user, "save") as sp_save,
            ):
                with pytest.raises(AssertionError, match="invalid data"):
                    s.save()
                sp_set.assert_not_called()
                sp_save.assert_not_called()

    @pytest.mark.parametrize("nueva", [CLAVE_NUEVA_VALIDA, "  Ab12345  "])
    def test_operacion_valida_devuelve_usuario_instancia_y_hash(self, nueva):
        for s in (
            PasswordChangeSerializer(
                _usuario_en_memoria(),
                data={"old_password": CLAVE_INICIAL, "new_password": nueva},
            ),
            PasswordResetConfirmSerializer(
                _usuario_en_memoria(),
                data={"new_password": nueva},
            ),
        ):
            assert s.is_valid(), s.errors
            user = s.instance
            with (
                mock.patch.object(
                    user, "set_password", wraps=user.set_password
                ) as sp_set,
                mock.patch.object(user, "save") as sp_save,
            ):
                devuelto = s.save()
            assert devuelto is user
            assert s.instance is user
            sp_set.assert_called_once_with(nueva)
            sp_save.assert_called_once_with(update_fields=["password"])
            assert user.check_password(nueva)
            if nueva != nueva.strip():
                assert not user.check_password(nueva.strip())

    def test_cambio_sin_instance_no_verifica_la_actual(self):
        s = PasswordChangeSerializer(
            data={"old_password": "cualquiera", "new_password": CLAVE_NUEVA_VALIDA}
        )
        assert not s.is_valid()
        assert s.errors["old_password"] == [MENSAJE_CLAVE_ACTUAL]

    def test_reset_sin_instance_no_soporta_creacion(self):
        # Sin usuario no hay nada que actualizar: el save() heredado cae
        # en create(), que este serializer no implementa (señal estándar).
        s = PasswordResetConfirmSerializer(data={"new_password": CLAVE_NUEVA_VALIDA})
        assert s.is_valid(), s.errors
        with pytest.raises(NotImplementedError):
            s.save()


def _usuario_en_memoria(password=CLAVE_INICIAL):
    """Usuario sin persistir: basta para validar (check_password no usa BD)."""
    User = get_user_model()
    user = User(email="cambio@t.cl", nombre="C")
    user.set_password(password)
    return user


def _fabricas(pwd):
    """Los 4 serializers frente a la misma contraseña. Cambio con contexto."""
    return [
        (
            "registro",
            RegisterSerializer(
                data={
                    "email": "a@t.cl",
                    "nombre": "A",
                    "password": pwd,
                    "acepta_datos": True,
                }
            ),
            "password",
        ),
        (
            "registro-base",
            UserSerializer(data={"email": "a@t.cl", "nombre": "A", "password": pwd}),
            "password",
        ),
        (
            "reset",
            PasswordResetConfirmSerializer(data={"new_password": pwd}),
            "new_password",
        ),
        (
            "cambio",
            PasswordChangeSerializer(
                _usuario_en_memoria(),
                data={"old_password": CLAVE_INICIAL, "new_password": pwd},
            ),
            "new_password",
        ),
    ]


@pytest.mark.django_db
class TestMatrizPolitica:
    @pytest.mark.parametrize("pwd", VALIDAS)
    def test_los_tres_flujos_aceptan_validas(self, pwd):
        for nombre, s, _campo in _fabricas(pwd):
            assert s.is_valid(), f"{nombre} rechazó {pwd!r}: {s.errors}"

    @pytest.mark.parametrize("pwd", INVALIDAS_COMPOSICION)
    def test_los_tres_flujos_rechazan_con_mismo_mensaje(self, pwd):
        for nombre, s, campo in _fabricas(pwd):
            assert not s.is_valid(), f"{nombre} aceptó {pwd!r} y no debía"
            assert s.errors[campo] == [MENSAJE_POLITICA_CONTRASENA], (
                f"{nombre} mensaje inesperado para {pwd!r}: {s.errors}"
            )

    @pytest.mark.parametrize(
        "data,campo",
        [
            ({"email": "a@t.cl", "nombre": "A", "acepta_datos": True}, "password"),
            ({"email": "a@t.cl", "nombre": "A"}, "password"),
            ({}, "new_password"),
        ],
    )
    def test_campo_omitido_se_rechaza_con_mensaje_politica(self, data, campo):
        if campo == "password" and "acepta_datos" in data:
            s = RegisterSerializer(data=data)
        elif campo == "password":
            s = UserSerializer(data=data)
        else:
            s = PasswordResetConfirmSerializer(data=data)
        assert not s.is_valid()
        assert s.errors[campo] == [MENSAJE_POLITICA_CONTRASENA]

    def test_cambio_con_nueva_omitida(self):
        s = PasswordChangeSerializer(
            _usuario_en_memoria(),
            data={"old_password": CLAVE_INICIAL},
        )
        assert not s.is_valid()
        assert s.errors["new_password"] == [MENSAJE_POLITICA_CONTRASENA]

    @pytest.mark.parametrize("pwd", VALIDAS)
    def test_cambio_acepta_nueva_valida(self, pwd):
        s = PasswordChangeSerializer(
            _usuario_en_memoria(),
            data={"old_password": CLAVE_INICIAL, "new_password": pwd},
        )
        assert s.is_valid(), s.errors

    def test_cadena_vacia_se_rechaza_con_mensaje_politica(self):
        for _nombre, s, campo in _fabricas(""):
            assert not s.is_valid()
            assert s.errors[campo] == [MENSAJE_POLITICA_CONTRASENA]

    def test_null_se_rechaza_en_el_campo(self):
        for _nombre, s, campo in _fabricas(None):
            assert not s.is_valid()
            assert campo in s.errors


@pytest.mark.django_db
class TestPasswordChangeSerializer:
    def _usuario(self, password=CLAVE_INICIAL):
        return get_user_model().objects.create_user(
            email="cambio@t.cl", nombre="C", password=password
        )

    def test_cambio_valido_guarda_hash_exact(self):
        user = self._usuario()
        s = PasswordChangeSerializer(
            user,
            data={"old_password": CLAVE_INICIAL, "new_password": CLAVE_NUEVA_VALIDA},
        )
        assert s.is_valid(), s.errors
        devuelto = s.save()
        assert devuelto is user
        assert s.instance is user
        user.refresh_from_db()
        assert user.password != CLAVE_NUEVA_VALIDA
        assert user.check_password(CLAVE_NUEVA_VALIDA)
        assert not user.check_password(CLAVE_INICIAL)

    def test_clave_actual_incorrecta_no_modifica_hash(self):
        user = self._usuario()
        hash_previo = user.password
        s = PasswordChangeSerializer(
            user,
            data={"old_password": "OtraClave99", "new_password": CLAVE_NUEVA_VALIDA},
        )
        assert not s.is_valid()
        assert s.errors["old_password"] == [MENSAJE_CLAVE_ACTUAL]
        # Error de autenticación, no de composición: mensaje distinto a propósito.
        assert MENSAJE_CLAVE_ACTUAL != MENSAJE_POLITICA_CONTRASENA
        user.refresh_from_db()
        assert user.password == hash_previo
        assert user.check_password(CLAVE_INICIAL)

    def test_nueva_invalida_no_modifica_hash(self):
        user = self._usuario()
        hash_previo = user.password
        s = PasswordChangeSerializer(
            user,
            data={"old_password": CLAVE_INICIAL, "new_password": "solo-letras"},
        )
        assert not s.is_valid()
        assert s.errors["new_password"] == [MENSAJE_POLITICA_CONTRASENA]
        user.refresh_from_db()
        assert user.password == hash_previo
        assert user.check_password(CLAVE_INICIAL)

    def test_partial_sin_old_no_modifica_hash_ni_guarda(self):
        user = self._usuario()
        hash_previo = user.password
        s = PasswordChangeSerializer(
            user,
            data={"new_password": CLAVE_NUEVA_VALIDA},
            partial=True,
        )
        assert not s.is_valid()
        assert "old_password" in s.errors
        with pytest.raises(AssertionError):
            s.save()
        user.refresh_from_db()
        assert user.password == hash_previo
        assert user.check_password(CLAVE_INICIAL)


@pytest.mark.django_db
class TestPasswordResetConfirmSerializer:
    def _usuario(self, password="ViejaClave11"):
        return get_user_model().objects.create_user(
            email="reset@t.cl", nombre="R", password=password
        )

    def test_reset_valido_guarda_hash_exact_y_preserva_espacios(self):
        user = self._usuario()
        nueva = "  Ab12345  "
        s = PasswordResetConfirmSerializer(user, data={"new_password": nueva})
        assert s.is_valid(), s.errors
        devuelto = s.save()
        assert devuelto is user
        assert s.instance is user
        user.refresh_from_db()
        assert user.password != nueva
        assert user.check_password(nueva)
        assert not user.check_password(nueva.strip())
        assert not user.check_password("ViejaClave11")

    def test_reset_debil_no_modifica_hash(self):
        user = self._usuario()
        hash_previo = user.password
        s = PasswordResetConfirmSerializer(user, data={"new_password": "solo-letras"})
        assert not s.is_valid()
        assert s.errors["new_password"] == [MENSAJE_POLITICA_CONTRASENA]
        user.refresh_from_db()
        assert user.password == hash_previo
        assert user.check_password("ViejaClave11")


@pytest.mark.django_db
class TestRegistroIntegracion:
    def setup_method(self):
        self.client = APIClient()
        self.url = reverse("register")
        self.base = {"email": "ana@t.cl", "nombre": "Ana", "acepta_datos": True}

    @pytest.mark.parametrize("pwd", INVALIDAS_COMPOSICION)
    def test_registro_rechaza_clave_debil(self, pwd):
        resp = self.client.post(self.url, {**self.base, "password": pwd}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["password"] == [MENSAJE_POLITICA_CONTRASENA]
        assert not get_user_model().objects.filter(email="ana@t.cl").exists()

    def test_registro_sin_password_rechaza_con_mensaje_politica(self):
        resp = self.client.post(self.url, self.base, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["password"] == [MENSAJE_POLITICA_CONTRASENA]

    def test_registro_password_vacia_rechaza_con_mensaje_politica(self):
        resp = self.client.post(
            self.url, {**self.base, "password": ""}, format="json"
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert resp.data["password"] == [MENSAJE_POLITICA_CONTRASENA]

    def test_registro_password_null_se_rechaza_en_el_campo(self):
        resp = self.client.post(
            self.url, {**self.base, "password": None}, format="json"
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "password" in resp.data
        assert not get_user_model().objects.filter(email="ana@t.cl").exists()

    def test_registro_valido_no_expone_password_ni_hash(self):
        resp = self.client.post(
            self.url, {**self.base, "password": "ClaveSegura123"}, format="json"
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert set(resp.data.keys()) == {"id", "email", "nombre"}
        user = get_user_model().objects.get(email="ana@t.cl")
        assert user.password != "ClaveSegura123"
        assert user.check_password("ClaveSegura123")
        assert user.password.startswith("pbkdf2_sha256$")
