# Despliegue en Kubernetes

Manifiestos para desplegar el sistema en el clúster que entregue el curso.

> **Docker Compose no se reemplaza.** Compose es para desarrollar en tu
> máquina; Kubernetes es para desplegar. Los dos conviven y usan exactamente
> las mismas imágenes.

---

## Antes de desplegar: preguntar al docente

Sin estas respuestas no se puede completar la configuración. **Pregúntenlas
apenas les entreguen el acceso**, no la semana de la entrega.

| # | Pregunta | Para qué |
|---|---|---|
| 1 | ¿Cuál es el **registro de imágenes**? (GHCR, Docker Hub, uno interno) | Reemplazar `REGISTRO` en los manifiestos y configurar el CI |
| 2 | ¿Qué **namespace** nos corresponde? | Aislar nuestros recursos de los de otros grupos |
| 3 | ¿Hay **Ingress Controller** instalado y de qué tipo? (nginx, traefik) | Definir `ingressClassName` y las anotaciones |
| 4 | ¿Tenemos **dominio y certificado TLS**, o se accede por IP y puerto? | Configurar el host del Ingress |
| 5 | ¿PostgreSQL y RabbitMQ los ponemos **nosotros dentro del clúster**, o hay instancias provistas? | Decide si hay que agregar manifiestos con almacenamiento persistente |
| 6 | ¿El clúster soporta **NetworkPolicy**? | La política de red del ADR-004 solo funciona con Calico o Cilium |
| 7 | ¿Cuántos **recursos** (CPU y memoria) tenemos asignados? | Ajustar `requests` y `limits`; hoy están puestos con valores conservadores |

⚠️ **La 5 es la más importante.** Bases de datos dentro de Kubernetes requieren
volúmenes persistentes y son la fuente número uno de problemas en proyectos
estudiantiles. Si el curso ofrece una base gestionada, o si pueden usar Neon
desde afuera, **tómenla**. No metan PostgreSQL al clúster salvo que sea
obligatorio.

---

## Qué hay acá

| Archivo | Contiene |
|---|---|
| `base/config.yaml` | ConfigMap con la configuración y plantilla del Secret |
| `base/servicios.yaml` | Los 5 servicios de dominio + el worker de sincronización |
| `base/gateway.yaml` | Gateway, frontend, Ingress y política de red |

---

## Desplegar

```bash
# 1. Namespace
kubectl create namespace suscripciones

# 2. Secretos (NUNCA desde un archivo del repositorio)
kubectl create secret generic secretos-suscripciones \
  --namespace suscripciones \
  --from-literal=SECRET_KEY='...' \
  --from-literal=JWT_SECRET='...' \
  --from-literal=DATABASE_URL='postgres://...' \
  --from-literal=RABBITMQ_URL='amqp://...' \
  --from-literal=ANTHROPIC_API_KEY='...'

# 3. Resto de los manifiestos
kubectl apply -n suscripciones -f base/

# 4. Verificar
kubectl get pods -n suscripciones
kubectl logs -n suscripciones deploy/gateway
```

---

## Conceptos que hay que poder explicar en la defensa

| Concepto | Qué es | Dónde está en el proyecto |
|---|---|---|
| **Pod** | La unidad mínima: uno o más contenedores que corren juntos | Cada réplica de un servicio |
| **Deployment** | Declara cuántas réplicas quieres y las mantiene vivas | Uno por servicio |
| **Service** | Nombre estable + balanceo hacia los pods de un Deployment | `http://auth:8001` resuelve por DNS interno |
| **Ingress** | La puerta de entrada HTTP desde fuera del clúster | Solo el gateway y el frontend tienen ruta |
| **ConfigMap / Secret** | Configuración y credenciales fuera de la imagen | `base/config.yaml` |
| **Probes** | Cómo sabe Kubernetes si un pod está vivo y listo | `/health/` en cada servicio |

**La diferencia entre liveness y readiness la preguntan casi siempre:**

- **liveness** falla → Kubernetes **reinicia** el contenedor (está colgado)
- **readiness** falla → deja de **enviarle tráfico**, pero no lo reinicia (está
  vivo pero todavía no puede atender, por ejemplo mientras corre las migraciones)

---

## Requisitos que las imágenes ya cumplen

Kubernetes asume aplicaciones que siguen ciertas reglas. Las nuestras las
cumplen desde el diseño:

- ✅ **Configuración por variables de entorno**, nunca en archivos dentro de la
  imagen — por eso todo pasa por `.env` y ConfigMap
- ✅ **Sin estado local**: los pods se destruyen y recrean sin avisar. Nada se
  guarda en el disco del contenedor
- ✅ **Logs a la salida estándar**, no a archivos. Kubernetes los recoge de ahí
- ✅ **Endpoint `/health/`** en cada servicio, para las probes
- ✅ **Descubrimiento por nombre**: `http://auth:8001`, jamás una IP fija
- ✅ **Un proceso por contenedor**: por eso el worker de Celery es un Deployment
  aparte, aunque comparta la imagen con `connectors`

⚠️ **Falta implementar el endpoint `/health/`** en cada servicio. Sin él las
probes fallan y Kubernetes reinicia los pods en bucle. Es de las primeras cosas
que hay que escribir — basta que devuelva `200 OK`.

---

## Advertencia de alcance

Kubernetes puede consumir mucho más tiempo del que parece. Recomendaciones:

1. **Que lo maneje una sola persona** — el líder técnico. Que los otros cinco
   trabajen contra Docker Compose sin preocuparse del clúster.
2. **Desplieguen algo trivial primero.** Un solo servicio, saludando. Cuando eso
   funcione de punta a punta, agreguen el resto. No intenten los seis de una.
3. **Háganlo temprano.** Un despliegue que se descubre roto la semana de la
   entrega es la forma clásica de llegar sin demo.
