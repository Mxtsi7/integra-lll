# MX-22 — Matriz de requisitos, tareas y brechas

Fecha: 2026-10-21. Responsable: Maximiliano Sáez.
[Tarjeta MX-22](https://trello.com/c/mFzJLeUL) · [Reglas del tablero](https://trello.com/c/ox0X8Hpc).
Base comprobada: main 8679d5a91b980be0b57be3aa2c3f1f204bd5e32b.

## Fuente y límite documental

Las seis tarjetas índice del tablero conservan la línea del adjunto, responsable,
tarjeta y dependencias de cada entrada. Se reconstruyen **174 entradas originales**
(MX 27, CH 32, FE 29, VI 26, SE 32, AN 28) y se separan cuatro derivadas.
Los huecos de numeración son títulos/separadores del archivo, no tareas omitidas.
El [CSV](MX-22-matriz-tareas.csv) incluye también tipo y dependencias.

No se dispone aquí del archivo original Markdown pegado.md. Los índices permiten
trazar sus 174 entradas; no son una transcripción certificada del adjunto.
**Falta la “sección siguiente” de requisitos mínimos** citada por la línea 24
(MX-22). No se inventa su contenido ni se considera satisfecha esa sección.
Se debe recuperar para contrastar cualquier requisito adicional.
La captura de los índices es del 21 de octubre: no constituye el estado vivo
de implementación o aceptación de cada tarjeta.

## Numeración y criterio de correspondencia

Manda [requisitos-vigentes.md](requisitos-vigentes.md), no el número histórico
aislado. RF-01 se desglosa en registro .1, login .2, Google .3, recuperación .4,
perfil/clave .5, logout .6 y eliminación .7. RF-02 alta; RF-03 estados; RF-04 uso;
RF-05 detección/importación; RF-06 categoría; RF-07 anomalías; RF-08 edición;
RF-09 alertas; RF-10 cancelación/retiro; RF-11 panel; RF-12 calendario;
RF-13 presupuesto; RF-14 cementerio/ahorro; RF-15 CSV; RF-16 guía de cancelación;
RF-17 contratación Premium; RF-18 recomendaciones/asistente; RF-19 preview web;
RF-20 aislamiento.

| Referencia antigua por significado | Correspondencia vigente |
|---|---|
| Alta con monto/periodicidad referida como RF-06 | RF-02; RF-06 vigente trata categorías |
| Categorías referidas como RF-12 | RF-06; RF-12 vigente trata calendario |
| Estados referidos como RF-13 | RF-03; RF-13 vigente trata presupuesto |
| Explicación IA referida como RF-25 | RF-18; no existe un RF-25 vigente |
| Aislamiento referido como RF-26 | RF-20 |

Las correspondencias se aplican por el comportamiento descrito, no como un
reemplazo numérico global. RN es regla de negocio, RNF requisito no funcional:
no intercambiarlos. [RN-24 y RN-25 históricos](../historico/REGLAS-DE-NEGOCIO.md)
complementan RF-05/18: timeout IA 3,5 s y mismo PDF tres intentos/día/usuario.
RNF-20 vigente añade 200 llamadas/usuario/mes y evaluación real de costos.
TRANSVERSAL identifica infraestructura, estudio o calidad sin RF único; no crea
un requisito nuevo. La matriz expresa cobertura prevista, no prueba de cumplimiento.

## Plataformas y decisiones pendientes

- API compartida: reutilizable por los clientes cuando implementen su contrato.
  No implica que una pantalla móvil/Windows ya esté integrada.
- Web y móvil mantienen sus interfaces en React y Expo según ADR-006.
- Windows: [PR #92](https://github.com/Mxtsi7/integra-lll/pull/92) propone Electron,
  abre React y consulta Gateway real. SE-04 recibe el punto de integración del
  calendario; no se declara calendario entregado ni aceptación de Sebastian.
- ADR-006 conserva el contexto de su decisión original. El tablero amplía Windows
  y OAuth móvil; el contrato OAuth móvil se valida en su entrega, no se descarta
  por la anterior exclusividad web.
- Precio Premium y pasarela: #85–88 usan precios/checkout de demostración
  identificados. Se requiere decisión comercial y proveedor real antes de cobros.
- RNF-09 (carga IA), RNF-20 (costo real), recepción de contratos y revisión ajena
  no se acreditan con pruebas unitarias o CI.
- RF-14 y RF-16 siguen siendo requisitos vigentes aunque estas 174 entradas no
  asignen una entrega completa explícita; registrar esa brecha, no inventar tareas
  ni declarar que desaparecen del alcance.

## 174 entradas originales

| Línea | Tarea / tarjeta | Responsable | Requisito vigente | Alcance |
|---|---|---|---|---|
| 3 | [MX-01: Revisar PR de backend, contratos e integración](https://trello.com/c/EQ0vkrHA) | Maximiliano Sáez | TRANSVERSAL | Transversal |
| 4 | [MX-02: Solicitar recuperación de contraseña](https://trello.com/c/HO7dEi6N) | Maximiliano Sáez | RF-01.4 | API compartida |
| 5 | [MX-03: Confirmar recuperación y establecer nueva contraseña](https://trello.com/c/DCZS7Z6i) | Maximiliano Sáez | RF-01.4 | API compartida |
| 6 | [MX-04: Resolver tokens de recuperación vencidos, inválidos y usados](https://trello.com/c/pcOZ8DyP) | Maximiliano Sáez | RF-01.4 | API compartida |
| 7 | [MX-05: Cambiar contraseña desde una sesión autenticada](https://trello.com/c/up0nSpgG) | Maximiliano Sáez | RF-01.5 | API compartida |
| 8 | [MX-06: Actualizar nombre del perfil y contrato de correo](https://trello.com/c/5kr9ZaP8) | Maximiliano Sáez | RF-01.5 | API compartida |
| 9 | [MX-07: Eliminar cuenta y coordinar limpieza entre servicios](https://trello.com/c/50Mkov2i) | Maximiliano Sáez | RF-01.7; RF-20 | API compartida |
| 10 | [MX-08: Exponer plan vigente en el perfil](https://trello.com/c/rM7nrprc) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 11 | [MX-09: Definir permisos y features por plan](https://trello.com/c/cP9ziws6) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 12 | [MX-10: Completar refresh, rotación y revocación de tokens](https://trello.com/c/dlybrwRf) | Maximiliano Sáez | RF-01.6; RF-20 | API compartida |
| 13 | [MX-11: Estudiar e implementar acceso con Google](https://trello.com/c/o9pCDLIM) | Maximiliano Sáez | RF-01.3 | API compartida |
| 14 | [MX-12: Ampliar pruebas de registro y organización](https://trello.com/c/MWCPTdFH) | Maximiliano Sáez | RF-01.1; RF-20 | API compartida |
| 15 | [MX-13: Verificar aislamiento de usuarios y organizaciones](https://trello.com/c/3RpH5SWy) | Maximiliano Sáez | RF-20 | API compartida |
| 16 | [MX-14: Documentar nuevos contratos Auth en OpenAPI](https://trello.com/c/USauKRiT) | Maximiliano Sáez | RF-01; RF-17 | API compartida |
| 17 | [MX-15: Modelar planes y estados de contratación](https://trello.com/c/bKmWM5xh) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 18 | [MX-16: Listar planes y precios](https://trello.com/c/JxKWL5Wp) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 19 | [MX-17: Iniciar contratación mediante pasarela o mock](https://trello.com/c/mhEXuxIA) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 20 | [MX-18: Confirmar pagos con webhook idempotente](https://trello.com/c/GR6fDDrU) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 21 | [MX-19: Sincronizar features tras cambios de contratación](https://trello.com/c/lN3zwhlC) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 22 | [MX-20: Probar contratación y autorización por plan](https://trello.com/c/KC6lAfT3) | Maximiliano Sáez | RF-17; RF-20 | API compartida |
| 23 | [MX-21: Acordar contratos RabbitMQ y validar intercambio](https://trello.com/c/DgW1gqBf) | Maximiliano Sáez | TRANSVERSAL | Transversal |
| 24 | [MX-22: Documentar matriz de requisitos y brechas](https://trello.com/c/mFzJLeUL) | Maximiliano Sáez | TRANSVERSAL | Transversal |
| 25 | [MX-23: Elegir y levantar cliente desktop Windows](https://trello.com/c/Ll8g4eCM) | Maximiliano Sáez | TRANSVERSAL | Windows |
| 26 | [MX-24: Aplicar timeout IA y límites de ingesta](https://trello.com/c/Ehiy29mN) | Maximiliano Sáez | RF-05; RF-18; RN-24; RN-25; RNF-20 | API compartida |
| 27 | [MX-25: Explicar recomendaciones en lenguaje natural](https://trello.com/c/LWr1b2G7) | Maximiliano Sáez | RF-18 | API compartida |
| 28 | [MX-26: Probar recomendaciones y degradación sin uso](https://trello.com/c/IQOxqtLx) | Maximiliano Sáez | RF-18 | API compartida |
| 29 | [MX-27: Crear seed y simulación de registros de uso](https://trello.com/c/WR5yF8UG) | Maximiliano Sáez | RF-04 | API compartida |
| 31 | [CH-01: Proteger rutas privadas web](https://trello.com/c/8aJVV5UO) | Christopher Solis | RF-01.2; RF-20 | Web |
| 32 | [CH-02: Restaurar sesión web al recargar](https://trello.com/c/RasULQIn) | Christopher Solis | RF-01.2; RF-20 | Web |
| 33 | [CH-03: Añadir cierre de sesión completo en web](https://trello.com/c/u74y9ZVQ) | Christopher Solis | RF-01.6 | Web |
| 34 | [CH-04: Alinear validaciones de registro web](https://trello.com/c/45sQgIF5) | Christopher Solis | RF-01.1 | Web |
| 35 | [CH-05: Mostrar u ocultar contraseña en Login y Registro](https://trello.com/c/sfQv7EGW) | Christopher Solis | RF-01.1; RF-01.2 | Web |
| 36 | [CH-06: Solicitar recuperación de contraseña desde web](https://trello.com/c/xoFbp7JM) | Christopher Solis | RF-01.4 | Web |
| 37 | [CH-07: Restablecer contraseña y resolver enlace inválido en web](https://trello.com/c/f6rh8kNq) | Christopher Solis | RF-01.4 | Web |
| 38 | [CH-08: Editar nombre desde Perfil web](https://trello.com/c/gsvVYIGY) | Christopher Solis | RF-01.5 | Web |
| 39 | [CH-09: Completar validaciones del formulario de creación web](https://trello.com/c/G1nXsxJi) | Christopher Solis | RF-02 | Web |
| 40 | [CH-10: Cancelar suscripción desde web sin borrarla](https://trello.com/c/5OQnSioe) | Christopher Solis | RF-03; RF-10 | Web |
| 41 | [CH-11: Conectar filtros web de estado y fecha](https://trello.com/c/3mpj2oPW) | Christopher Solis | RF-02; RF-03 | Web |
| 42 | [CH-12: Ordenar suscripciones web](https://trello.com/c/oawT2niZ) | Christopher Solis | RF-02; RF-03 | Web |
| 43 | [CH-13: Limpiar filtros y distinguir búsqueda sin coincidencias](https://trello.com/c/hS8MSBDo) | Christopher Solis | RF-02; RF-03 | Web |
| 44 | [CH-14: Registrar minutos de uso desde Detalle web](https://trello.com/c/4Z77IYH6) | Christopher Solis | RF-04 | Web |
| 45 | [CH-15: Mostrar historial de uso web por fecha](https://trello.com/c/kb1AN6uo) | Christopher Solis | RF-04 | Web |
| 46 | [CH-16: Avisar cambios sin guardar en formularios web](https://trello.com/c/kevH5711) | Christopher Solis | RF-02; RF-08 | Web |
| 47 | [CH-17: Construir página web Calendario](https://trello.com/c/W2OvNtMD) | Christopher Solis | RF-12 | Web |
| 48 | [CH-18: Ubicar cobros en cada fecha del calendario web](https://trello.com/c/8jyFr5IX) | Christopher Solis | RF-12 | Web |
| 49 | [CH-19: Navegar meses y volver a hoy en web](https://trello.com/c/eIMmEazV) | Christopher Solis | RF-12 | Web |
| 50 | [CH-20: Mostrar detalle del día seleccionado](https://trello.com/c/xGR9OY7I) | Christopher Solis | RF-12 | Web |
| 51 | [CH-21: Crear agenda web de próximos cobros](https://trello.com/c/TSgKhV0n) | Christopher Solis | RF-12 | Web |
| 52 | [CH-22: Integrar motivo y ahorro en recomendaciones web](https://trello.com/c/7IQ4ZAoh) | Christopher Solis | RF-18 | Web |
| 53 | [CH-23: Preparar ruta y estructura web de Cuentas conectadas](https://trello.com/c/Zqv6DKcj) | Christopher Solis | RF-05 | Web |
| 54 | [CH-24: Verificar y completar modo oscuro web](https://trello.com/c/rFxdHZ4T) | Christopher Solis | TRANSVERSAL | Web |
| 55 | [CH-25: Mejorar accesibilidad de formularios y modales](https://trello.com/c/oAPwjANk) | Christopher Solis | TRANSVERSAL | Web |
| 56 | [CH-26: Integrar estado vacío de Recomendaciones web](https://trello.com/c/2XVDQmOT) | Christopher Solis | RF-18 | Web |
| 57 | [CH-27: Mostrar progreso de importación de documentos](https://trello.com/c/VpNyZtdX) | Christopher Solis | RF-05; RF-19 | Web |
| 58 | [CH-28: Revisar PR del frontend y contratos compartidos](https://trello.com/c/tVFFqff7) | Christopher Solis | TRANSVERSAL | Web |
| 59 | [CH-29: Cambiar contraseña desde Configuración web](https://trello.com/c/V6perYcs) | Christopher Solis | RF-01.5 | Web |
| 60 | [CH-30: Configurar canales y tipos de alertas en web](https://trello.com/c/amcHK31A) | Christopher Solis | RF-09 | Web |
| 61 | [CH-31: Integrar filtros, lectura y contador en alertas web](https://trello.com/c/Ehc2wPV8) | Christopher Solis | RF-09 | Web |
| 62 | [CH-32: Descartar recomendaciones desde web](https://trello.com/c/MoVZesZf) | Christopher Solis | RF-18 | Web |
| 64 | [FE-01: Modelar cuentas conectadas por organización](https://trello.com/c/buNv3GqZ) | Felipe Orellana | RF-05; RF-20 | API / operación compartida |
| 65 | [FE-02: Listar cuentas conectadas y su estado](https://trello.com/c/r7Naqppy) | Felipe Orellana | RF-05; RF-20 | API / operación compartida |
| 66 | [FE-03: Iniciar OAuth de Gmail o Outlook](https://trello.com/c/LNHraYWk) | Felipe Orellana | RF-05; RF-20 | API / operación compartida |
| 67 | [FE-04: Procesar callback OAuth y guardar credenciales](https://trello.com/c/KQpZp8dA) | Felipe Orellana | RF-05; RF-20 | API / operación compartida |
| 68 | [FE-05: Desconectar cuenta y revocar acceso](https://trello.com/c/vWLCdptN) | Felipe Orellana | RF-05; RF-20 | API / operación compartida |
| 69 | [FE-06: Cifrar tokens de conectores y gestionar claves](https://trello.com/c/WlzGQCY9) | Felipe Orellana | RF-05; RF-20 | API / operación compartida |
| 70 | [FE-07: Validar y recibir archivos CSV y cartolas](https://trello.com/c/tV3Z3NSh) | Felipe Orellana | RF-05; RF-19 | API / operación compartida |
| 71 | [FE-08: Modelar importaciones y exponer su progreso](https://trello.com/c/b5S7T4F3) | Felipe Orellana | RF-05; RF-19 | API / operación compartida |
| 72 | [FE-09: Procesar CSV y detectar cobros recurrentes](https://trello.com/c/Fg6Ahh6t) | Felipe Orellana | RF-05; RF-19 | API / operación compartida |
| 73 | [FE-10: Previsualizar cobros detectados](https://trello.com/c/wEyBQl1F) | Felipe Orellana | RF-05; RF-19 | API / operación compartida |
| 74 | [FE-11: Confirmar candidatos y crear o actualizar suscripciones](https://trello.com/c/e9NEuzGF) | Felipe Orellana | RF-05; RF-19 | API / operación compartida |
| 75 | [FE-12: Normalizar nombres de proveedores](https://trello.com/c/b715JBnS) | Felipe Orellana | RF-05 | API / operación compartida |
| 76 | [FE-13: Leer correo con límites y sanitización](https://trello.com/c/tvqX9hCl) | Felipe Orellana | RF-05 | API / operación compartida |
| 77 | [FE-14: Gestionar errores de conectores y reautorización](https://trello.com/c/FkIFKmro) | Felipe Orellana | RF-05 | API / operación compartida |
| 78 | [FE-15: Probar OAuth e importación con mocks](https://trello.com/c/rMJsQZoM) | Felipe Orellana | RF-05 | API / operación compartida |
| 79 | [FE-16: Modelar alertas y estados de lectura](https://trello.com/c/i5DbjtUy) | Felipe Orellana | RF-09 | API / operación compartida |
| 80 | [FE-17: Generar alertas de próximos cobros](https://trello.com/c/PnmyWai0) | Felipe Orellana | RF-09 | API / operación compartida |
| 81 | [FE-18: Generar avisos de fin de prueba gratuita](https://trello.com/c/11MyWDFn) | Felipe Orellana | RF-09 | API / operación compartida |
| 82 | [FE-19: Listar alertas con filtro y paginación](https://trello.com/c/S4Q2TMgo) | Felipe Orellana | RF-09 | API / operación compartida |
| 83 | [FE-20: Marcar alertas leídas y consultar contador](https://trello.com/c/zJswjNNC) | Felipe Orellana | RF-09 | API / operación compartida |
| 84 | [FE-21: Leer y guardar preferencias de notificación](https://trello.com/c/NEwMlEHd) | Felipe Orellana | RF-09 | API / operación compartida |
| 85 | [FE-22: Respetar límite diario push y horario de descanso](https://trello.com/c/1eRM6IlO) | Felipe Orellana | RF-09 | API / operación compartida |
| 86 | [FE-23: Anular alertas pendientes cuando cambia la suscripción](https://trello.com/c/57OUDmhC) | Felipe Orellana | RF-09 | API / operación compartida |
| 87 | [FE-24: Conectar Notifications con RabbitMQ](https://trello.com/c/KVs2FHQq) | Felipe Orellana | RF-09 | API / operación compartida |
| 88 | [FE-25: Probar alertas, preferencias y límites](https://trello.com/c/lcVQJgSg) | Felipe Orellana | RF-09 | API / operación compartida |
| 89 | [FE-26: Revisar PR de conectores y notificaciones](https://trello.com/c/oNA1gbVG) | Felipe Orellana | TRANSVERSAL | API / operación compartida |
| 90 | [FE-27: Documentar operación del lector de correo y permisos](https://trello.com/c/jANO777x) | Felipe Orellana | RF-05 | API / operación compartida |
| 91 | [FE-28: Agregar uso por periodo en Analytics](https://trello.com/c/63vEhZW0) | Felipe Orellana | RF-04; RF-18 | API / operación compartida |
| 92 | [FE-29: Calcular puntaje de uso y señalar posible bajo uso](https://trello.com/c/Bcm3lH7v) | Felipe Orellana | RF-04; RF-18 | API / operación compartida |
| 94 | [VI-01: Añadir búsqueda por nombre al listado](https://trello.com/c/acTJGaJ2) | Victor Gonzales | RF-02 | API / operación compartida |
| 95 | [VI-02: Ordenar suscripciones en servidor](https://trello.com/c/oZhA4zru) | Victor Gonzales | RF-02 | API / operación compartida |
| 96 | [VI-03: Cancelar suscripción sin hacer soft-delete](https://trello.com/c/UqvYhFaM) | Victor Gonzales | RF-03; RF-10 | API / operación compartida |
| 97 | [VI-04: Consultar historial de cobros por suscripción](https://trello.com/c/b7IwUpsW) | Victor Gonzales | RF-05 | API / operación compartida |
| 98 | [VI-05: Definir presupuesto mensual y comparar proyección](https://trello.com/c/lvpGgSMo) | Victor Gonzales | RF-13 | API / operación compartida |
| 99 | [VI-06: Exponer resumen agregado del panel](https://trello.com/c/hLihvoFr) | Victor Gonzales | RF-11 | API / operación compartida |
| 100 | [VI-07: Exponer calendario de cobros por mes](https://trello.com/c/sN6AkV1V) | Victor Gonzales | RF-12 | API / operación compartida |
| 101 | [VI-08: Precisar e implementar máquina de estados](https://trello.com/c/tzFyAKmf) | Victor Gonzales | RF-03 | API / operación compartida |
| 102 | [VI-09: Reactivar o confirmar un cobro detectado](https://trello.com/c/dhUYBgLf) | Victor Gonzales | RF-03 | API / operación compartida |
| 103 | [VI-10: Completar uso, agregados mensuales y última actividad](https://trello.com/c/zGMe27Ed) | Victor Gonzales | RF-04 | API / operación compartida |
| 104 | [VI-11: Probar ciclo de vida y soft-delete](https://trello.com/c/vgTWw7Td) | Victor Gonzales | RF-03; RF-10; RF-20 | API / operación compartida |
| 105 | [VI-12: Documentar filtros, orden y paginación en OpenAPI](https://trello.com/c/xx2hLRVM) | Victor Gonzales | RF-02 | API / operación compartida |
| 106 | [VI-13: Levantar todos los servicios con healthchecks](https://trello.com/c/3FEwdub4) | Victor Gonzales | TRANSVERSAL | API / operación compartida |
| 107 | [VI-14: Preparar entorno backend para app móvil](https://trello.com/c/YCvcIhbg) | Victor Gonzales | TRANSVERSAL | API / operación compartida |
| 108 | [VI-15: Documentar y verificar Docker en Windows](https://trello.com/c/t1Zx3p2l) | Victor Gonzales | TRANSVERSAL | API / operación compartida |
| 109 | [VI-16: Verificar conexión real móvil–backend](https://trello.com/c/l1zvDwFB) | Victor Gonzales | TRANSVERSAL | API / operación compartida |
| 110 | [VI-17: Listar recomendaciones, motivo y ahorro](https://trello.com/c/UH8sY3ox) | Victor Gonzales | RF-18 | API / operación compartida |
| 111 | [VI-18: Descartar recomendaciones](https://trello.com/c/vRoim5xk) | Victor Gonzales | RF-18 | API / operación compartida |
| 112 | [VI-19: Detectar alza de tarifa y posible doble cobro](https://trello.com/c/8RXrZGeX) | Victor Gonzales | RF-07; RF-09 | API / operación compartida |
| 113 | [VI-20: Recomendar consolidación por categoría](https://trello.com/c/4YOUjM59) | Victor Gonzales | RF-18 | API / operación compartida |
| 114 | [VI-21: Aplicar umbral mínimo de ahorro](https://trello.com/c/a7dFwbZL) | Victor Gonzales | RF-18 | API / operación compartida |
| 115 | [VI-22: Implementar proxy del asistente financiero Premium](https://trello.com/c/gyMbvJyK) | Victor Gonzales | RF-17; RF-18 | API / operación compartida |
| 116 | [VI-23: Sanitizar contexto antes de enviar a IA](https://trello.com/c/tYTnJ2pr) | Victor Gonzales | RF-18; RF-20 | API / operación compartida |
| 117 | [VI-24: Mejorar wrapper de IA y limitar llamadas](https://trello.com/c/SiR7NyEs) | Victor Gonzales | RF-18; RN-24; RNF-20 | API / operación compartida |
| 118 | [VI-25: Exportar cobros y suscripciones del periodo en CSV](https://trello.com/c/7HpYL5Cl) | Victor Gonzales | RF-15 | API / operación compartida |
| 119 | [VI-26: Publicar eventos de dominio de suscripciones](https://trello.com/c/7zMEZHt0) | Victor Gonzales | TRANSVERSAL | API / operación compartida |
| 121 | [SE-01: Construir estructura del Centro web de alertas](https://trello.com/c/QPSuIkdU) | Sebastian Mena | RF-09 | Web |
| 122 | [SE-02: Mostrar restricciones Premium en web](https://trello.com/c/h550BZbL) | Sebastian Mena | RF-17 | Web |
| 123 | [SE-03: Implementar estados de contratación Premium en web](https://trello.com/c/QKhoOJiU) | Sebastian Mena | RF-17 | Web |
| 124 | [SE-04: Integrar calendario en el cliente Windows](https://trello.com/c/7BqFZ3EY) | Sebastian Mena | RF-12 | Windows |
| 125 | [SE-05: Inicializar app móvil Expo y comprobar arranque](https://trello.com/c/9hDu662U) | Sebastian Mena | TRANSVERSAL | Móvil |
| 126 | [SE-06: Configurar navegación principal móvil](https://trello.com/c/IqFU388Q) | Sebastian Mena | TRANSVERSAL | Móvil |
| 127 | [SE-07: Configurar cliente HTTP móvil por entorno](https://trello.com/c/pOMTSbSu) | Sebastian Mena | TRANSVERSAL | Móvil |
| 128 | [SE-08: Implementar almacenamiento seguro y sesión móvil](https://trello.com/c/0209aDl9) | Sebastian Mena | RF-01.2; RF-20 | Móvil |
| 129 | [SE-09: Construir pantalla móvil Iniciar sesión](https://trello.com/c/RAyxXTB0) | Sebastian Mena | RF-01.2 | Móvil |
| 130 | [SE-10: Conectar Login móvil con Auth](https://trello.com/c/xk8uvKE7) | Sebastian Mena | RF-01.2 | Móvil |
| 131 | [SE-11: Construir pantalla móvil Registro](https://trello.com/c/qiCX7XzC) | Sebastian Mena | RF-01.1 | Móvil |
| 132 | [SE-12: Conectar Registro móvil y validaciones del servidor](https://trello.com/c/OZkuXEKU) | Sebastian Mena | RF-01.1 | Móvil |
| 133 | [SE-13: Mostrar cuenta creada y continuar a Login móvil](https://trello.com/c/XgWXXap5) | Sebastian Mena | RF-01.1 | Móvil |
| 134 | [SE-14: Solicitar recuperación desde móvil](https://trello.com/c/qqlELTeB) | Sebastian Mena | RF-01.4 | Móvil |
| 135 | [SE-15: Cerrar sesión y limpiar datos privados en móvil](https://trello.com/c/4UasOTuF) | Sebastian Mena | RF-01.6 | Móvil |
| 136 | [SE-16: Volver a Login cuando la sesión móvil no sea válida](https://trello.com/c/vX3FKzw7) | Sebastian Mena | RF-01.2; RF-20 | Móvil |
| 137 | [SE-17: Construir Home móvil de suscripciones](https://trello.com/c/d48mufb1) | Sebastian Mena | RF-02 | Móvil |
| 138 | [SE-18: Crear tarjeta móvil de suscripción](https://trello.com/c/cFFNwiOl) | Sebastian Mena | RF-02 | Móvil |
| 139 | [SE-19: Conectar listado móvil paginado](https://trello.com/c/7rn6rOqr) | Sebastian Mena | RF-02 | Móvil |
| 140 | [SE-20: Mostrar vacío móvil y acceso a primera suscripción](https://trello.com/c/toaWAanB) | Sebastian Mena | RF-02 | Móvil |
| 141 | [SE-21: Construir Detalle móvil de suscripción](https://trello.com/c/bd9E5mBT) | Sebastian Mena | RF-02 | Móvil |
| 142 | [SE-22: Crear formulario móvil de nueva suscripción](https://trello.com/c/OPBoG41Q) | Sebastian Mena | RF-02 | Móvil |
| 143 | [SE-23: Conectar creación móvil y actualizar listado](https://trello.com/c/V47DRMKU) | Sebastian Mena | RF-02 | Móvil |
| 144 | [SE-24: Crear formulario móvil de edición](https://trello.com/c/bRGjlAM4) | Sebastian Mena | RF-08 | Móvil |
| 145 | [SE-25: Conectar PATCH móvil y actualizar detalle](https://trello.com/c/u1DwU8tq) | Sebastian Mena | RF-08 | Móvil |
| 146 | [SE-26: Confirmar retiro y ejecutar DELETE móvil](https://trello.com/c/ahoZdXYv) | Sebastian Mena | RF-10 | Móvil |
| 147 | [SE-27: Aplicar filtros móviles por estado y fecha](https://trello.com/c/IxYRhHLp) | Sebastian Mena | RF-02 | Móvil |
| 148 | [SE-28: Registrar minutos de uso desde móvil](https://trello.com/c/vkvaNKHf) | Sebastian Mena | RF-04 | Móvil |
| 149 | [SE-29: Ordenar listado móvil y mostrar criterio](https://trello.com/c/V3K2mDjk) | Sebastian Mena | RF-02 | Móvil |
| 150 | [SE-30: Mostrar historial móvil de uso por fecha](https://trello.com/c/RCLbTxsE) | Sebastian Mena | RF-04 | Móvil |
| 151 | [SE-31: Avisar cambios sin guardar en móvil](https://trello.com/c/UHEjiCc8) | Sebastian Mena | RF-02; RF-08 | Móvil |
| 152 | [SE-32: Configurar preferencias de notificación móvil](https://trello.com/c/65tJtsAy) | Sebastian Mena | RF-09 | Móvil |
| 156 | [AN-01: Conectar resumen de gasto del Panel móvil](https://trello.com/c/vy9kprqY) | Andrea Travola | RF-11 | Móvil |
| 157 | [AN-02: Visualizar gastos móviles con alternativa textual](https://trello.com/c/dSRJFYjg) | Andrea Travola | RF-11 | Móvil |
| 158 | [AN-03: Mostrar y editar Perfil móvil](https://trello.com/c/npqDyS0f) | Andrea Travola | RF-01.5 | Móvil |
| 159 | [AN-04: Construir Configuración móvil](https://trello.com/c/wIdimCde) | Andrea Travola | TRANSVERSAL | Móvil |
| 160 | [AN-05: Maquetar Recomendaciones móviles y detalle](https://trello.com/c/9PVOeWba) | Andrea Travola | RF-18 | Móvil |
| 161 | [AN-06: Mostrar cuentas conectadas en móvil](https://trello.com/c/cRKUn7r3) | Andrea Travola | RF-05 | Móvil |
| 162 | [AN-07: Construir calendario y agenda móviles](https://trello.com/c/Mx4AUswP) | Andrea Travola | RF-12 | Móvil |
| 163 | [AN-08: Mostrar planes y contratación Premium móvil](https://trello.com/c/G8WRcx9M) | Andrea Travola | RF-17 | Móvil |
| 164 | [AN-09: Iniciar autorización de correo desde móvil](https://trello.com/c/sv09xMv9) | Andrea Travola | RF-05 | Móvil |
| 165 | [AN-10: Construir Centro móvil de alertas](https://trello.com/c/NNmweOpt) | Andrea Travola | RF-09 | Móvil |
| 166 | [AN-11: Mostrar restricciones Premium móviles](https://trello.com/c/NkYAT7cK) | Andrea Travola | RF-17 | Móvil |
| 167 | [AN-12: Verificar correo desde la app móvil](https://trello.com/c/pDYJXBnu) | Andrea Travola | RF-01.1; RF-01.5 | Móvil |
| 168 | [AN-13: Verificar correo desde web](https://trello.com/c/JXcRumua) | Andrea Travola | RF-01.1; RF-01.5 | Web |
| 169 | [AN-14: Preparar UX y componentes de recuperación web](https://trello.com/c/j2JEE0qA) | Andrea Travola | RF-01.4 | Web |
| 170 | [AN-15: Iniciar conexión Gmail/Outlook desde web](https://trello.com/c/D7LInCPk) | Andrea Travola | RF-05 | Web |
| 171 | [AN-16: Mostrar retorno OAuth en web](https://trello.com/c/3jYHgKTg) | Andrea Travola | RF-05 | Web |
| 172 | [AN-17: Integrar listado y desconexión de cuentas web](https://trello.com/c/NXXfxTqp) | Andrea Travola | RF-05 | Web |
| 173 | [AN-18: Implementar borrado de cuenta en web](https://trello.com/c/rWE1hZqB) | Andrea Travola | RF-01.7 | Web |
| 174 | [AN-19: Implementar borrado de cuenta en móvil](https://trello.com/c/CWYMRwIS) | Andrea Travola | RF-01.7 | Móvil |
| 175 | [AN-20: Construir página web de Recomendaciones](https://trello.com/c/7RPNKw5a) | Andrea Travola | RF-18 | Web |
| 176 | [AN-21: Integrar página móvil de Recomendaciones](https://trello.com/c/4S4wS8rM) | Andrea Travola | RF-18 | Móvil |
| 177 | [AN-22: Construir Informes web por periodo](https://trello.com/c/yFQhVhNE) | Andrea Travola | RF-11; RF-15 | Web |
| 178 | [AN-23: Construir Informes móviles por periodo](https://trello.com/c/eKV62lcI) | Andrea Travola | RF-11; RF-15 | Móvil |
| 179 | [AN-24: Integrar lectura y badge en alertas móviles](https://trello.com/c/AH77Jku7) | Andrea Travola | RF-09 | Móvil |
| 180 | [AN-25: Descartar recomendaciones desde móvil](https://trello.com/c/MlYxzLQA) | Andrea Travola | RF-18 | Móvil |
| 181 | [AN-26: Compartir o guardar resumen de gastos móvil](https://trello.com/c/2MBDSzTk) | Andrea Travola | RF-11; RF-15 | Móvil |
| 182 | [AN-27: Capturar callback OAuth móvil y mostrar resultado](https://trello.com/c/nxexYbrl) | Andrea Travola | RF-05 | Móvil |
| 183 | [AN-28: Crear estados reutilizables para pantallas móviles](https://trello.com/c/gwScgJMJ) | Andrea Travola | TRANSVERSAL | Móvil |

## Prerrequisitos derivados — fuera de las 174 entradas

| Línea | Tarea / tarjeta | Responsable | Requisito vigente | Alcance |
|---|---|---|---|---|
| DERIVADA | [MX-28: Implementar contrato backend de verificación de correo](https://trello.com/c/iJ5pbI0q) | Maximiliano Sáez | RF-01.1; RF-01.5 | API compartida |
| DERIVADA | [MX-29: Revocar sesión en backend al cerrar sesión](https://trello.com/c/LKvkdcZ9) | Maximiliano Sáez | RF-01.6; RF-20 | API compartida |
| DERIVADA | [MX-30: Alinear política de contraseña del backend](https://trello.com/c/fSEc3EdJ) | Maximiliano Sáez | RF-01.1; RF-01.4; RF-01.5 | API compartida |
| DERIVADA | [VI-27: Crear bases ejecutables de Connectors, Analytics y Notifications](https://trello.com/c/c6WkBP1E) | Victor Gonzales | TRANSVERSAL | API / operación compartida |

## Entregas de Maximiliano y bloqueos comprobados

| Tareas | Evidencia / decisión |
|---|---|
| MX-02/03/04, MX-30 | Ya en GitHub: #60 y #55; no duplicar |
| MX-05/06, MX-10/29 | Ya integradas: #69 y #68 |
| MX-28, MX-11 | Integradas durante esta ejecución: #70 y #71 |
| MX-07 | #72 draft; falta revocación externa FE-05. No borrar credenciales para simular esa revocación |
| MX-12/13 | #73; conserva dependencia de eliminación |
| MX-08/15 | [#85](https://github.com/Mxtsi7/integra-lll/pull/85), Maxi-planes |
| MX-09/16 | [#86](https://github.com/Mxtsi7/integra-lll/pull/86), Maxi-permisos-planes, base #85 |
| MX-17/18 | [#87](https://github.com/Mxtsi7/integra-lll/pull/87), Maxi-contratacion, base #86 |
| MX-19/20 | [#88](https://github.com/Mxtsi7/integra-lll/pull/88), Maxi-pruebas-planes, base #87 |
| MX-21 | #79 existe; recepción de Victor/Felipe sigue pendiente |
| MX-24 | [#89](https://github.com/Mxtsi7/integra-lll/pull/89): componente sobre VI-27; integrar en consumidores, sanitizar VI-23 y reconciliar purga con #72 antes de IA real |
| MX-23 | [#92](https://github.com/Mxtsi7/integra-lll/pull/92): base Windows y ADR para revisión |
| MX-01/22 | Esta rama: registro de revisión y matriz; revisión ajena al autor pendiente |
| MX-14 | Bloqueada su consolidación final por eliminación/FE-05 y contratos en distintas ramas. Cada entrega mantiene su OpenAPI; no publicar una falsa API integrada |
| MX-25/26 | Faltan API VI-17 y sanitización VI-23. No inventar recomendaciones/ahorro ni sustituir la tarea de Victor |
| MX-27 | VI-10/#67 sigue en 73c6779: horas mensuales persistidas sobreviven a cambio de mes sin escritura. Corregir GET de listado/detalle antes de validar seed |

El prefijo DEP del tablero permite avanzar componentes aislados; no sustituye
una recepción real para integrar/cerrar. Se publican PR por rama y no se cierran
tarjetas ni se aprueban PR propios. [Registro MX-01](../revisiones/MX-01-revision-2026-10-21.md).

Validación documental: 174 líneas originales únicas, 178 IDs únicos, cuatro
derivadas separadas y conteos por responsable coincidentes con los índices.
La correspondencia funcional queda propuesta para revisión del equipo;
la ausencia del adjunto y su sección mínima permanece explícita.
