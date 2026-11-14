# AN-08 · Planes y contratación Premium móvil

## Qué entrega
La pantalla **Configuración → Planes y Suscripción Premium**: compara el plan Gratuito y el Premium, muestra cuál es el plan vigente, permite iniciar la contratación y deja claro cómo terminó (pendiente, exitosa, cancelada o fallida).

## Archivos (`frontend/movil/src/screens/`)
| Archivo | Qué hace |
|---|---|
| `configuracion/PlanesScreen.tsx` | Solo coloca el contenido y el botón Volver. Abre el pago con `Linking.openURL`. |
| `components/planes/PlanesContenido.tsx` | Dibuja los planes, el resultado de la contratación y los botones. |
| `components/planes/TarjetaPlan.tsx` | Un plan: nombre, precio, qué incluye y la etiqueta "Tu plan actual". |
| `components/planes/usePlanes.ts` | Carga planes y permisos; contrata, verifica y cancela. |
| `components/planes/reglasPlanes.ts` | Mensajes, validación de la dirección de pago, formato de precio, clave de idempotencia. |
| `components/planes/estilos.ts` | Paleta (reutiliza la de Perfil). |
| `components/planes/planes.test.tsx` | Pruebas (compartidas con AN-11). |

## Por dónde viaja un dato
```
PlanesScreen → PlanesContenido → usePlanes → frontend/shared/src/api/planes.ts → pedir() → gateway → servicio auth
```
| Acción | Endpoint |
|---|---|
| Ver planes | `GET /planes/` |
| Ver el plan vigente y sus funciones | `GET /usuarios/me/permisos/` |
| Contratar Premium | `POST /contrataciones/` con `plan_codigo` y `clave_idempotencia` |
| Consultar una contratación | `GET /contrataciones/<id>/` |
| Cancelar | `POST /contrataciones/<id>/cancelar/` |

## Cómo funciona la contratación
1. «Contratar Premium» manda una clave única. El servidor fija el precio; la app no manda importes.
2. El servidor responde con la contratación (`pendiente`) y una dirección de pago (`url_checkout`).
3. Esa dirección solo se abre si es `https` y no trae usuario ni contraseña incrustados. Si no, no se abre y se avisa.
4. La persona paga en el navegador y vuelve a la app. Al volver a la pantalla, si había un pago pendiente, se consulta cómo terminó. También puede tocar «Verificar estado».
5. Después de verificar, cancelar o contratar, **se vuelve a leer el plan al servidor**.

## Reglas que protegen a la persona (criterios de la tarjeta)
- **El regreso del pago no concede nada.** Aunque la contratación diga "exitosa", la pantalla solo muestra Premium cuando `/usuarios/me/permisos/` lo confirma. Mientras tanto dice "El pago está confirmado, pero tu plan todavía aparece como gratuito".
- **Cada resultado tiene su salida clara:** pendiente (esperar y verificar o cancelar), exitosa, cancelada ("no se hizo ningún cobro") y fallida ("no se hizo ningún cobro", con «Intentar de nuevo»).
- **Un reintento no duplica el cobro:** si falla la conexión, el reintento manda la misma clave. Al terminar una contratación, la clave se descarta.
- **Doble toque:** una sola petición a la vez.
- Solo la persona titular puede contratar: el 403 se explica con un mensaje claro. Un 409 avisa que ya hay una contratación pendiente.
- Si una respuesta llega después de salir de la pantalla, se ignora.
- El precio llega como texto decimal y solo se convierte para mostrarlo. El plan demo se marca como "Precio de demostración: no se hace ningún cobro real".

## Límites
- La app no tiene todavía un enlace de regreso desde el navegador (deep link): se enterará del resultado al volver a la pantalla o con «Verificar estado». Cuando haya enlace de retorno, solo hay que llamar a `verificar()` al recibirlo.
- Al volver desde el navegador, el aviso automático funciona cuando la pantalla recupera el foco. Si la app solo pasó a segundo plano, queda el botón «Verificar estado».
- Solo existe el plan Premium mensual de demostración. No se probó en dispositivo ni contra una pasarela real.
- "Coordinar gating visual aparte" (tarjeta): el bloqueo visual es AN-11 (`AN-11_RESTRICCIONES_PREMIUM_MOVIL.md`).
