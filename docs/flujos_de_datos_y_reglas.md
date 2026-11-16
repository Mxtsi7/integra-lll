# Flujos de Datos y Reglas

**Contenido:** consultas de suscripciones (Home), registro de uso y agregados, calendario de cobros, y consulta y descarte de recomendaciones.

---

# Flujo de Consultas de Suscripciones (Home)

## Paso 1 — Gateway y Contexto
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Gateway** | `gateway/app/identidad.py:37-69` | Comprueba firma, expiración, tipo de token y sesión vigente; devuelve `organizacion_id` |
| **Gateway** | `gateway/app/proxy.py:85-125` | Resuelve el servicio, descarta cabeceras del cliente, valida JWT, escribe cabeceras X- y quita `Authorization` |
| **Shared** | `shared/tenant/base.py:63-85` | Convierte esas cabeceras en `request.organizacion_id`, `request.usuario_id` y `request.rol` |

## Paso 2 — Filtro por Organización
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Shared** | `shared/tenant/base.py:112-116` | Filtra por `organizacion_id` en el ORM y responde 403 si falta el contexto |
| **Backend** | `services/subscriptions/app/views.py:449-457` | Parte de `activo=True` y deja los filtros de listado solo para la acción `list` |
| **Backend** | `services/subscriptions/app/views.py:459-486` | Aplica estado, fecha con alias `fecha_cobro` y búsqueda `nombre__icontains` (máx. 100 car.) |

## Paso 3 — Procesamiento en Backend
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/views.py:488-517` | Valida el orden contra una lista permitida (`nombre`, `monto`, `fecha_proximo_cobro`) y desempata por `id` |
| **Backend** | `services/subscriptions/app/views.py:245-257` | Pagina en servidor con 10 elementos por defecto y un máximo de 100 |
| **Backend** | `services/subscriptions/app/serializers.py:71-92` | Suma los minutos del mes local y devuelve las horas con dos decimales |

## Paso 4 — Respuesta JSON
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/serializers.py:58-69` | Declara explícitamente los campos expuestos en el payload JSON, marcando de forma estricta los identificadores, metadatos de organización, horas calculadas y campos derivados como estrictamente de solo lectura (`read_only`) |
| **Frontend** | `frontend/shared/src/api/suscripciones.ts:106-129` | `getSuscripciones()` consume el servicio paginado, recorre secuencialmente las páginas si es necesario, valida la consistencia del ordenamiento y normaliza los registros crudos en objetos tipados listos para la interfaz |
| **Frontend** | `frontend/shared/src/api/suscripciones.ts:91-97` | `parametrosDePagina()` serializa y codifica de manera segura los parámetros de consulta (`page`, `estado`, `fecha_cobro` y `orden`) utilizando `URLSearchParams` para evitar errores de sintaxis en la URL |

## Paso 5 — Renderizado en Home
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Frontend** | `frontend/web/src/pages/Homepage.tsx:136-141` | `normalizar()` pasa el texto de búsqueda a minúsculas y elimina acentos mediante normalización NFD |
| **Frontend** | `frontend/web/src/pages/Homepage.tsx:361-380` | `visibles` y `paginadas` aplican el filtro de búsqueda por `q`, dividen la lista en porciones de `PAGE_SIZE = 9` elementos y corrigen la página actual si queda fuera de rango |
| **Frontend** | `frontend/web/src/pages/Homepage.tsx:168` | `listado` almacena los datos de la respuesta en la memoria local junto con una clave única (`clave`), garantizando que la UI no mezcle datos de diferentes pestañas o consultas |
| **Frontend** | `frontend/web/src/pages/Homepage.tsx:846-853` | `<Pagination/>` dibuja los controles de paginación finales en la UI (avanzar, retroceder y número de páginas) recibiendo `currentPage`, `totalItems` y `pageSize` |

---

# Flujo de Registro de Uso y Agregados

## Paso 1 — Petición POST
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Frontend** | `frontend/web/src/components/subscriptions/RegistrarUsoForm.tsx:66-87` | `handleSubmit()` valida los minutos y la fecha en el cliente y bloquea el doble envío con la referencia `enviandoRef` antes de llamar a `onRegistrar()` |
| **Frontend** | `frontend/shared/src/api/suscripciones.ts:255-267` | `registrarUso()` omite la fecha vacía, arma el cuerpo `{ minutos }` o `{ minutos, fecha }` y lo envía al endpoint de uso de la suscripción |

## Paso 2 — Validación de Datos
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/serializers.py:184-207` | `RegistrarUsoSerializer` exige minutos enteros entre 1 y 44.640, hace la fecha opcional y `validate_fecha()` rechaza fechas posteriores a hoy |
| **Backend** | `services/subscriptions/app/views.py:1347-1348` | La acción `uso()` valida el payload con `RegistrarUsoSerializer` y responde 400 con los errores por campo si no cumple |

## Paso 3 — Persistencia de Evento
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/models.py:348-375` | `Subscription.registrar_uso()` abre `transaction.atomic()`, bloquea la fila con `select_for_update()`, verifica que la suscripción siga activa y crea el `RegistroUso` con la organización copiada |
| **Backend** | `services/subscriptions/app/views.py:1353-1366` | La acción `uso()` delega en `registrar_uso()` y responde con `SubscriptionSerializer`, devolviendo la suscripción completa y actualizada |

## Paso 4 — Actualización de Agregados
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/models.py:376-402` | `registrar_uso()` recalcula `horas_uso_mes` sumando los minutos del mes local desde `RegistroUso`, guarda el total con dos decimales y actualiza `ultima_actividad` |
| **Backend** | `services/subscriptions/app/models.py:360-366` | `registrar_uso()` detecta una suscripción en estado `FANTASMA` y la transiciona a `ACTIVO` con el evento `USO_REGISTRADO` |

## Paso 5 — Consulta GET Histórica
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/views.py:1342-1345` | La acción `uso()` en GET devuelve el historial de la suscripción ordenado por `-fecha` y `-creado_en`, sin paginar |
| **Frontend** | `frontend/shared/src/api/suscripciones.ts:246-248` | `getUsos()` solicita `/suscripciones/<id>/uso/` y devuelve la lista tipada de registros de uso |
| **Frontend** | `frontend/web/src/pages/SuscripcionDetallePage.tsx:171-191` | El efecto del historial carga los usos y descarta la respuesta si la suscripción cambió o la sesión dejó de ser vigente |

## Paso 6 — Refresco de Pantalla
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Frontend** | `frontend/web/src/pages/SuscripcionDetallePage.tsx:195-217` | `registrar()` aplica la suscripción devuelta con `mostrarRespuesta()` y llama a `recargarHistorial()` para volver a pedir la lista al backend |
| **Frontend** | `frontend/web/src/pages/SuscripcionDetallePage.tsx:108-140` | `operacionesRef`, `empezarOperacion()` y `terminarOperacion()` reservan la suscripción para que el registro de uso y la cancelación no se ejecuten a la vez |

---

# Flujo de Cálculo del Calendario de Cobros

## Paso 1 — Solicitud de Proyección
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Frontend** | `frontend/web/src/pages/CalendarioPage.tsx:25-43` | `CalendarioPage()` toma el mes de la URL, llama a `useCobrosDelMes()` y calcula el día visible y seleccionado |
| **Frontend** | `frontend/web/src/hooks/useCobrosDelMes.ts:21-45` | `useCobrosDelMes()` guarda el resultado junto al mes solicitado, descarta la respuesta de un mes anterior y expone los estados de carga, error y reintento |
| **Frontend** | `frontend/shared/src/api/calendario.ts:26-29` | `getCobrosDelMes()` valida el formato `YYYY-MM`, consulta el endpoint y convierte el `importe` de texto a número |

## Paso 2 — Consolidación de Datos
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/views.py:598-617` | `calendario_cobros()` valida el mes, calcula el rango completo y consulta los `Cobro` confirmados del tenant, incluidos los históricos de suscripciones dadas de baja |
| **Backend** | `services/subscriptions/app/views.py:630-655` | `calendario_cobros()` agrega proyecciones solo de suscripciones activas y no canceladas, desde hoy en adelante y sin duplicar una suscripción que ya tiene cobro confirmado en el mes |
| **Backend** | `services/subscriptions/app/views.py:117-145` | `_fecha_proyectada_en_mes()` calcula la ocurrencia mensual o anual conservando el día ancla y ajustándolo al último día del mes cuando hace falta |

## Paso 3 — Generación de Payload
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/subscriptions/app/serializers.py:218-227` | `CalendarioCobroSerializer` define el contrato con `id`, `suscripcion_id`, `fecha`, `servicio`, `importe`, `moneda` y `tipo` (`confirmado` o `proyectado`) |
| **Backend** | `services/subscriptions/app/views.py:657-665` | `calendario_cobros()` ordena los eventos por fecha, nombre del servicio e id antes de serializarlos |

## Paso 4 — Representación en UI
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Frontend** | `frontend/web/src/components/calendario/CuadriculaMes.tsx:45-54` | `CuadriculaMes()` agrupa los cobros por día en `cobrosPorDia` y expone cada día como un botón accesible por teclado |
| **Frontend** | `frontend/web/src/pages/AgendaPage.tsx:15-22` | `porDia()` agrupa los cobros por fecha; `AgendaPage()` reutiliza `useCobrosDelMes()` en las líneas `29-34` para mostrar los mismos datos que el calendario |
| **Frontend** | `frontend/web/src/pages/CalendarioPage.tsx:37-38` | `cobrosDelDia` filtra los cobros del mes por la fecha seleccionada y alimenta el detalle del día |

---

# Flujo de Consulta y Descarte de Recomendaciones

## Paso 1 — Filtro de Evidencia
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Gateway** | `gateway/app/proxy.py:56-82` | `comprobar_feature()` consulta los permisos del usuario y exige el plan vigente y el feature `recomendaciones_automaticas` antes de enviar la petición a Analytics |
| **Backend** | `services/analytics/analytics/views.py:311-325` | `recomendaciones_list()` filtra por organización y estado `vigente`, y excluye las recomendaciones con un descarte activo (`vigente_hasta` nulo o futuro) |
| **Backend** | `services/analytics/analytics/views.py:333-343` | `recomendaciones_list()` aplica el umbral de ahorro por moneda y descarta las sugerencias cuyo `ahorro_estimado` no alcanza el mínimo configurado |
| **Backend** | `services/analytics/analytics/reglas.py:26-46` | `umbrales_activos()` lee los registros de `UmbralAhorro` y devuelve el monto mínimo de cada moneda configurada, sin inventar un valor por defecto |
| **Backend** | `services/analytics/analytics/jobs.py:54-67` | `generar_recomendaciones_consolidacion()` exige solapamiento explícito, más de 45 días sin uso registrado y uso reciente en otro servicio del mismo grupo |

## Paso 2 — Respuesta con Ahorro
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Backend** | `services/analytics/analytics/serializers.py:65-98` | `RecomendacionConsolidacionSerializer` expone `motivo`, `ahorro_estimado`, `moneda`, `estado` y `evidencia` con id, URL y descripción |
| **Backend** | `services/analytics/analytics/views.py:357-374` | `recomendaciones_list()` arma la respuesta con `results`, `total`, `disponible`, `motivo_sin_sugerencias` y `umbrales_no_configurados` |
| **Backend** | `services/analytics/analytics/serializers.py:101-123` | `ListaRecomendacionesSerializer` fija la envoltura estable con `results` y los metadatos de umbral, disponibilidad y moneda |

## Paso 3 — Despliegue de Tarjetas
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Frontend** | `frontend/web/src/hooks/useRecomendaciones.ts:81-105` | `cargarRecomendaciones()` descarta las respuestas de una carga anterior y filtra las recomendaciones ya descartadas durante la visita |
| **Frontend** | `frontend/web/src/pages/RecomendacionesPage.tsx:40-55` | `RecomendacionesPage()` mapea cada recomendación de la lista a una `TarjetaRecomendacion` y muestra el estado vacío cuando no hay items |
| **Frontend** | `frontend/web/src/pages/RecomendacionesPage.tsx:91-130` | `TarjetaRecomendacion()` muestra el nombre, el motivo, el ahorro estimado, el enlace a la suscripción y el botón "No me interesa" con su estado de descarte |
| **Frontend** | `frontend/web/src/pages/RecomendacionesPage.tsx:61-83` | `SinRecomendaciones()` distingue entre "no hay recomendaciones por ahora" y "el servicio todavía no está disponible" usando `disponible` y el motivo del backend |

## Paso 4 — Persistencia de Descarte
| Capa | Archivo y Línea | Descripción |
| :--- | :--- | :--- |
| **Frontend** | `frontend/web/src/hooks/useRecomendaciones.ts:112-132` | `descartar()` bloquea el doble clic con `enviando`, envía el descarte y retira la tarjeta solo cuando el servidor confirma; si falla, conserva la tarjeta y muestra el error |
| **Frontend** | `frontend/shared/src/api/recomendaciones.ts:68-70` | `descartarRecomendacion()` hace POST a `/recomendaciones/<id>/dismiss/` sin cuerpo y devuelve la confirmación con `vigente_hasta` |
| **Backend** | `services/analytics/analytics/views.py:414-439` | `recomendaciones_dismiss()` valida el id y la organización, calcula `vigente_hasta` y ejecuta un `update_or_create` idempotente sobre el descarte |
| **Backend** | `services/analytics/analytics/models.py:421-462` | `RecomendacionDescartada` guarda `motivo`, `descartado_por` y `vigente_hasta`, con una restricción única por organización y recomendación |
