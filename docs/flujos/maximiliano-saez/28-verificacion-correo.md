# MX-28 — Verificar correo

Tarjeta: [MX-28](https://trello.com/c/iJ5pbI0q).

`POST /api/auth/email-verification/request/` requiere JWT validado por el gateway
y usa exclusivamente `X-Usuario-Id` (ADR-004). Sin `email`, verifica el correo
actual; con `email`, prepara el cambio y exige `password` actual. El usuario
debe estar activo. No acepta un identificador de usuario en el cuerpo.

La solicitud guarda destino, correo anterior, huella de credenciales, expiración
y SHA-256 del secreto aleatorio con prefijo `verificar_correo:`. El secreto solo
se envía por correo en `/verificar-correo?token=...`; nunca se guarda en claro ni
se escribe en logs. La ruta de la web es el destino contractual del enlace;
esta tarea implementa los endpoints de auth, sin pantalla nueva.

`POST /api/auth/email-verification/confirm/` es público y recibe `{"token":"..."}`.
Bloquea usuario y solicitud en PostgreSQL; comprueba que el correo anterior y
las credenciales sigan vigentes. El correo activo se conserva hasta confirmar:
solo entonces cambia `User.email` y registra `correo_verificado_en`. Rechaza
destinos ocupados sin activar otra cuenta. Si cambia el correo, envía un aviso
a la dirección anterior. Un fallo SMTP revierte la operación para reintentar.

El token vence a los 60 minutos (`410 token_expirado`); consumirlo dos veces da
`410 token_usado`. Un reenvío invalida el enlace anterior (`400 token_invalido`).
Límite persistente por usuario: 60 segundos entre envíos y máximo 5 por hora;
excederlo responde `429 limite_reenvio`. Los bloqueos serializan reenvíos y
confirmaciones concurrentes. No se emiten JWT ni se inicia sesión al verificar.

Migración: `0006_verificacion_correo`. Pruebas: `tests/test_verificacion_correo.py`.

La restricción `usuario_email_unico_sin_mayusculas` garantiza unicidad de
`Lower(email)` también frente al registro concurrente. Registro devuelve `400`
si pierde esa carrera. La migración comprueba duplicados antes de crearla y
falla con diagnóstico explícito; no elimina ni modifica cuentas existentes.
Consulta previa desde la consola Django:

```python
from django.db.models import Count
from django.db.models.functions import Lower
from app.models import User
User.objects.annotate(correo_normalizado=Lower("email")).values("correo_normalizado").annotate(total=Count("pk")).filter(total__gt=1)
```

Si existen resultados, el equipo debe resolver manualmente la titularidad de
las cuentas antes de reintentar la migración; esa corrección queda fuera de MX-28.
