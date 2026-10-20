# ADR-007 — Catálogos de referencia en los servicios existentes

**Fecha:** 2026-10-19 · **Estado:** propuesta implementada, pendiente de revisión

## Contexto

Monedas y categorías estaban repetidas en los choices de Django, los tipos
TypeScript y las listas de los formularios. Agregar una categoría requería
cambiar backend y frontend; los mapas visuales podían fallar con códigos nuevos.
El plan de implementación está en [#76](https://github.com/Mxtsi7/integra-lll/issues/76).

## Decisión

Usar la instancia PostgreSQL existente, respetando ADR-002:

- `subscriptions.moneda` y `subscriptions.categoria_suscripcion` pertenecen
  a Suscripciones.
- `auth.pais` pertenece a Auth. Se carga una copia versionada de ISO 3166-1
  con 249 países y territorios, traducidos al español por pycountry/iso-codes.
- Cada catálogo tiene UUID, auditoría, código único e inmutable, nombre,
  activo y orden. Es global: hereda de `ModeloBase`, sin `organizacion_id`.
- `shared/catalogos` comparte infraestructura; no contiene tablas concretas
  ni consulta esquemas ajenos. No modifica `shared/tenant/base.py`.
- Conservar las columnas de texto y los códigos de suscripciones, proveedores
  y cobros. Validar asignaciones en los serializers y en `save()` de los modelos.
  Se permiten valores inactivos únicamente cuando ya pertenecen al registro.
- Los catálogos se renombran o desactivan; el ORM habitual impide cambiar
  códigos y borrar opciones. SQL directo y escrituras masivas de referencias
  (`update`, `bulk_create`, `bulk_update`) eluden `save()` y requieren validación
  explícita. Esta primera entrega no agrega claves foráneas.
- Frecuencia y estado siguen siendo enums: sus valores activan cálculos y
  transiciones. El listado de frecuencias de los formularios proviene de la API.
- Iconos y colores siguen en la web, con apariencia genérica para categorías
  nuevas. Las etiquetas proceden de BD; ante un fallo de lectura se muestra
  el código conservando acceso a los datos. No hay listas locales de respaldo.

## Contrato

Los GET `/api/catalogos/suscripciones/` y `/api/catalogos/paises/` pasan por
el gateway y exigen sesión. Los servicios exigen `X-Usuario-Id` del gateway;
no se habilitan como rutas públicas. No hay endpoints de escritura.

Las opciones contienen `codigo`, `nombre`, `activo`, `orden`, ordenadas por
orden/nombre/código. `incluir_inactivos=true` incluye valores históricos;
por defecto se omiten. Otro valor del parámetro produce 400.

Suscripciones devuelve `monedas`, `categorias`, `frecuencias` y
`predeterminados`. Prefiere CLP y `otro` mientras estén activos; si no,
elige la primera opción activa o devuelve null si no existe ninguna.
El contrato de suscripciones conserva moneda/categoría como códigos, sin UUID
ni objetos anidados. El CSV conserva sus columnas de códigos y agrega
`categoria_nombre` y `moneda_nombre` con las etiquetas disponibles.

## Migración y despliegue

1. Respaldar y aplicar las migraciones de Auth y Suscripciones con el
   código nuevo, antes del frontend:

   ```sh
   docker compose run --rm auth python manage.py migrate --noinput
   docker compose run --rm subscriptions python manage.py migrate --noinput
   ```

2. La migración carga CLP/USD y las diez categorías actuales, sin depender
   del seed demo. Verifica códigos existentes también en Proveedor y Cobro.
   Si encuentra uno desconocido, falla con modelo/campo/código y revierte
   la migración: resolverlo con una decisión explícita y una migración de
   datos revisada. No reemplaza códigos silenciosamente por `otro`.
3. Publicar backend/gateway y después frontend. Los entrypoints existentes
   también ejecutan `migrate`. No requiere nuevas variables ni servicios.
4. Probar crear/editar, agregar una categoría, renombrarla, desactivarla y
   comprobar las etiquetas históricas y la exportación.

Las migraciones son aditivas respecto de los datos de negocio. Para revertir
una versión de la aplicación, conservar tablas/datos; no ejecutar la reversión
de las migraciones en producción. Si se usaron códigos nuevos, no desplegar
un backend antiguo que vuelva a rechazarlos con choices estáticos.

Antes de integrar, revisar los PR #66/#67 (modelos y máquina de estados),
#68–#73 (rutas/migraciones de Auth), #75 (registro) y #65 (Expo). Generar una
migración de unión si hay hojas paralelas del mismo app; no renumerar ni editar
migraciones ya aplicadas. Esta entrega parte de `728d975` en main y no depende
de esas ramas. No cambia la máquina de estados, autenticación ni registro.

## Mantención

```sh
# Reponer SOLO opciones iniciales ausentes; conserva cambios administrativos.
docker compose run --rm subscriptions python manage.py gestionar_catalogo --cargar-iniciales
docker compose run --rm auth python manage.py gestionar_catalogo --cargar-iniciales

# Crear y renombrar una categoría; recargar las opciones en la web.
docker compose run --rm subscriptions python manage.py gestionar_catalogo categorias hogar --nombre "Hogar" --orden 110
docker compose run --rm subscriptions python manage.py gestionar_catalogo categorias hogar --nombre "Casa y hogar"
docker compose run --rm subscriptions python manage.py gestionar_catalogo categorias hogar --desactivar
docker compose run --rm subscriptions python manage.py gestionar_catalogo categorias hogar --activar

# Mismo comando para monedas y países en sus respectivos servicios.
docker compose run --rm auth python manage.py gestionar_catalogo paises CL --nombre "Chile"
```

La web comparte una carga entre sus rutas privadas y permite actualizar o
reintentar. Conserva campos escritos durante la recarga; bloquea guardar si
las opciones no están disponibles. Editar permite conservar la opción original
inactiva, incluso cuando no hay alternativas activas. Las categorías nuevas
aparecen sin recompilar la web.

## Límites deliberados

El catálogo de países queda disponible para futuros selectores. No se añade un
campo país al usuario ni se vuelve obligatorio en el registro. La app móvil
puede reutilizar `getCatalogosSuscripciones`/`getPaises` del paquete compartido.

Las monedas inicialmente habilitadas siguen siendo CLP/USD. Agregar una moneda
no agrega conversión de divisas ni corrige los totales existentes que mezclen
monedas. Revisar cálculos y reportes antes de ampliar las monedas utilizadas.
`Intl.NumberFormat` determina los decimales de presentación de cada moneda.

Fuente, generación y licencia de países: ver
[`services/auth/app/migrations/data/README.md`](../../services/auth/app/migrations/data/README.md).
