# ADR-005 — Origen de los datos de cobros

**Fecha:** 2026-08-26 · **Estado:** aceptada
**Investigación:** ámbito financiero — acceso a datos de cobros en Chile

---

## Contexto

La funcionalidad más demandada en la encuesta fue **«que me avise antes de cada
cobro» (76,3%, n = 38)**, seguida por **«que me avise antes de que termine una
prueba gratuita» (60,5%)**. Ambas exigen que el sistema conozca **cuándo se va a
cobrar**.

Eso convierte el origen de los datos de cobro en una decisión de arquitectura, no
en un detalle de implementación: **sin fuente de cobros no hay producto**.

Se evaluaron cuatro vías.

---

## 1. Las cuatro vías comparadas

| Vía | Costo | Esfuerzo | Riesgo legal | Cobertura | Disponible en el semestre |
|---|---|---|---|---|---|
| **Entrada manual + CSV** | $0 | Bajo | Ninguno | Total, pero depende de la constancia del usuario | ✅ Sí |
| **Lectura de correo** | $0 | Medio-alto | Medio — alcance restringido de Google | Parcial: solo servicios que envían comprobante | ✅ Sí, con límites |
| **Agregación bancaria** (Fintoc, Belvo) | Alto | Medio | Alto — datos financieros de terceros | Alta | ⚠️ Solo en entorno de prueba |
| **Sistema de Finanzas Abiertas** (Ley Fintech) | Por definir | — | Regulado | Alta | ❌ No |

### 1.1 Entrada manual e importación CSV

Sin costo, sin dependencias externas y sin exposición regulatoria. Su debilidad
es conocida: exige que el usuario mantenga la información al día.

**Es el piso obligatorio del sistema.** Toda otra vía puede fallar —una API
externa se cae, un conector se desautoriza— y la aplicación debe seguir siendo
utilizable. Ninguna funcionalidad debe depender exclusivamente de un conector.

### 1.2 Lectura de correo

Se aborda en detalle en la tarea «Script de lectura de correos». Dos
restricciones relevantes para esta decisión:

- **Cobertura parcial.** Solo detecta cobros de servicios que envían comprobante
  por correo, y el formato varía por proveedor.
- **Alcance restringido de Google.** La lectura del buzón es un permiso sensible.
  Las aplicaciones en estado de prueba admiten un número acotado de usuarios sin
  proceso de verificación; publicarlas abiertamente exige una evaluación de
  seguridad. ⚠️ **Las condiciones y límites vigentes deben confirmarse en la
  consola de Google Cloud antes de comprometer alcance.**

Para un proyecto universitario con usuarios de prueba, el modo restringido es
suficiente.

### 1.3 Agregación bancaria

Ver capítulo 2.

### 1.4 Sistema de Finanzas Abiertas

Ver capítulo 3.

---

## 2. Estado de la agregación bancaria en Chile

Dos proveedores operan en el mercado chileno con producto maduro.

### Fintoc

| Aspecto | Dato |
|---|---|
| Cobro | 1% + IVA por transacción vía open banking (medio de pago) |
| **Mínimo de facturación** | **6,5 UF + IVA mensuales**, aplicable a todos los productos salvo integraciones de comercio electrónico |
| Conciliación bancaria | Cobro por cuenta bancaria conectada |
| Entorno de prueba | Sandbox disponible sin costo |
| Contratación | Vía equipo comercial |

Con la UF a **$40.867** (26-08-2026), ese mínimo equivale a
**≈ $265.600 mensuales, ≈ $316.100 con IVA**, se use o no el servicio.

### Belvo

| Aspecto | Dato |
|---|---|
| Planes | Desde **USD 1.000 mensuales**, con planes a medida por volumen |
| Entorno de prueba | Sandbox gratuito con datos ficticios |
| Cobertura | Regional; su foco declarado está en México y Brasil |

### Conclusión del capítulo

> **La agregación bancaria en producción es económicamente inviable para este
> proyecto.** El piso de gasto mensual de cualquiera de los dos proveedores
> supera el presupuesto completo de un trabajo universitario.
>
> **Los entornos de prueba, en cambio, sí son accesibles y gratuitos.** Permiten
> implementar y demostrar la integración con datos ficticios sin contratar el
> servicio.

---

## 3. Ley Fintech 21.521 y el Sistema de Finanzas Abiertas

La Ley 21.521 regula servicios financieros tecnológicos y crea el **Sistema de
Finanzas Abiertas (SFA)**: un ecosistema de intercambio de datos financieros con
consentimiento explícito del titular, que permitiría a terceros autorizados
acceder a información bancaria mediante interfaces estandarizadas.

Es, en teoría, la solución ideal al problema de este ADR.

### El cronograma

| Hito | Fecha |
|---|---|
| Publicación de la ley | 2023 |
| Entrada en operación **originalmente prevista** | Julio de 2026 |
| Consulta pública de la CMF que propone posponer 12 meses | Noviembre de 2025 |
| **Entrada en operación según NCG 569** | **Julio de 2027** |
| Sandbox y Directorio de la CMF disponibles | 9 meses antes → **≈ octubre de 2026** |

Tras la entrada en vigencia rige además un calendario gradual: entre 5 y 18 meses
para bancos y emisores de tarjetas según el tipo de interfaz, y entre 20 y 30
meses para el resto de las entidades reguladas.

### Conclusión del capítulo

> ⚠️ **El Sistema de Finanzas Abiertas no estará operativo durante este proyecto,
> ni durante el año siguiente.** La postergación de la CMF lo lleva a julio de
> 2027, y las interfaces de mayor utilidad para este caso llegan aún después.
>
> Esto no es un obstáculo, es un **argumento de diseño**: la arquitectura de
> conectores (`services/connectors`) permite incorporar el SFA como una fuente
> adicional cuando exista, sin rediseñar el sistema. El proyecto queda
> deliberadamente preparado para una capacidad que el mercado todavía no ofrece.

---

## 4. Decisión

**Se adopta una estrategia escalonada:**

| Prioridad | Fuente | Estado en el proyecto |
|---|---|---|
| 1 | **Entrada manual + importación CSV** | Implementada. Piso obligatorio: el sistema funciona sin ningún conector |
| 2 | **Lectura de correo** | Implementada con usuarios de prueba |
| 3 | **Agregación bancaria** | Integración contra el **sandbox** de Fintoc, si el tiempo lo permite. Producción fuera de alcance por costo |
| 4 | **Sistema de Finanzas Abiertas** | Trabajo futuro, con fecha conocida: julio de 2027 |

### Justificación

1. **El producto funciona desde el primer día.** Las dos funcionalidades más
   demandadas —aviso de cobro y aviso de fin de prueba— se satisfacen con
   entrada manual. No dependen de ninguna integración externa.

2. **El costo de la agregación bancaria excede el proyecto por dos órdenes de
   magnitud.** No es una limitación de diseño, es una restricción de mercado
   documentada.

3. **La integración es demostrable sin contratarla.** El sandbox permite mostrar
   el conector funcionando en la defensa.

4. **La arquitectura no queda comprometida.** El contrato común de conectores
   (`sincronizar()`, `obtener_uso()`) admite una fuente nueva sin tocar el resto
   del sistema.

### Consecuencias

**Positivas**

- Ningún riesgo de que el proyecto quede bloqueado por una dependencia externa
- Sin exposición regulatoria en producción
- Ruta de evolución documentada y fechada

**Negativas — asumidas**

- La detección automática de cobros queda limitada a lo que el correo permita
- La carga inicial de suscripciones recae en el usuario, lo que constituye
  fricción de adopción real y debe declararse en el informe

---

## 5. Protección de datos — Ley 21.719

### Vigencia

La Ley 21.719 fue publicada el **13 de diciembre de 2024** y **entra en vigencia
el 1 de diciembre de 2026**, es decir, **durante el desarrollo de este proyecto**.

### Obligaciones relevantes

| Obligación | Qué implica acá |
|---|---|
| **Base de licitud y consentimiento** | El consentimiento debe ser específico, informado y **revocable**. Conectar una cuenta externa exige consentimiento propio y separado |
| **Derechos ARCO** | Acceso, rectificación, cancelación y oposición. El usuario debe poder exportar y eliminar sus datos |
| **Registro de actividades de tratamiento** | Documentar qué datos se tratan, para qué y por cuánto tiempo |
| **Notificación de brechas** | Reporte a la Agencia dentro de **72 horas** |
| **Datos financieros** | Si la brecha involucra datos financieros, **además hay que comunicar a los titulares afectados** en lenguaje claro |
| **Sanciones** | Hasta **20.000 UTM**, o 4% de los ingresos anuales en caso de reincidencia |

### Consecuencias de diseño

Estas obligaciones se traducen en decisiones concretas, no en una sección
declarativa del informe:

1. **Minimización.** Se almacena únicamente proveedor, monto, fecha y ciclo. **No
   se guarda la cartola completa ni el detalle de transacciones ajenas a
   suscripciones.** Menos datos almacenados, menor exposición ante una brecha.

2. **Cifrado de credenciales.** Los tokens de los conectores se almacenan
   cifrados y nunca se exponen en la interfaz ni en los registros de la
   aplicación (ya establecido en CU-12).

3. **Consentimiento separado y revocable por conector.** Aceptar los términos de
   la aplicación no habilita a leer el correo. Desconectar un conector debe
   **eliminar** los datos obtenidos por esa vía, no solo revocar el acceso.

4. **Retención acotada.** Definir y documentar por cuánto tiempo se conservan los
   registros de uso.

5. **Aislamiento verificable.** El multi-tenancy de `shared/tenant` deja de ser
   solo una decisión técnica: es la medida que impide que los datos de un hogar
   sean accesibles a otro.

### ⚠️ Una obligación que ya aplica hoy

La planilla de la encuesta contiene **16 correos electrónicos** de personas que
se ofrecieron a probar la aplicación. Eso constituye tratamiento de datos
personales, con independencia de que el software aún no exista.

Medidas adoptadas:

- La carpeta `docs/` está excluida del repositorio público (ver `.gitignore`)
- Esos correos se usan **únicamente** para el fin declarado al recogerlos
- Deben eliminarse al término del proyecto si no se concreta la invitación

---

## Fuentes consultadas

Todas verificadas el **26 de agosto de 2026**. Las condiciones comerciales y los
plazos regulatorios cambian: **reverificar antes de la entrega final.**

- CMF — [Norma que regula el Sistema de Finanzas Abiertas](https://www.cmfchile.cl/portal/prensa/615/w3-article-82737.html)
- CMF — [Consulta pública sobre modificaciones al SFA](https://www.cmfchile.cl/portal/prensa/615/w3-article-100482.html)
- CMF — [Claves de la actualización de la NCG 514 (PDF)](https://www.cmfchile.cl/portal/principal/613/articles-100979_doc_pdf.pdf)
- Cuatrecasas — [NCG 569 y reglas técnicas del SFA](https://www.cuatrecasas.com/es/latam/servicios-financieros-seguros/art/cmf-ncg-569-reglas-tecnicas-sistema-finanzas-abiertas)
- Carey — [Propuesta que posterga 12 meses la entrada en vigencia del SFA](https://www.carey.cl/propuesta-normativa-de-la-cmf-a-la-ncg-n514-posterga-en-12-meses-la-entrada-en-vigencia-del-sistema-de-finanzas-abiertas-y-otorga-mayor-gradualidad-en-su-implementacion)
- Fintoc — [Tarifas y comisiones](https://fintoc.com/cl)
- Belvo — [Planes y precios](https://belvo.com/plans-and-pricing/)
- Belvo — [Documentación del sandbox](https://developers.belvo.com/apis/belvoopenapispec/section/introduction/sandbox)
- Thomson Reuters — [Ley 21.719 y la reconstrucción del derecho chileno de protección de datos](https://www.thomsonreuters.cl/es-cl/soluciones-juridicas/biblioteca-contenido-legal/ley-21719-y-la-reconstruccion-del-derecho-chileno-de-proteccion-de-datos-personales)
- Confirmer360 — [Ley 21.719 en banca y servicios financieros](https://confirmer360.com/guias/ley-21719-banca-financiero/)
- Valor de la UF al 26-08-2026 — [calcular.cl](https://www.calcular.cl/valor-uf)
