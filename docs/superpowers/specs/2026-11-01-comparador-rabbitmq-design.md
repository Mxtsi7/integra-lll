# Comparador de tiempos en Bash

El profesor necesita ver la diferencia temporal de ejecutar el mismo recálculo
sin RabbitMQ (dentro de la petición) o mediante su consumidor. El usuario eligió
la terminal y autorizó implementar y abrir una PR; no se modifica la web.

Se amplía `comparar-cola.sh` con `--tiempos`, disponible también en el menú de
carga. Un ayudante Python estándar genera desde el computador un número fijo
de POST autenticados contra la URL pública. No agrega pods concurrentes ni
requiere otro namespace; cambiar modo reemplaza el pod de API con Recreate. El modo Fortio existente se conserva para sus mediciones internas.

Se usan dos organizaciones sintéticas inicialmente vacías, con igual semilla,
operaciones y concurrencia. Tres rondas alternan el orden. Se fijan temporalmente
los HPA de Gateway y Subscriptions a sus réplicas actuales y se restauran junto
con el override exacto de EVENTOS_ASINCRONOS, también ante fallos o Ctrl+C.
Beat, consumidores y RabbitMQ permanecen activos. No se borran datos ni mensajes.

La tabla informa p50/p95 HTTP y mínimo/mediana/máximo del lote por marcas
persistidas: max(hecho_en) - min(ocurrido_en). El sondeo solo acredita resultados,
no suma tiempo. Se separa espera de outbox/Beat (publicado_en - ocurrido_en) del
desfase firmado posterior (hecho_en - publicado_en), que puede ser negativo por
el registro tardío del confirm: no se presenta como latencia AMQP pura. Las
marcas de app requieren relojes sincronizados y no son instantes de commit.

La revisión de #141 añade respaldo durable en metadata del Deployment antes de
cambiar configuración, adquisición con resourceVersion, bloqueo si quedó
pendiente y --restaurar independiente de sesiones. Solo se retira tras verificar
API y HPA. La limpieza aísla kubectl de las señales de la terminal. Cada fase
calienta con POST iguales fuera de muestras; revisa expiración de sesiones y
reintenta drenaje. El lanzador prueba Python y evita rutas MSYS absolutas. La
operación avisa reinicios y pide SI, con --si para ejecución ya autorizada.

Alternativas: una pantalla web fue descartada por el usuario. Mantener solo
Fortio exige un namespace extra que no puede ser prerrequisito. Se conserva el
contrato outbox: esta es una comparación del recálculo, no una app sin broker.

La prueba añade consumo transitorio al computador y a los servicios existentes,
no reservas permanentes de RAM. No mide ahorro de RAM al retirar RabbitMQ.
