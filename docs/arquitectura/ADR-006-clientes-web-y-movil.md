# ADR-006 — Dos clientes: aplicación móvil y aplicación web

**Fecha:** 2026-08-31 · **Estado:** aceptada
**Sustituye la decisión previa de un único cliente web responsive**

---

## Contexto

El ramo exige la entrega de una **aplicación móvil**. La decisión anterior —una
sola aplicación web responsive que cubriera computador y celular— no satisface
ese requisito.

Se define además construir **ambos clientes**: aplicación móvil y aplicación web.

Datos de la encuesta que condicionan la decisión:

- El **84,2%** de los encuestados utilizaría la solución en el teléfono móvil
- El **47,4%** en computador
- La funcionalidad más demandada es el **aviso previo a cada cobro (76,3%)**,
  seguida por el aviso de término de prueba gratuita (60,5%)

## Decisión

**Dos clientes que consumen la misma API, con funcionalidades repartidas según el
contexto de uso.** No se construye la misma aplicación dos veces.

| Cliente | Tecnología | Distribución |
|---|---|---|
| **Móvil** | **React Native con Expo** (TypeScript) | APK de Android |
| **Web** | **React con Vite** (TypeScript) | Desplegada en el clúster |

### Reparto de funcionalidades

| Funcionalidad | Móvil | Web |
|---|---|---|
| Panel de gastos | Vista resumida | Vista completa |
| **Notificaciones push** | **Exclusivo** | — |
| Registrar suscripción | Sí | Sí |
| Marcar uso manual | Sí | — |
| **Conectar cuentas externas (OAuth)** | — | **Exclusivo** |
| Importar CSV | — | Sí |
| Gestionar integrantes del hogar | — | Sí |
| Recomendaciones e informes | Resumen | Detalle |

### Código compartido

Ambos clientes están escritos en TypeScript, por lo que comparten un paquete
real y no solamente un contrato:

```
frontend/
├─ shared/      cliente de API generado desde OpenAPI,
│               tipos, validaciones y lógica de presentación
│               (formato de montos, cálculo de días al próximo cobro)
├─ web/         React + Vite
└─ movil/       React Native + Expo
```

El backend expone su esquema mediante `drf-spectacular`; de ahí se genera el
cliente TypeScript que ambas aplicaciones importan. Un cambio de contrato en el
backend se detecta al compilar, en los dos clientes, y no en ejecución.

---

## Justificación

### Por qué el reparto por contexto y no funcionalidad duplicada

Duplicar toda la funcionalidad implica construir dos veces la capa que más horas
consume del proyecto. El reparto por contexto reduce el trabajo total y responde
a cómo se usa realmente cada dispositivo.

**Notificaciones push exclusivas del móvil.** Es la capacidad que una aplicación
nativa aporta y una web no entrega con fiabilidad. Coincide con la funcionalidad
más demandada del estudio.

**OAuth exclusivo de la web.** Vincular una cuenta externa desde móvil exige
*deep linking*, mecanismo frágil y costoso en tiempo de desarrollo. En web es un
redireccionamiento convencional. El usuario vincula sus cuentas una vez, en una
sesión de configuración, y luego opera desde el teléfono en el día a día. La
decisión simplifica la implementación **y** coincide con el comportamiento real.

### Por qué React Native y no Flutter

Se evaluó Flutter como alternativa. Se descartó por tres razones acumulativas:

1. **Un solo lenguaje en todo el frontend.** El equipo ya trabaja con React y
   TypeScript en el cliente web. React Native conserva el lenguaje, los conceptos
   y el razonamiento. Flutter implicaría incorporar Dart, nuevo para todos los
   integrantes, dentro del mismo semestre.

2. **Código efectivamente compartido.** Con ambos clientes en TypeScript, el
   paquete `shared` contiene código ejecutable —cliente de API, tipos,
   validaciones, formateo— y no únicamente un contrato del que cada lado genera
   su propia versión. Con Flutter esa reutilización no existe.

3. **Movilidad dentro del equipo.** Quien desarrolla la web puede apoyar el
   móvil y viceversa. Con dos lenguajes distintos, cada persona queda encerrada
   en su cliente, lo que es un riesgo real en un equipo de seis con plazos fijos.

### Por qué Expo

React Native sin Expo requiere que cada integrante instale y configure Android
Studio, el SDK de Android, Java y Gradle. Es una fuente conocida de pérdida de
tiempo y falla de manera distinta en cada máquina.

Expo elimina esa barrera:

- La aplicación se ejecuta **en el teléfono real mediante un código QR**, sin
  emulador ni entorno nativo instalado
- La compilación del APK ocurre en la nube, sin toolchain local
- Incorpora los módulos que el proyecto necesita: notificaciones push
  (`expo-notifications`), almacenamiento seguro de credenciales
  (`expo-secure-store`) y sesión de autorización (`expo-auth-session`)

### Por qué no una sola aplicación para ambas plataformas

Se descartó usar React Native Web para cubrir también el navegador. El resultado
se comporta como una aplicación móvil ampliada, con un modelo de accesibilidad y
un rendimiento de carga inferiores a los de una web convencional. Para un panel
de escritorio con tablas e importación de archivos, React con Vite es más
adecuado.

---

## Consecuencias

**Positivas**

- Se satisface el requisito del ramo
- Las notificaciones push refuerzan la propuesta de valor central del producto
- Un solo lenguaje en todo el frontend, con código realmente compartido
- El contrato con la API queda verificado por el compilador en ambos clientes
- La complejidad del OAuth queda contenida en un solo cliente

**Negativas — asumidas conscientemente**

- Dos bases de código de interfaz que mantener
- Dos procesos de despliegue distintos: la web al clúster, el móvil como archivo
  distribuible
- React Native introduce diferencias respecto de React web —navegación,
  estilos, componentes— que requieren aprendizaje aunque el lenguaje sea el mismo

### Limitación declarada: solo Android

La entrega se realiza como **archivo APK para Android**. Se descarta iOS porque
la distribución requiere una cuenta de Apple Developer de costo anual, no
contemplada en el presupuesto del proyecto.

Debe declararse explícitamente en el informe como limitación de alcance.

### Notificaciones push

El envío se realiza mediante el **servicio de notificaciones de Expo**. El
servicio `notifications` pasa a gestionar **dos canales de salida**: correo
electrónico y push.

⚠️ **El push nunca es el único canal.** Si el usuario no tiene la aplicación
instalada, o la entrega falla, la alerta se envía igualmente por correo. La
funcionalidad no depende de que el dispositivo esté disponible.

### Plan de contingencia

> Si a mitad del semestre el avance no permite completar ambos clientes, **se
> recorta la aplicación web**, no la móvil.

Fundamento: la aplicación móvil es requisito del ramo, y el 84,2% de los
encuestados declara que utilizaría la solución en el teléfono.

Esta decisión se toma **por anticipado y por escrito**, de modo que no deba
discutirse bajo presión de plazo.

---

## Impacto sobre decisiones anteriores

| Documento | Cambio |
|---|---|
| ADR-001 | Sin cambios. La arquitectura de microservicios no se ve afectada |
| ADR-004 | Sin cambios. Ambos clientes se autentican contra el mismo gateway |
| CU-12, CU-13 | El flujo OAuth se restringe al cliente web |
| CU-23, CU-24 | Las notificaciones incorporan el canal push además del correo |
| Servicio `notifications` | Gestiona dos canales de salida |
