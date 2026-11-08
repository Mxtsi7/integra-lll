"""Prueba real en una BD temporal. Requiere TEST_DATABASE_ADMIN_URL y psql."""
import os
from pathlib import Path
import secrets
import subprocess

import psycopg
from psycopg import sql
import pytest

ADMIN = os.getenv("TEST_DATABASE_ADMIN_URL")
pytestmark = pytest.mark.skipif(not ADMIN, reason="Requiere PostgreSQL de pruebas")
RAIZ = Path(__file__).resolve().parents[2]


def test_roles_aislan_esquemas_y_permiten_migraciones_existentes():
    nombre = "d11_" + secrets.token_hex(6)
    with psycopg.connect(ADMIN, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(nombre)))
    conexion = dict(psycopg.conninfo.conninfo_to_dict(ADMIN), dbname=nombre)
    try:
        with psycopg.connect(**conexion, autocommit=True) as admin:
            for esquema in ("auth", "subscriptions", "connectors", "analytics", "notifications"):
                admin.execute(sql.SQL("CREATE SCHEMA {}; CREATE TABLE {}.existente (id serial PRIMARY KEY, valor text)")
                              .format(sql.Identifier(esquema), sql.Identifier(esquema)))
            # Datos anteriores a la migración de permisos.
            admin.execute("INSERT INTO auth.existente (valor) VALUES ('conservar')")
        for _ in range(2):  # reintentar debe preservar datos y propiedad
            for esquema in ("auth", "subscriptions", "connectors", "analytics", "notifications"):
                proceso = subprocess.run([
                    os.getenv("PSQL", "psql"), "-X", "-q", "-d", psycopg.conninfo.make_conninfo(**conexion),
                    "-v", f"esquema={esquema}", "-v", f"rol=svc_{esquema}",
                    "-v", "clave=" + "ab" * 32,
                    "-f", str(RAIZ / "infra/migraciones/usuarios-servicio.sql"),
                ], capture_output=True, text=True)
                assert proceso.returncode == 0, proceso.stderr
        for esquema in ("auth", "subscriptions", "connectors", "analytics", "notifications"):
            with psycopg.connect(**dict(conexion, user="svc_" + esquema, password="ab" * 32), autocommit=True) as servicio:
                # ALTER exige propiedad; GRANT por sí solo no alcanzaría.
                servicio.execute("ALTER TABLE existente ADD COLUMN nueva integer")
                servicio.execute("INSERT INTO existente (valor) VALUES ('nuevo')")
                assert servicio.execute("SELECT count(*) FROM existente").fetchone()[0] >= 1
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    otro = "subscriptions" if esquema == "auth" else "auth"
                    servicio.execute(sql.SQL("SELECT * FROM {}.existente").format(sql.Identifier(otro)))
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    servicio.execute("CREATE ROLE usuario_intruso")
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    servicio.execute("CREATE TABLE public.intrusa (id integer)")
        with psycopg.connect(**conexion) as admin:
            assert admin.execute("SELECT valor FROM auth.existente WHERE id=1").fetchone() == ("conservar",)
    finally:
        with psycopg.connect(ADMIN, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(nombre)))
