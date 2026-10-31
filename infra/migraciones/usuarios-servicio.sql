-- psql -v esquema=auth -v rol=svc_auth -v clave=<aleatoria> -f este-archivo
-- Ejecutar como administrador. No borra tablas ni cambia su contenido.
\set ON_ERROR_STOP on
BEGIN;
SELECT format('CREATE ROLE %I LOGIN', :'rol')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'rol') \gexec
ALTER ROLE :"rol" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'clave';
CREATE SCHEMA IF NOT EXISTS :"esquema";
REVOKE ALL ON SCHEMA :"esquema" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA :"esquema" OWNER TO :"rol";
-- Las migraciones antiguas corrieron como postgres: GRANT no basta para
-- ALTER TABLE. Transferir propiedad de objetos del esquema permite migrar.
SELECT format('ALTER %s %I.%I OWNER TO %I',
    CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
    n.nspname, c.relname, :'rol')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'esquema' AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
ORDER BY CASE WHEN c.relkind = 'S' THEN 1 ELSE 0 END \gexec
REVOKE ALL ON ALL TABLES IN SCHEMA :"esquema" FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA :"esquema" FROM PUBLIC;
ALTER ROLE :"rol" SET search_path TO :"esquema";
COMMIT;
