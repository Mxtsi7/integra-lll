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
