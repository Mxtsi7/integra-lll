# Comparador de tiempos en Bash

El profesor necesita ver la diferencia temporal de ejecutar el mismo recálculo
sin RabbitMQ (dentro de la petición) o mediante su consumidor. El usuario eligió
la terminal y autorizó implementar y abrir una PR; no se modifica la web.

Se amplía `comparar-cola.sh` con `--tiempos`, disponible también en el menú de
carga. Un ayudante Python estándar genera desde el computador un número fijo
de POST autenticados contra la URL pública. No crea pods ni requiere otro
namespace. El modo Fortio existente se conserva para sus mediciones internas.

Se usan dos organizaciones sintéticas inicialmente vacías, con igual semilla,
operaciones y concurrencia. Tres rondas alternan el orden. Se fijan temporalmente
los HPA de Gateway y Subscriptions a sus réplicas actuales y se restauran junto
con el override exacto de EVENTOS_ASINCRONOS, también ante fallos o Ctrl+C.
Beat, consumidores y RabbitMQ permanecen activos. No se borran datos ni mensajes.

La tabla informa p50/p95 HTTP, tiempo observado hasta acreditar todos los
recálculos, operaciones y errores, y diferencias porcentuales sin presumir una
mejora. Cada ronda exige HTTP 201 y evidencia durable por evento, organización
y autor del trabajo. El tiempo total incluye la consulta de comprobación, con
sondeo declarado; no incluye seeding, rollouts ni restauración.

Alternativas: una pantalla web fue descartada por el usuario. Mantener solo
Fortio exige un namespace extra que no puede ser prerrequisito. Se conserva el
contrato outbox: esta es una comparación del recálculo, no una app sin broker.

La prueba añade consumo transitorio al computador y a los servicios existentes,
no reservas permanentes de RAM. No mide ahorro de RAM al retirar RabbitMQ.
