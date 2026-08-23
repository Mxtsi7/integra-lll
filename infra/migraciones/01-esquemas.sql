-- Un esquema por servicio dentro de la misma instancia de PostgreSQL.
-- Separación lógica estricta: ningún servicio consulta el esquema de otro.
-- Ver docs/arquitectura/ADR-002-esquema-por-servicio.md

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS subscriptions;
CREATE SCHEMA IF NOT EXISTS connectors;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS notifications;

-- En producción, cada servicio se conecta con su propio usuario, con
-- permisos únicamente sobre su esquema. Así la separación deja de
-- depender de la disciplina del equipo y pasa a estar impuesta por el
-- motor de base de datos.
--
-- CREATE USER svc_subscriptions WITH PASSWORD '...';
-- GRANT USAGE, CREATE ON SCHEMA subscriptions TO svc_subscriptions;
