# ADR-001 — Arquitectura de microservicios

**Fecha:** 2026-08-21 · **Estado:** aceptada

## Contexto

El sistema es un SaaS multi-tenant con seis desarrolladores y un semestre de
plazo. Se evaluaron dos estilos: monolito modular y microservicios.

Se identificaron componentes con características de operación marcadamente
distintas:

- **Conectores externos**: dependen de APIs de terceros inestables, con límites
  de peticiones y fallos frecuentes. Su tasa de cambio es alta.
- **Análisis y recomendación**: cómputo pesado y periódico, no ligado al ciclo
  de petición y respuesta.
- **Autenticación**: transversal, de bajo cambio y alta criticidad.
- **Notificaciones**: responsabilidad única, sin dependencias del dominio.

## Decisión

Arquitectura de **microservicios** con cinco servicios de dominio más un API
Gateway como punto único de entrada.

## Justificación

1. **Aislamiento de fallos.** Si la API de Spotify deja de responder, se degrada
   únicamente `connectors`. El resto del sistema sigue operando: el usuario
   puede consultar su panel y registrar suscripciones sin verse afectado.

2. **Escalamiento independiente.** `analytics` y `connectors` tienen perfiles de
   carga distintos al resto y pueden escalarse por separado.

3. **Contención de la volatilidad.** Los cambios de las APIs externas quedan
   confinados a un servicio y no se propagan al modelo de dominio.

4. **Alineación con la estructura del equipo.** Seis personas, seis componentes.
   Cada integrante es dueño de uno, con su propio despliegue y sus pruebas. Esto
   reduce los conflictos de integración, que en equipos de este tamaño son una
   fuente real de pérdida de tiempo.

5. **Fronteras explícitas.** Cada servicio publica un contrato OpenAPI. Las
   dependencias entre componentes quedan documentadas y son verificables.

## Consecuencias

**Positivas**

- Fallos aislados por servicio
- Despliegue y escalamiento independientes
- Propiedad clara del código por persona
- Contratos explícitos entre componentes

**Negativas — asumidas conscientemente**

- **Mayor complejidad operativa.** Seis procesos, un broker de mensajes y una
  base de datos. Se mitiga con Docker Compose: un solo comando levanta todo.
- **Depuración distribuida.** Un error puede atravesar tres servicios. Se mitiga
  con un identificador de correlación propagado en cada petición y evento.
- **Consistencia eventual.** Las operaciones que cruzan servicios no son
  transaccionales. Se acepta porque el dominio lo tolera: que una recomendación
  se calcule algunos segundos después de registrarse el uso no tiene impacto.
- **Sobrecarga inicial.** Levantar seis esqueletos toma más tiempo que uno solo.
  Se concentra en la primera semana y se amortiza durante el resto del proyecto.

## Alternativa descartada

**Monolito modular.** Menor complejidad operativa y desarrollo inicial más
rápido. Se descartó porque no ofrece aislamiento de fallos frente a las APIs
externas — que son el punto más frágil del sistema — ni permite la propiedad
independiente del código por integrante.

## Riesgo declarado

El riesgo principal es que la complejidad operativa consuma tiempo destinado a
funcionalidad.

**Mitigación:** los servicios `notifications` y `analytics` están diseñados para
poder fusionarse en uno solo si a mitad del proyecto el avance no es el
esperado. Las fronteras están definidas de modo que esa fusión no obligue a
rediseñar el resto del sistema.
