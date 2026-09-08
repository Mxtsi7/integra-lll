# ADR-004 — Autenticación y propagación del contexto multi-tenant

**Fecha:** 2026-08-21 · **Estado:** aceptada

## Contexto

Con seis componentes, validar el token en cada uno significa que todos dependen
del servicio de autenticación en cada petición, y que la lógica de validación
queda replicada seis veces.

Además, el sistema es multi-tenant: **cada servicio debe saber a qué
organización pertenece la petición que está atendiendo**.

## Decisión

1. `auth` **emite** los tokens JWT firmados, con `usuario_id`, `organizacion_id`
   y `rol` en su contenido.
2. El **gateway valida la firma una sola vez** por petición.
3. El gateway propaga la identidad a los servicios internos mediante cabeceras:

```
X-Usuario-Id:      7f3a1b...
X-Organizacion-Id: 9c2140...
X-Rol:             admin
X-Correlation-ID:  4b8e77...
```

4. Los servicios internos **confían en esas cabeceras** y no vuelven a validar.
5. Cada servicio **filtra obligatoriamente** por `X-Organizacion-Id`.

## Justificación

- Un solo lugar valida firmas, y por lo tanto un solo lugar donde equivocarse
- Los servicios internos no dependen de `auth` en cada petición
- El contexto de organización viaja de forma uniforme y explícita por todo el
  sistema, incluidos los eventos

## Consecuencias

⚠️ **Riesgo crítico.** Si un servicio interno queda expuesto a internet,
cualquiera puede enviar la cabecera `X-Organizacion-Id` que quiera y leer los
datos de cualquier cliente.

**Mitigaciones obligatorias:**

1. Los servicios internos **nunca** se publican fuera de la red interna. Solo el
   gateway expone puertos al exterior.
2. En producción, los servicios aceptan tráfico únicamente desde el gateway.
3. Las cabeceras de identidad que lleguen desde el exterior son **descartadas por
   el gateway** antes de reenviar la petición. Un cliente no puede inyectar su
   propia `X-Organizacion-Id`.

El punto 3 es el que hace que el esquema sea seguro, y **hay que poder explicarlo
en la defensa**: sin él, el diseño completo se cae.

La clase base que aplica el filtro en cada servicio está en `shared/tenant/`.

## Nota sobre los puertos en desarrollo

El archivo `docker-compose.yml` publica los puertos 8001 a 8005 para facilitar el
trabajo y las pruebas. **Esa configuración es exclusiva de desarrollo local.** En
el despliegue, esos puertos no se publican.
