# docs/ — documentación del proyecto

Dueño: el rol de QA y documentación. Pero **cada persona escribe la parte de su
propio módulo** — nadie documenta bien código que no escribió.

---

## Qué va en cada carpeta

### `investigacion/`

- Estado del arte y marco teórico
- Benchmarking de competidores (Rocket Money, Bobby, Subby, Emma)
- **Encuesta**: instrumento, resultados, análisis estadístico
- Entrevistas cualitativas: guion, transcripciones, citas destacadas

### `diagramas/`

- Modelo entidad-relación (MER)
- Diagrama de casos de uso + narrativas
- Diagrama de clases del dominio
- Diccionario de datos

Guarden el **archivo fuente** (`.drawio`, `.mmd`, link de Figma) además de la
imagen exportada. Un PNG no se puede corregir.

### `arquitectura/`

- Diagrama de componentes y de despliegue
- **Decisiones técnicas argumentadas** (ver abajo)
- Diseño del multi-tenancy
- Consideraciones de seguridad

### `informe/`

El documento de la entrega. **Un solo archivo compartido** (Google Docs u
Overleaf), no seis Word que se pegan al final — la costura se nota siempre.

---

## Registro de decisiones

Cada decisión técnica relevante se documenta en `arquitectura/` con esta
estructura:

```markdown
# ADR-001 — Django en vez de Go o Rust

**Fecha:** 2026-08-19
**Estado:** aceptada

## Contexto
El profesor sugirió Go o Rust. El equipo son 6 personas con manejo
disparejo y hay N semanas hasta la entrega.

## Decisión
Django + DRF para la aplicación. Se reserva Go para el servicio de
sincronización si la concurrencia lo justifica.

## Justificación
El cuello de botella es I/O (APIs externas y base de datos), no CPU, por
lo que la ventaja de rendimiento no aplica al caso. El ecosistema de
Django resuelve auth, ORM y migraciones, lo que reduce el riesgo de no
entregar.

## Consecuencias
+ Mayor velocidad de desarrollo
+ Menor riesgo de no completar el alcance
− Menos aprendizaje de lenguajes nuevos
− Rendimiento inferior en escenarios de alta concurrencia
```

**Esto vale nota.** Un profesor de 4º año quiere ver decisiones argumentadas, no
"usamos Django porque lo sabíamos". Y si en la defensa preguntan por qué no
usaron Rust, la respuesta ya está escrita y fechada.

---

## Reglas del informe

1. **Un solo documento compartido**, no seis pegados
2. **Plantilla y glosario definidos desde el día 1** — si uno escribe
   "suscripción", otro "servicio" y otro "plan", se lee incoherente
3. **Revisión cruzada**: cada persona lee la sección de otra
4. **Plazos internos 3 días antes del real**
5. **Las limitaciones se declaran.** Nombrar un sesgo metodológico suma;
   esconderlo, resta
