# Diagrama de flujo corregido

**Fuente:** [`flujo-corregido.mmd`](flujo-corregido.mmd) · imagen en [`png/flujo-corregido.png`](png/flujo-corregido.png) y [`png/flujo-corregido.svg`](png/flujo-corregido.svg)
**Fecha:** 7 de septiembre de 2026

Corrige los seis defectos detectados en la revisión de la versión anterior. Está en Mermaid: se pega directo en Eraser, en mermaid.live o en cualquier editor que lo soporte.

---

## 1. Qué se corrigió

### 1.1 Se agregó el estado «Fantasma»

Faltaba por completo, pese a que RN-15 lo define: *un servicio pasa a fantasma si no se detecta uso durante más de 45 días continuos*. Era la omisión más grave, porque es la única rama que conecta el ciclo de vida con el **uso**, y el uso es lo que diferencia el producto de una planilla de gastos: el 68,4% de los encuestados paga por servicios que no usa.

También estaba ausente el caso de uso CU-31, que depende de esa transición.

### 1.2 «Pausar» ya no termina en el cementerio

La versión anterior hacía: Pausar → Definir fecha de reactivación → **Registrar ahorro → Cementerio de suscripciones**.

Eso es un error de lógica. Pausar no es cancelar: la suscripción sigue existiendo y va a volver. El cementerio de RF-14 es de suscripciones canceladas, y el ahorro se cuenta desde la cancelación.

Ahora «Definir fecha de reactivación» lleva al estado **Pausada**, dentro del ciclo de vida, y solo «Cancelada» alimenta el registro de ahorro.

### 1.3 «Pausada» existe como estado

Antes era solo una acción suelta, fuera del recuadro del ciclo de vida y sin retorno. El diagrama modelaba **cuatro de los seis estados**. Ahora están los seis: en prueba, activa, pausada, por confirmar, fantasma y cancelada.

### 1.4 Volvió la entrada de datos

«Suscripción creada» aparecía de la nada. Ahora el flujo arranca en **Origen del registro**, con las tres vías que permiten los requisitos:

- **Manual** — RF-02
- **CSV o PDF** — RF-19
- **Correo** — RF-05, pasando primero por la sanitización de PII de RN-23

Y se agregó lo que faltaba y es el corazón de RF-05: **el candidato queda pendiente hasta que el usuario lo confirme**. Si lo descarta, no se persiste; solo queda el hash de detección para no regenerarlo en la siguiente sincronización.

### 1.5 Aparecen las dos alertas más pedidas

La versión anterior mostraba doble cobro y alza de tarifa con nodo propio, pero escondía dentro de «Dashboard y alertas» las dos funciones **más demandadas del estudio**:

- **Próximo cobro** — 76,3% de demanda. RN-01 y RN-02, con sus dos plazos: 3 días para el mensual, 7 días y 24 horas para el anual
- **Fin de prueba gratuita** — 60,5%. RN-04, con la regla 48/24

Se agregó además el circuito de despacho que ningún diagrama mostraba: **¿la alerta está activa?** (RF-09) → **¿ya van 2 push hoy?** (RN-08) → **¿está entre las 22:00 y las 08:00?** (RN-09) → encolar para las 09:00 → enviar según criticidad (RN-10).

### 1.6 Se retiraron dos ramas sin requisito

| Rama retirada | Por qué |
|---|---|
| **Plan más barato** | Es la «Búsqueda avanzada de ofertas» que la sección 4.5 de la matriz recomendó retirar: ningún RF la describe y el proyecto no tiene fuente de datos de tarifas de terceros |
| **Predicción de gastos** | No aparece en ningún requisito funcional |

Si el equipo las quiere conservar, hay que escribirles un RF y decir de dónde salen los datos. Mientras tanto, quedan fuera: un nodo sin requisito es exactamente lo que el docente marcó como falta de trazabilidad.

Se agregó en cambio **«Clasificar gasto recurrente variable»** (RN-12, variación superior al 30%), que sí tiene regla y no estaba.

---

## 2. Las cuatro transiciones sin regla

El diagrama las dibuja con **flecha punteada y la etiqueta «regla por definir»**. No las inventa: las muestra como vacío declarado, que es lo correcto cuando la decisión es de negocio.

| Transición | Qué falta decidir |
|---|---|
| Fantasma → Activa | RN-15 define cómo se entra al estado, ninguna regla dice cómo se sale |
| Por confirmar → Activa | RN-19 despliega una verificación pasiva, pero solo está definido qué pasa si el usuario **no** responde |
| Activa → Pausada | Ninguna regla dice cómo se entra |
| Pausada → Activa | El diagrama de flujo del equipo hablaba de una «fecha de reactivación» que ninguna regla ni requisito define |

Las cuatro las tiene que resolver el Product Owner. Son las mismas que quedaron señaladas en la sección 6.1 de [`../REGLAS-DE-NEGOCIO.md`](../REGLAS-DE-NEGOCIO.md).

---

## 3. Cómo regenerarlo

El archivo `.mmd` es la fuente. Para volver a generar las imágenes:

```bash
cd "C:/Users/pc/Desktop/proyecto-suscripciones/docs/diagramas" && python -c "import io,json,zlib,base64,urllib.request,os; s=io.open('flujo-corregido.mmd',encoding='utf-8').read(); c=zlib.compressobj(9,zlib.DEFLATED,15); d=c.compress(json.dumps({'code':s,'mermaid':{'theme':'base'}}).encode())+c.flush(); k='pako:'+base64.urlsafe_b64encode(d).decode().rstrip('='); [open(p,'wb').write(urllib.request.urlopen(urllib.request.Request(f'https://mermaid.ink/{e}/{k}',headers={'User-Agent':'Mozilla/5.0'}),timeout=120).read()) for e,p in (('img','png/flujo-corregido.png'),('svg','png/flujo-corregido.svg'))]"
```

⚠ **Dos trampas del renderizador**, por si alguien edita el archivo:

- La primera línea **tiene que ser `flowchart TB`**. Si se pone un bloque de comentarios `%%` antes, el servidor devuelve error 400 sin explicar por qué.
- Una línea con `%%` sola, sin texto detrás, se dibuja como un nodo llamado «%%». Por eso los comentarios de este diagrama viven en este documento y no dentro del `.mmd`.

---

## 4. Sobre la disposición

Mermaid reparte los nodos automáticamente y el resultado queda alto y con cruces. **Eso no importa para la entrega**: al pegar el `.mmd` en Eraser, la herramienta vuelve a distribuir los nodos y se puede acomodar a mano.

El PNG y el SVG de esta carpeta sirven para revisar el contenido, no como versión final para el documento.
