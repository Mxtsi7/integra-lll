-- S3-VI-07/09/10/11/12/14
-- Recepción y agregación de uso de recolectores.
--
-- Vive en el esquema `analytics` compartido, pero usa tablas `uso_*` propias:
-- no modifica las tablas de Django del servicio Analytics existente.
--
-- Clave lógica de idempotencia:
--   (organizacion_id, recolector_id, event_id)
-- La suscripción es destino inmutable, no parte de la clave.

CREATE SCHEMA IF NOT EXISTS analytics;

-- Barrera de borrado por tenant, compartida con `shared/borrado` de los
-- servicios Django. La limpieza toma `FOR UPDATE`; el consumidor de uso toma
-- `FOR SHARE` antes de escribir. Si la migración de Django ya la creó, este
-- `IF NOT EXISTS` no cambia nada (mismo nombre y columnas).
CREATE TABLE IF NOT EXISTS analytics.estado_eliminacion_organizacion (
    organizacion_id uuid        PRIMARY KEY,
    eliminada       boolean     NOT NULL DEFAULT false,
    operacion_id    uuid        NULL
);

-- Hecho exacto aceptado. Guarda el cuerpo normalizado y la huella para
-- distinguir un duplicado (mismo contenido/destino) de un conflicto (409).
CREATE TABLE IF NOT EXISTS analytics.uso_evento (
    organizacion_id   uuid        NOT NULL,
    recolector_id     uuid        NOT NULL,
    event_id          uuid        NOT NULL,
    suscripcion_id    uuid        NOT NULL,
    usuario_id        uuid        NULL,
    origen            text        NOT NULL
        CHECK (origen IN ('android', 'navegador')),
    inicio            timestamptz NOT NULL,
    fin               timestamptz NOT NULL,
    duracion_ms       bigint      NOT NULL CHECK (duracion_ms >= 0),
    tramos_actividad  jsonb       NOT NULL,
    zona_horaria      text        NOT NULL CHECK (length(zona_horaria) > 0),
    cobertura         text        NOT NULL
        CHECK (cobertura IN ('completa', 'parcial', 'sin_medicion')),
    estado            text        NOT NULL
        CHECK (estado IN ('activo', 'pausado', 'sin_permiso', 'revocado')),
    fecha_local       date        NOT NULL,
    huella            text        NOT NULL,
    ocurrido_en       timestamptz NOT NULL,
    correlation_id    uuid        NOT NULL,
    recibido_en       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organizacion_id, recolector_id, event_id),
    CHECK (fin > inicio)
);

CREATE INDEX IF NOT EXISTS uso_evento_por_suscripcion_dia
    ON analytics.uso_evento (organizacion_id, suscripcion_id, fecha_local);

CREATE INDEX IF NOT EXISTS uso_evento_por_dia
    ON analytics.uso_evento (organizacion_id, fecha_local);

-- Tramos exactos para calcular la unión temporal. Se guardan aparte del JSONB
-- para consultarlos sin deserializar y para que el agregado sea auditable.
CREATE TABLE IF NOT EXISTS analytics.uso_tramo (
    organizacion_id uuid        NOT NULL,
    recolector_id   uuid        NOT NULL,
    event_id        uuid        NOT NULL,
    indice          integer     NOT NULL CHECK (indice >= 0),
    inicio          timestamptz NOT NULL,
    fin             timestamptz NOT NULL,
    PRIMARY KEY (organizacion_id, recolector_id, event_id, indice),
    FOREIGN KEY (organizacion_id, recolector_id, event_id)
        REFERENCES analytics.uso_evento (organizacion_id, recolector_id, event_id)
        ON DELETE CASCADE,
    CHECK (fin > inicio)
);

CREATE INDEX IF NOT EXISTS uso_tramo_por_evento
    ON analytics.uso_tramo (organizacion_id, recolector_id, event_id);

-- Agregado diario: unión de todos los tramos de la suscripción en el día local.
-- `minutos_netos` es el piso de `ms_netos / 60000`; el residuo se conserva para
-- no perder precisión y no se traslada al día siguiente.
CREATE TABLE IF NOT EXISTS analytics.uso_diario (
    organizacion_id uuid        NOT NULL,
    suscripcion_id  uuid        NOT NULL,
    fecha_local     date        NOT NULL,
    ms_netos        bigint      NOT NULL DEFAULT 0 CHECK (ms_netos >= 0),
    minutos_netos   bigint      NOT NULL DEFAULT 0 CHECK (minutos_netos >= 0),
    ms_residuo      integer     NOT NULL DEFAULT 0
        CHECK (ms_residuo >= 0 AND ms_residuo < 60000),
    actualizado_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organizacion_id, suscripcion_id, fecha_local)
);

-- Agregado mensual: suma de los minutos diarios ya proyectados. No se vuelve a
-- dividir la suma mensual de milisegundos.
CREATE TABLE IF NOT EXISTS analytics.uso_mensual (
    organizacion_id uuid        NOT NULL,
    suscripcion_id  uuid        NOT NULL,
    anio            integer     NOT NULL CHECK (anio BETWEEN 1970 AND 9999),
    mes             integer     NOT NULL CHECK (mes BETWEEN 1 AND 12),
    minutos_netos   bigint      NOT NULL DEFAULT 0 CHECK (minutos_netos >= 0),
    ms_netos        bigint      NOT NULL DEFAULT 0 CHECK (ms_netos >= 0),
    actualizado_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organizacion_id, suscripcion_id, anio, mes)
);

-- Proyección interna de cobertura del contrato (CoverageIntervalPayload).
-- No es una segunda API: se deriva de los hechos aceptados.
CREATE OR REPLACE VIEW analytics.uso_cobertura AS
SELECT
    organizacion_id,
    event_id,
    usuario_id,
    suscripcion_id,
    recolector_id,
    origen,
    inicio,
    fin,
    zona_horaria,
    cobertura,
    estado
FROM analytics.uso_evento;
