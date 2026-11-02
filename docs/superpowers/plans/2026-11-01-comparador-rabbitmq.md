# Comparador RabbitMQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** comparar tiempos reales desde Bash sin agregar pods ni una página.
**Architecture:** ayudante Python estándar detrás de `comparar-cola.sh --tiempos`;
conservar el generador Fortio existente. Acreditar el trabajo desde la BD.
**Tech Stack:** Bash, Python 3, urllib, unittest y kubectl.
**Spec:** `docs/superpowers/specs/2026-11-01-comparador-rabbitmq-design.md`.

## Global Constraints

- No crear pods, retirar broker/Beat, borrar datos ni cambiar contratos.
- Igual semilla, número de operaciones, concurrencia y réplicas por modo.
- Restaurar HPA y override de API incluso si falla una fase o llega Ctrl+C.
- Tokens exclusivamente en entorno, stdin a Gateway y petición HTTPS sin redirects.

## Review Focus

- Sesión/HTTP rechazado: no presentar éxito ni filtrar token.
- Cola vacía sin trabajo acreditado: esperar y fallar por plazo.
- Configuración original ausente/valueFrom: restaurar su forma exacta.
- Segunda repetición: ambas organizaciones deben partir de igual cantidad.
- Fallo al restaurar: salida no cero y mensaje accionable, sin tabla de éxito.

## Task 1: Comparación e integración

**Files:** crear `k8s/pruebas/comparar_tiempos.py` y
`scripts/tests/test_comparar_tiempos.py`; modificar `comparar-cola.sh`,
`prueba-de-carga.sh` y su README.
**Interfaces:** entrada por URL_COMPARACION/TOKEN_SIN/TOKEN_CON y parámetros
acotados; salida tabla de tiempos y diferencias porcentuales, error no cero.

- [x] Escribir y ejecutar pruebas fallidas de percentiles, transporte HTTP,
      equivalencia de carga, evidencia, restauración y errores.
- [x] Implementar el ayudante, entrada Bash y menú; documentar memoria y alcance.
- [x] Ejecutar unittest nuevo, arneses Bash existentes, presupuesto y sintaxis.
- [ ] Revisar diff completo, publicar rama y abrir PR con motivo y validaciones.

## Evidencia de ejecución

Revisión independiente: reproducida y corregida la interrupción durante la
propia restauración (prueba RED→GREEN con SIGINT real). Se corrigió también
la aceptación tardía de evidencia: cada consulta usa el presupuesto restante
y no se acredita éxito fuera de ESPERA (RED→GREEN).

Decisión: el total es observado desde el computador e incluye consulta/sondeo;
no es una medición de CPU ni ahorro de RAM. No se ejecutó contra el clúster.


## Correcciones de revisión #141

- [x] Lanzador: probar intérprete real, fallback, ruta relativa, -u; arnés Git Bash.
- [x] Recuperación: original durable en metadata con resourceVersion, bloqueo de
      corrida pendiente, --restaurar sin sesiones y verificación de API/HPA/UID.
- [x] Métricas: marcas por evento, etapas Beat/publicación/evidencia, mínimo/p50/máximo.
- [x] Menores: aviso/confirmación de Recreate, calentamiento fuera de muestras,
      exp al inicio y cada fase, grupos aislados durante restauración, reintentos
      de drenaje y aclaración env_file. Las cuentas con datos parciales siguen
      requiriendo eliminación normal o cuentas nuevas; no se limpia información.

Decisión técnica: publicado_en se registra después de confirm/close AMQP y puede
ser posterior al recálculo. Conservar y explicar el signo del desfase, sin
inventar latencia pura ni truncar negativos. El sondeo no mide duración.
