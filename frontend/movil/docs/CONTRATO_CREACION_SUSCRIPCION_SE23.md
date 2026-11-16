# Contrato de Integración: Conectar Creación Móvil y Actualizar Listado (SE-23)

- **Tarjeta:** SE-23 (Conectar creación móvil y actualizar listado)
- **Responsable:** Sebastian Mena
- **Sprint:** Sprint 3
- **Depende de:**
  - [SE-07] Configurar cliente HTTP móvil por entorno
  - [SE-08] Implementar almacenamiento seguro y sesión móvil
  - [SE-22] Crear formulario móvil de nueva suscripción
- **Desbloquea a:** Aceptación de funcionalidad y revisión global del flujo de suscripciones móviles.

---

## 1. Resumen y Alcance

Esta tarjeta conecta la pantalla de alta de suscripciones ([`SuscripcionNuevaScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/SuscripcionNuevaScreen.tsx)) con la función de API compartida `crearSuscripcion` de `@ojoalgasto/shared`. Implementa un mecanismo riguroso de bloqueo contra doble envío, refleja de manera accesible las respuestas del backend (DRF HTTP 400 por campo o errores globales de red/servidor), preserva todos los datos ingresados en caso de fallo sin insertar registros ficticios, invalida el listado en [`HomeScreen.tsx`](file:///home/sebamena/Documentos/GitHub/integra-lll/frontend/movil/src/screens/home/HomeScreen.tsx) mediante suscripción a eventos de foco, y navega automáticamente al detalle de la suscripción creada.

---

## 2. Flujo de Comunicación y Puntos de Integración

### 2.1. Petición POST a la API (`crearSuscripcion`)

Al validar localmente el formulario sin errores, `SuscripcionNuevaScreen` despacha la petición POST:

```typescript
import { crearSuscripcion, type SuscripcionPayload, type Suscripcion } from '@ojoalgasto/shared';

// Payload enviado (sin ID, asignado por el backend):
export interface SuscripcionPayload {
  nombre: string;
  monto: number;
  moneda: string;
  frecuencia: 'mensual' | 'anual' | 'semanal' | 'trimestral' | 'semestral';
  fecha_proximo_cobro: string; // YYYY-MM-DD
  categoria: string;
  estado: 'activo' | 'prueba';
  fin_prueba?: string; // YYYY-MM-DD (condicional a estado === 'prueba')
}

// Respuesta exitosa (HTTP 201 Created):
const suscripcionCreada: Suscripcion = await crearSuscripcion(datos);
```

### 2.2. Bloqueo de Doble Envío (Antirrebote Concurrente)

Se implementan dos capas de protección concurrentes:
1. **Referencia Sincrónica (`guardandoRef.current`):** Previene condiciones de carrera o toques múltiples simultáneos antes de que React termine de procesar el renderizado del estado.
2. **Estado Reactivo (`isSaving`):** Deshabilita los inputs y botones de la interfaz, mostrando un indicador accesible de carga en el botón `"Guardar suscripción"`.

Si el usuario pulsa repetidamente el botón mientras la petición está en vuelo, las pulsaciones adicionales son descartadas de forma segura y **exactamente una petición POST** es enviada al backend.

---

## 3. Manejo de Errores y Conservación de Datos (Criterio 2)

| Tipo de Fallo | Código / Causa | Comportamiento en UI | Conservación de Formulario |
| :--- | :--- | :--- | :--- |
| **Error de Validación DRF** | HTTP 400 (`err.campos`) | Se reparten mediante `erroresDesdeServidor`. Cada error aparece junto a su campo (`error-nombre`, `error-monto`, etc.) con rol `alert`. | **Totalmente preservado.** Ningún dato se borra y no se crea registro ficticio. |
| **Error de Negocio / Autorización** | HTTP 403 / 500 (`err.message`) | Se muestra en la caja de alerta superior (`testID="error-general"`). | **Totalmente preservado.** |
| **Fallo de Conexión / Red** | `TypeError` (offline, timeout) | Se muestra `"No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo."` con rol `alert`. | **Totalmente preservado.** |

Al fallar la petición:
- Los datos escritos por el usuario permanecen exactamente en sus respectivos campos.
- `isSaving` vuelve a `false` permitiendo al usuario corregir el problema y reintentar sin reescribir.
- **Bajo ninguna circunstancia se inserta una suscripción ficticia o parcial en el estado global o local.**

---

## 4. Invalidación de Listado y Navegación al Resultado (Criterio 1)

### 4.1. Navegación al Resultado Creado

Tras recibir la confirmación exitosa del backend (`suscripcionCreada.id`):
```typescript
if (navigation?.replace) {
  navigation.replace('SuscripcionDetalle', { id: suscripcionCreada.id });
} else if (navigation?.navigate) {
  navigation.navigate('SuscripcionDetalle', { id: suscripcionCreada.id });
}
```
Esto asegura que el usuario sea redirigido de inmediato a visualizar los datos reales y acciones de la suscripción que acaba de dar de alta.

### 4.2. Invalidación, Recarga y Protección contra Concurrencia en `HomeScreen`

Para garantizar que el listado de suscripciones refleje exactamente la nueva suscripción sin depender de cachés estáticas y sin condiciones de carrera entre peticiones desfasadas (por ejemplo, una carga inicial lenta que resuelva después de una recarga por foco tras crear):

```typescript
const generacionRef = useRef(0);

const cargarDatos = useCallback(async () => {
  const generacionActual = ++generacionRef.current;
  setEstado((prev) => ({ ...prev, cargando: true, error: null }));

  try {
    const data = await getSuscripciones();
    if (generacionRef.current !== generacionActual) {
      return; // Descarta respuesta de petición desfasada
    }
    setEstado({ cargando: false, error: null, suscripciones: data });
  } catch (err) {
    if (generacionRef.current !== generacionActual) {
      return; // Descarta rechazo de petición desfasada
    }
    setEstado((prev) => ({
      ...prev,
      cargando: false,
      error: 'No pudimos cargar tus suscripciones.',
    }));
  }
}, [getSuscripciones]);
```

#### Coordinación del ciclo de vida y foco:
- **Evento `focus`:** Al regresar a `HomeScreen` desde el detalle o creación, el foco dispara una nueva generación (`cargarDatos()`).
- **Descarte de respuestas lentas:** Si la petición previa (carga inicial) termina más tarde, su resultado es ignorado porque `generacionActual !== generacionRef.current`. De este modo, la instantánea anterior no sobrescribe la suscripción recién creada.
- **Desmontaje y cambio de sesión:** El cleanup del efecto invalida la generación activa (`generacionRef.current++`), previniendo actualizaciones de estado sobre componentes desmontados o usuarios diferentes.

---

## 5. Matriz de Selectores para Pruebas Automatizadas

| Elemento | `testID` | Rol / Comportamiento |
| :--- | :--- | :--- |
| Contenedor Screen | `screen-suscripcion-nueva` | Contenedor principal de la pantalla |
| Botón Guardar | `btn-guardar-suscripcion` | Bloqueado durante `isSaving`, envía POST |
| Botón Cancelar y Volver | `go-back` | Ejecuta `navigation.goBack()` |
| Input Servicio | `input-nombre` | Conserva texto ante fallos de API |
| Input Monto | `input-monto` | Conserva texto ante fallos de API |
| Alerta General | `error-general` | `accessibilityRole="alert"` |
| Alerta Campo Nombre | `error-nombre` | `accessibilityRole="alert"` |
