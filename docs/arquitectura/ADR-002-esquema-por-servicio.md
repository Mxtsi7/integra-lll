# ADR-002 — Un esquema por servicio, no una base por servicio

**Fecha:** 2026-08-21 · **Estado:** aceptada

## Contexto

La ortodoxia de microservicios indica **database per service**: cada servicio con
su propia instancia de base de datos, sin acceso al almacenamiento de los demás.

En el contexto de este proyecto, cinco instancias de PostgreSQL implican cinco
configuraciones, cinco respaldos y cinco despliegues, sobre planes gratuitos de
hospedaje que limitan la cantidad de bases de datos disponibles.

## Decisión

**Un esquema de PostgreSQL por servicio**, dentro de una única instancia. La
separación lógica es estricta:

- Ningún servicio consulta el esquema de otro. Nunca.
- No existen claves foráneas entre esquemas.
- Los datos que un servicio necesita de otro se obtienen por HTTP o llegan por
  evento, y se almacenan desnormalizados cuando corresponde.

## Justificación

La regla que realmente importa de **database per service** es que ningún
servicio lea directamente el almacenamiento de otro. Esa regla se cumple
íntegramente con esquemas separados.

Lo que se pierde es el aislamiento físico, que resuelve problemas de escala que
este sistema no tiene.

La migración a instancias separadas es posterior y no requiere cambios en el
código: basta apuntar cada servicio a una cadena de conexión distinta. Ese es
precisamente el argumento — **la decisión es reversible sin costo de rediseño**.

## Consecuencias

**Positivas**

- Una sola instancia que configurar, respaldar y desplegar
- Cabe en los planes gratuitos de hospedaje
- Migración a instancias separadas sin cambios de código

**Negativas**

- Sin aislamiento físico: una consulta pesada afecta a todos los servicios
- La separación depende de la disciplina del equipo, no del motor

**Mitigación:** en producción cada servicio se conecta con un usuario propio de
PostgreSQL, con permisos únicamente sobre su esquema. Así la separación pasa a
estar impuesta por el motor y no por la buena voluntad del desarrollador. Ver
`infra/migraciones/01-esquemas.sql`.
