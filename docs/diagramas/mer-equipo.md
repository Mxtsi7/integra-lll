# MER propuesto por el equipo — Ojo al Gasto

Transcripción literal del diagrama entidad-relación. Es lo que hay que revisar.

## Entidades y atributos

### ORGANIZACION
- int id_organizacion **PK**
- string nombre
- string tipo
- date fecha_creacion

### USUARIO
- int id_usuario **PK**
- int id_organizacion **FK**
- string nombre
- string email
- string password_hash
- string rol
- string plan
- date fecha_registro

### CATEGORIA
- int id_categoria **PK**
- string nombre
- string descripcion

(sin FK a organización: es un catálogo global)

### SUSCRIPCION
- int id_suscripcion **PK**
- int id_organizacion **FK**
- int id_categoria **FK**
- string nombre_servicio
- decimal monto
- string moneda
- string ciclo_facturacion
- date fecha_inicio
- date fecha_proximo_cobro
- string estado
- string origen_deteccion
- date fecha_ultimo_uso
- boolean es_recurrente_variable

### CONECTOR
- int id_conector **PK**
- int id_organizacion **FK**
- string tipo
- string proveedor
- string estado
- string credenciales_cifradas
- date fecha_conexion

### MOVIMIENTO
- int id_movimiento **PK**
- int id_suscripcion **FK**
- int id_conector **FK**
- decimal monto
- date fecha_movimiento
- string glosa_original
- string glosa_normalizada
- string origen

### HISTORIAL_ESTADO
- int id_historial **PK**
- int id_suscripcion **FK**
- string estado_anterior
- string estado_nuevo
- datetime fecha_cambio
- string motivo

### NOTIFICACION
- int id_notificacion **PK**
- int id_organizacion **FK**
- int id_suscripcion **FK**
- string tipo
- string canal
- string estado
- datetime fecha_programada
- datetime fecha_envio
- string url_cancelacion

### RECOMENDACION
- int id_recomendacion **PK**
- int id_organizacion **FK**
- string tipo
- string descripcion
- decimal ahorro_estimado
- date fecha_generada
- string estado

### RECOMENDACION_SUSCRIPCION (tabla puente M:N)
- int id_recomendacion **FK**
- int id_suscripcion **FK**

(no se declara clave primaria propia)

### DISPOSITIVO
- int id_dispositivo **PK**
- int id_usuario **FK**
- string token_push
- string plataforma
- date fecha_registro

### CONVERSACION
- int id_conversacion **PK**
- int id_usuario **FK**
- date fecha_inicio

### MENSAJE
- int id_mensaje **PK**
- int id_conversacion **FK**
- string rol
- string contenido
- datetime fecha_envio

## Relaciones dibujadas (con su etiqueta)

| Origen | Etiqueta | Destino | Cardinalidad leída del diagrama |
|---|---|---|---|
| ORGANIZACION | tiene | USUARIO | 1 a muchos |
| ORGANIZACION | posee | SUSCRIPCION | 1 a muchos |
| ORGANIZACION | conecta | CONECTOR | 1 a muchos |
| ORGANIZACION | recibe | RECOMENDACION | 1 a muchos |
| ORGANIZACION | recibe | NOTIFICACION | 1 a muchos |
| CATEGORIA | clasifica | SUSCRIPCION | 1 a muchos |
| USUARIO | registra | DISPOSITIVO | 1 a muchos |
| USUARIO | inicia | CONVERSACION | 1 a muchos |
| CONVERSACION | contiene | MENSAJE | 1 a muchos |
| CONECTOR | detecta | MOVIMIENTO | 1 a muchos |
| SUSCRIPCION | genera | MOVIMIENTO | 1 a muchos |
| SUSCRIPCION | registra | HISTORIAL_ESTADO | 1 a muchos |
| SUSCRIPCION | origina | NOTIFICACION | 1 a muchos |
| SUSCRIPCION | es_incluida_en | RECOMENDACION_SUSCRIPCION | 1 a muchos |
| RECOMENDACION | incluye | RECOMENDACION_SUSCRIPCION | 1 a muchos |

## Lo que NO aparece en el diagrama

No hay ninguna entidad ni atributo para:

- Registro de uso de un servicio (solo existe el escalar `SUSCRIPCION.fecha_ultimo_uso`)
- Presupuesto mensual ideal del usuario
- Configuración de alertas del usuario (qué alertas están activas, con cuántos días de anticipación)
- Marca de prueba gratuita y su fecha de término
- Pago, período pagado o renovación del plan Premium
- Guía de cancelación de un servicio
- Notas de una suscripción
- Candidato de cobro detectado y aún no confirmado por el usuario
- Consentimiento del usuario para leer su correo, y su revocación

**No existe ninguna relación directa entre USUARIO y SUSCRIPCION.** Todo pasa por ORGANIZACION.
