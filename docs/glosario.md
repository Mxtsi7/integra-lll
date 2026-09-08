# Glosario

Vocabulario común del proyecto. **Si dos personas usan palabras distintas para
la misma cosa, el informe se lee incoherente y el código se desordena.**

Estos términos se usan igual en el código, en el modelo de datos, en los casos
de uso y en el informe.

---

## Decisión de segmento

> **El sistema se enfoca en B2C: personas y grupos familiares.**
> *Decidido el 2026-08-21.*

El mercado empresarial (gestión de licencias corporativas de software) queda
fuera del alcance de esta versión y se menciona en el informe como línea de
trabajo futuro.

**Fundamento:** la encuesta aplicada mide comportamiento de consumidores
individuales. El segmento validado por los datos es el mismo que atiende el
producto.

---

## Términos del dominio

### Organización

Unidad que agrupa a los usuarios que comparten gastos. **En B2C corresponde a un
hogar o grupo familiar.**

Es el eje del aislamiento multi-tenant: toda la información pertenece a una
organización, y ninguna puede ver los datos de otra.

> **Por qué se llama "organización" y no "hogar":** el nombre es neutro a
> propósito. Si en el futuro se atiende el segmento empresarial, el modelo de
> datos no cambia — solo cambia qué representa la entidad. Es una decisión de
> diseño deliberada, no una indefinición.

En la interfaz, en cambio, el usuario **nunca ve la palabra "organización"**. Ve
"Mi hogar" o "Mi grupo".

### Usuario

Persona con cuenta en el sistema. Pertenece a exactamente una organización.

**Roles en B2C** (más simples que en el modelo empresarial):

| Rol | Puede |
|---|---|
| **Titular** | Todo: invitar y quitar integrantes, editar cualquier suscripción, cambiar el plan |
| **Integrante** | Ver el panel del grupo, registrar y editar sus propias suscripciones, marcar su uso |

### Proveedor

Empresa que presta un servicio por suscripción: Netflix, Spotify, un gimnasio.

**Es un catálogo global**, compartido por todas las organizaciones. Netflix es
Netflix para todos. Por eso `proveedor` no lleva `organizacion_id`.

### Suscripción

Contrato activo entre una organización y un proveedor, con un monto y un ciclo
de facturación.

Pertenece a la organización, no a la persona. Uno o varios usuarios pueden estar
vinculados a ella, y uno de ellos es el **pagador**.

### Cobro

Un pago concreto y ya ocurrido de una suscripción. Tiene monto y fecha.

⚠️ No confundir con el **monto** de la suscripción, que es el valor esperado del
próximo cobro. La diferencia entre ambos es precisamente lo que permite detectar
un alza de precio.

### Uso

Registro de que un servicio fue utilizado. Tiene fecha, cantidad y fuente
(API externa, dispositivo o registro manual).

**Es el dato central del producto.** Sin uso no hay recomendación, y sin
recomendación el sistema es una planilla de gastos.

### Conector

Vínculo autorizado con un servicio externo del que se obtienen datos: Spotify
para el uso, correo para los cobros, archivo CSV para la carga inicial.

### Recomendación

Sugerencia generada por el sistema sobre una suscripción, con un puntaje y un
motivo. La principal es "candidata a cancelar".

### Costo por hora de uso

Métrica distintiva del producto: cuánto cuesta cada hora efectivamente usada de
un servicio.

```
costo por hora = monto mensual / horas de uso del mes
```

Es la cifra que hace visible el desperdicio. Un servicio de $9.900 usado dos
horas al mes cuesta $4.950 la hora.

---

## Términos que NO usamos

Para evitar sinónimos sueltos rondando por el informe:

| ❌ No usar | ✅ Usar |
|---|---|
| Servicio, plan, membresía | **Suscripción** |
| Empresa, compañía, marca | **Proveedor** |
| Pago, transacción, cargo | **Cobro** |
| Cliente, cuenta | **Usuario** u **organización**, según corresponda |
| Empresa, cuenta corporativa | **Organización** |

⚠️ **Ojo con "servicio":** en el informe la palabra queda reservada para los
microservicios del sistema (`auth`, `subscriptions`, etc.). Lo que el usuario
contrata es una **suscripción** con un **proveedor**.

---

## Qué implica la decisión B2C

### Lo que NO cambia

- La arquitectura de microservicios y el despliegue en Kubernetes
- El aislamiento multi-tenant: la organización sigue siendo el eje
- Los conectores: Spotify, correo y CSV eran ya la vía B2C
- El modelo de datos, salvo la simplificación de roles

### Lo que sí cambia

| Aspecto | Ajuste |
|---|---|
| **Roles** | De tres (admin, finanzas, lectura) a dos: titular e integrante |
| **CU-04 y CU-05** | Bajan de prioridad. Un hogar tiene 2 a 5 integrantes, no 80 |
| **CU-10 Compartir suscripción** | **Sube a prioridad alta.** Es el caso familiar y responde a la hipótesis H4 |
| **Modelo de ingresos** | Freemium por organización, no cobro por usuario |
| **Lenguaje de la interfaz** | "Mi hogar", "integrantes". Nunca "organización" ni "empleados" |
| **Trabajo futuro** | El segmento empresarial se documenta como extensión posible |
