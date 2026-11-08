"""
FE-12 — normalizar nombres de proveedores.

Los criterios de la tarjeta:
- variantes conocidas mapean al mismo proveedor
- un nombre ambiguo queda para revisión sin asignación inventada
- se conserva el texto original (trazabilidad mínima)

Y lo que hace que sirva de verdad a FE-09/FE-13: es una función pura, sin
base ni red, y el catálogo no se contradice a sí mismo.
"""

import pytest

from connectors import normalizacion as n
from connectors.normalizacion import (
    AMBIGUO,
    AMBIGUOS,
    DESCONOCIDO,
    PROVEEDORES,
    RECONOCIDO,
    limpiar,
    normalizar,
)


# ══════════════════════════════════════════════════════════════════════
# Variantes conocidas → el mismo proveedor
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("texto", [
    "Netflix",
    "NETFLIX",
    "netflix",
    "NETFLIX.COM",
    "NETFLIX.COM 1234 SANTIAGO CL",
    "  Netflix  ",
    "PAYPAL *NETFLIX",
    "PP*NETFLIX",
    "DLOCAL *NETFLIX INTERNACIONAL",
    "Compra Netflix.com Chile",
    "NETFLIX PREMIUM 28-10",
    "Netflix, Inc.",
])
def test_todas_las_variantes_de_netflix_son_netflix(texto):
    r = normalizar(texto)
    assert r.resultado == RECONOCIDO, (texto, r)
    assert r.proveedor == "Netflix"
    assert r.categoria == "streaming"


@pytest.mark.parametrize("texto, esperado", [
    ("Spotify AB", "Spotify"),
    ("PAYPAL *SPOTIFY P1A2B3", "Spotify"),
    ("Disney+", "Disney+"),
    ("DISNEY PLUS", "Disney+"),
    ("DisneyPlus", "Disney+"),
    ("HBO MAX", "HBO Max"),
    ("Amazon Prime Video", "Amazon Prime Video"),
    ("AMAZON PRIME", "Amazon Prime Video"),
    ("Prime Video*2X3Y4Z", "Amazon Prime Video"),
    ("Paramount+", "Paramount+"),
    ("YouTube Premium", "YouTube Premium"),
    ("GOOGLE *YouTube", "YouTube Premium"),
    ("Apple Music", "Apple Music"),
    ("APPLE.COM/BILL ICLOUD", "iCloud"),
    ("iCloud+", "iCloud"),
    ("Microsoft 365", "Microsoft 365"),
    ("MSFT *365", "Microsoft 365"),
    ("Office 365", "Microsoft 365"),
    ("ADOBE *CREATIVE CLOUD", "Adobe Creative Cloud"),
    ("Canva Pty Ltd", "Canva"),
    ("OPENAI *CHATGPT SUBSCR", "ChatGPT"),
    ("Xbox Game Pass Ultimate", "Xbox Game Pass"),
    ("Duolingo Super", "Duolingo"),
    ("Cargo recurrente Spotify", "Spotify"),
])
def test_las_variantes_conocidas_mapean_al_canonico(texto, esperado):
    r = normalizar(texto)
    assert r.resultado == RECONOCIDO, (texto, r)
    assert r.proveedor == esperado


def test_la_misma_variante_da_siempre_lo_mismo():
    """Función pura: dos llamadas, un resultado. Es lo que permite
    deduplicar en FE-09 sin guardar estado."""
    assert normalizar("PAYPAL *SPOTIFY AB") == normalizar("PAYPAL *SPOTIFY AB")


def test_el_alias_mas_largo_gana():
    """'amazon prime video' tiene que decidir antes de que 'amazon' (ambiguo)
    alcance a opinar. Si el orden fuera por catálogo, esto sería ambiguo."""
    r = normalizar("AMAZON PRIME VIDEO")
    assert r.resultado == RECONOCIDO and r.proveedor == "Amazon Prime Video"


def test_un_alias_no_calza_a_medias():
    """'netflix' no es 'netflixx', ni 'hbo' es 'hbomaxx'."""
    assert normalizar("netflixx").resultado == DESCONOCIDO
    assert normalizar("spotifyyy").resultado == DESCONOCIDO


# ══════════════════════════════════════════════════════════════════════
# Ambiguos: candidatos, sin asignación inventada
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("texto", [
    "APPLE.COM/BILL",
    "Apple",
    "APPLE.COM/BILL 866-712-7753",
    "iTunes",
    "AMAZON",
    "Amazon.com",
    "GOOGLE *",
    "Google Play",
    "MICROSOFT",
])
def test_un_nombre_ambiguo_queda_para_revision(texto):
    r = normalizar(texto)
    assert r.resultado == AMBIGUO, (texto, r)
    assert r.proveedor is None, "asignó un proveedor que no puede saber"
    assert r.categoria is None
    assert len(r.candidatos) >= 2
    assert r.para_revision


def test_los_candidatos_del_ambiguo_son_los_del_catalogo():
    r = normalizar("APPLE.COM/BILL")
    assert set(r.candidatos) == {"Apple Music", "Apple TV+", "iCloud"}


def test_un_ambiguo_con_detalle_SI_se_resuelve():
    """'apple' solo es ambiguo; 'apple music' no."""
    assert normalizar("APPLE.COM/BILL APPLE MUSIC").proveedor == "Apple Music"
    assert normalizar("GOOGLE *Google One").proveedor == "Google One"
    assert normalizar("MICROSOFT*XBOX GAME PASS").proveedor == "Xbox Game Pass"


# ══════════════════════════════════════════════════════════════════════
# Desconocidos y trazabilidad
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("texto", [
    "Gimnasio Pacific Fit",
    "TRANSFERENCIA A JUAN PEREZ",
    "",
    "   ",
    "1234567890",
    "PAYPAL *",
    "COMPRA INTERNACIONAL",
])
def test_lo_que_no_calza_es_desconocido_no_un_error(texto):
    r = normalizar(texto)
    assert r.resultado == DESCONOCIDO
    assert r.proveedor is None and r.candidatos == ()
    assert r.para_revision


def test_none_tambien_es_desconocido():
    r = normalizar(None)
    assert r.resultado == DESCONOCIDO and r.original == ""


@pytest.mark.parametrize("texto", [
    "NETFLIX.COM 1234 SANTIAGO CL",
    "APPLE.COM/BILL",
    "Gimnasio Pacific Fit",
    "  Spotify  ",
])
def test_el_original_se_conserva_tal_cual(texto):
    """Trazabilidad mínima: lo que llegó, con sus espacios y mayúsculas."""
    assert normalizar(texto).original == texto


def test_el_resultado_dice_que_regla_decidio():
    assert "alias 'netflix'" in normalizar("NETFLIX.COM").regla
    assert "revision" in normalizar("APPLE.COM/BILL").regla
    assert "ningun alias" in normalizar("Gimnasio Pacific Fit").regla
    assert "sin texto" in normalizar("").regla


# ══════════════════════════════════════════════════════════════════════
# Las reglas de limpieza, una por una
# ══════════════════════════════════════════════════════════════════════


class TestLimpiar:
    def test_minusculas_y_sin_tildes(self):
        assert limpiar("MÚSICA Ñandú") == "musica nandu"

    def test_quita_el_intermediario_como_prefijo(self):
        assert limpiar("PAYPAL *SPOTIFY") == "spotify"
        assert limpiar("PP*NETFLIX") == "netflix"
        assert limpiar("DLOCAL -CANVA") == "canva"
        assert limpiar("MERCADOPAGO*DUOLINGO") == "duolingo"

    def test_el_intermediario_en_medio_no_se_toca(self):
        """Solo como prefijo: 'stripe' puede ser parte de un nombre."""
        assert limpiar("Compra Stripe Atlas") == "stripe atlas"

    def test_un_nombre_que_empieza_igual_que_un_intermediario_no_se_corta(self):
        """'ppal' no es 'pp' + 'al'; 'flowers' no es 'flow' + 'ers'."""
        assert limpiar("ppal") == "ppal"
        assert limpiar("Flowers Chile") == "flowers"

    def test_el_mas_pasa_a_plus(self):
        assert limpiar("Disney+") == "disney plus"
        assert limpiar("Paramount+ Chile") == "paramount plus"

    def test_los_separadores_son_espacios(self):
        assert limpiar("NETFLIX.COM/BILL") == "netflix"
        assert limpiar("hbo_max-latam") == "hbo max latam"

    def test_quita_dominios_formas_juridicas_y_lugares(self):
        assert limpiar("Spotify AB Stockholm") == "spotify stockholm"
        # `pty` se agregó a RUIDO al marcar `canva` como alias débil: sin eso,
        # "Canva Pty Ltd" dejaba de reconocerse porque el texto limpio no
        # quedaba en solo "canva". Es un sufijo societario como `inc` o `ltd`.
        assert limpiar("Canva Pty Ltd Sydney") == "canva sydney"
        assert limpiar("Canva Pty Ltd") == "canva"
        assert limpiar("NETFLIX.COM SANTIAGO CL") == "netflix"

    def test_quita_los_codigos_con_digitos(self):
        assert limpiar("SPOTIFY P1A2B3C4") == "spotify"
        assert limpiar("Netflix 28-10-2026 1234") == "netflix"

    def test_un_numero_corto_es_parte_del_nombre_no_un_codigo(self):
        """'365' se conserva; '1234' (tarjeta), '2026' (fecha) y 'p1a2b3'
        (id de transacción) se quitan."""
        assert limpiar("Microsoft 365") == "microsoft 365"
        assert limpiar("Microsoft 365 1234 2026 p1a2b3") == "microsoft 365"
        assert normalizar("Microsoft 365").proveedor == "Microsoft 365"

    def test_colapsa_espacios(self):
        assert limpiar("  netflix    premium  ") == "netflix premium"


# ══════════════════════════════════════════════════════════════════════
# El catálogo no se contradice
# ══════════════════════════════════════════════════════════════════════


class TestCatalogo:
    def test_los_nombres_canonicos_son_unicos(self):
        nombres = [p.nombre for p in PROVEEDORES]
        assert len(nombres) == len(set(nombres))

    def test_un_alias_no_esta_en_dos_proveedores(self):
        vistos = {}
        for p in PROVEEDORES:
            for a in p.alias:
                assert a not in vistos, f"'{a}' está en {vistos[a]} y en {p.nombre}"
                vistos[a] = p.nombre

    def test_un_alias_no_es_tambien_ambiguo(self):
        alias = {a for p in PROVEEDORES for a in p.alias}
        repetidos = alias & set(AMBIGUOS)
        assert not repetidos, f"ambiguos y alias a la vez: {repetidos}"

    def test_los_alias_ya_estan_limpios(self):
        """Si un alias trae mayúsculas o ruido, nunca calza con nada."""
        for p in PROVEEDORES:
            for a in p.alias:
                assert limpiar(a) == a, f"'{a}' de {p.nombre} no está limpio: {limpiar(a)!r}"
        for a in AMBIGUOS:
            assert limpiar(a) == a, f"ambiguo '{a}' no está limpio"

    def test_cada_candidato_ambiguo_o_esta_en_el_catalogo_o_es_un_generico(self):
        """Los candidatos deben poder resolverse a algo real, salvo los
        genéricos ('Amazon', 'Sony') que existen solo para mostrarlos."""
        canonicos = set(n.nombres_canonicos())
        genericos = {"Amazon", "Sony", "Google Play"}
        for alias, candidatos in AMBIGUOS.items():
            for c in candidatos:
                assert c in canonicos or c in genericos, (alias, c)

    def test_las_categorias_son_codigos_del_catalogo_de_subscriptions(self):
        """Los códigos de `CategoriaSuscripcion` (migración 0007 de subscriptions)."""
        codigos = {
            "streaming", "musica", "productividad", "nube", "juegos",
            "educacion", "salud", "noticias", "ia", "otro",
        }
        for p in PROVEEDORES:
            assert p.categoria in codigos, (p.nombre, p.categoria)

    def test_cada_proveedor_se_reconoce_por_su_propio_nombre(self):
        """El nombre canónico, tal cual, tiene que mapear a sí mismo."""
        for p in PROVEEDORES:
            r = normalizar(p.nombre)
            assert r.proveedor == p.nombre, (p.nombre, r)


# ══════════════════════════════════════════════════════════════════════
# Alias débiles: palabra común o nombre de persona
# (hallazgo de la revisión de #118)
# ══════════════════════════════════════════════════════════════════════


class TestAliasDebiles:
    """Un alias que es palabra común no asigna proveedor por sí solo.

    `_calza` acepta el alias en cualquier posición, así que
    `TRANSFERENCIA A CLAUDE PEREZ` quedaba **reconocido como Claude (ia)**,
    siendo plata a una persona. Lo mismo con `zoom`, `slack`, `notion`,
    `steam`, `valve` y `canva` dentro de comercios o glosas de cartola.

    La prueba que había usaba `TRANSFERENCIA A JUAN PEREZ`, y por eso no lo
    veía: ningún alias calzaba con "juan".
    """

    @pytest.mark.parametrize(
        "texto",
        [
            "TRANSFERENCIA A CLAUDE PEREZ",
            "ZOOM SPA MUEBLES",
            "COMERCIAL SLACK LTDA",
            "VALVULAS VALVE SPA",
            "IMPORTADORA CANVA CHILE",
            "LIBRERIA NOTION SANTIAGO",
            "MAESTRANZA STEAM SPA",
        ],
    )
    def test_un_alias_debil_en_contexto_ajeno_no_asigna(self, texto):
        r = normalizar(texto)
        assert r.resultado == DESCONOCIDO, f"{texto} -> {r.proveedor}"
        assert r.proveedor is None
        assert r.para_revision is True

    @pytest.mark.parametrize(
        "texto, esperado",
        [
            ("NOTION", "Notion"),
            ("CANVA", "Canva"),
            ("ZOOM", "Zoom"),
            ("SLACK", "Slack"),
            ("STEAM", "Steam"),
            ("CLAUDE", "Claude"),
        ],
    )
    def test_un_alias_debil_SOLO_si_reconoce(self, texto, esperado):
        """El control: si viene solo, es la marca."""
        r = normalizar(texto)
        assert r.resultado == RECONOCIDO, texto
        assert r.proveedor == esperado

    @pytest.mark.parametrize(
        "texto, esperado",
        [
            ("CLAUDE.AI SUBSCRIPTION", "Claude"),
            ("ANTHROPIC*CLAUDE", "Claude"),
            ("ZOOM VIDEO COMMUNICATIONS", "Zoom"),
            ("STEAM GAMES", "Steam"),
            ("SLACK TECHNOLOGIES INC", "Slack"),
            ("NOTION LABS", "Notion"),
        ],
    )
    def test_en_contexto_decide_un_alias_mas_largo(self, texto, esperado):
        """Los alias se prueban del más largo al más corto, así que el
        calificador gana antes de que el débil alcance a opinar."""
        r = normalizar(texto)
        assert r.resultado == RECONOCIDO, texto
        assert r.proveedor == esperado

    def test_la_regla_dice_por_que_quedo_sin_asignar(self):
        """FE-09/FE-13 lo muestran: sin motivo nadie sabe qué revisar."""
        r = normalizar("ZOOM SPA MUEBLES")
        assert "debil" in r.regla
        assert "revision" in r.regla

    def test_un_alias_fuerte_en_contexto_SI_asigna(self):
        """La corrección no puede volver inútil el resto del catálogo."""
        for texto in ("COMPRA NETFLIX", "PAYPAL *SPOTIFY", "CRUNCHYROLL CHILE"):
            assert normalizar(texto).resultado == RECONOCIDO, texto


class TestTransferencias:
    """Una transferencia entre personas no asigna proveedor, pase lo que pase.

    Va antes de mirar los alias: si el nombre de la persona coincide con una
    marca, igual es plata a una persona.
    """

    @pytest.mark.parametrize(
        "texto",
        [
            "TRANSFERENCIA A CLAUDE PEREZ",
            "TRANSF CLAUDE",
            "TEF NETFLIX GONZALEZ",
            "TRASPASO A SPOTIFY SOTO",
        ],
    )
    def test_una_transferencia_nunca_asigna(self, texto):
        r = normalizar(texto)
        assert r.resultado == DESCONOCIDO, f"{texto} -> {r.proveedor}"
        assert "transferencia" in r.regla

    def test_sin_marca_de_transferencia_sigue_funcionando(self):
        assert normalizar("NETFLIX").proveedor == "Netflix"


class TestCatalogoDeDebiles:
    """Comprobaciones del catálogo, para que no se desarme al editarlo."""

    def test_todo_alias_debil_esta_declarado_como_alias(self):
        """Un débil que no está en `alias` no se probaría nunca."""
        for p in PROVEEDORES:
            sobran = p.debiles - set(p.alias)
            assert not sobran, f"{p.nombre}: debiles fuera de alias: {sorted(sobran)}"

    def test_ningun_debil_esta_tambien_en_ambiguos(self):
        """Son dos mecanismos distintos: ambiguo devuelve candidatos, débil
        no. Estar en los dos haría que uno tapara al otro."""
        for p in PROVEEDORES:
            choque = p.debiles & set(AMBIGUOS)
            assert not choque, f"{p.nombre}: {sorted(choque)} está en débiles Y en ambiguos"

    def test_los_debiles_son_de_una_sola_palabra(self):
        """Un alias de dos palabras ya trae su propio contexto: marcarlo débil
        lo volvería irreconocible sin razón."""
        for p in PROVEEDORES:
            for d in p.debiles:
                assert " " not in d, f"{p.nombre}: '{d}' tiene espacio, no debería ser débil"

    def test_cada_proveedor_se_reconoce_por_su_propio_nombre(self):
        """La que ya existía: sigue valiendo, porque el nombre canónico
        limpio es todo el texto."""
        for p in PROVEEDORES:
            r = normalizar(p.nombre)
            assert r.resultado in (RECONOCIDO, AMBIGUO), f"{p.nombre} -> {r.resultado}"
