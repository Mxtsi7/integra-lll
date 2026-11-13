# Cuentas conectadas y autorización de correo móvil (AN-06 + AN-09)

## Qué hace

**Cuentas conectadas** (Configuración → Cuentas Conectadas, AN-06)
- Lista las cuentas con su proveedor, estado y última sincronización.
- Si una cuenta necesita reautorización, muestra "Volver a autorizar".
- "Desconectar" pide confirmación y usa el estado que devuelve el backend.
- Se recarga al volver a la pantalla.
- Estados de carga, error con reintento y vacío (reutiliza AN-28).
- No se guarda ningún token del proveedor en el teléfono.

**Autorización de correo** (Configuración → Autorización de Correo, AN-09)
- Botones Gmail y Outlook. Pide el enlace al backend, comprueba que sea `https` y del dominio exacto del proveedor, y lo abre en el navegador.
- Esto **no conecta ninguna cuenta**: la cuenta solo existe si el proveedor devuelve el código al backend. Cancelar en el navegador no deja nada conectado.
- Si la persona sale de la pantalla antes de que llegue la respuesta, no se abre el navegador.

## Archivos
| Archivo | Para qué |
|---|---|
| `frontend/shared/src/api/cuentas.ts` (+ test) | `getCuentasConectadas`, `iniciarAutorizacionCorreo`, `desconectarCuenta`; exportado en `shared/src/index.ts` |
| `frontend/movil/src/screens/components/cuentas/useCuentas.ts` | carga y desconexión (AN-06) |
| `.../cuentas/CuentasContenido.tsx` | dibuja la lista y los botones |
| `.../cuentas/useAutorizacionCorreo.ts`, `AutorizacionCorreoContenido.tsx` | autorización (AN-09) |
| `.../cuentas/cuentas.test.tsx` | 22 pruebas |
| `.../configuracion/CuentasConectadasScreen.tsx`, `AutorizacionCorreoScreen.tsx` | solo colocan los componentes |

## Correcciones de la revisión
Se corrigieron los dos hallazgos P2 del revisor:

1. **Recargar durante un DELETE dejaba la cuenta obsoleta y la marca pendiente.** Antes el resultado del DELETE se descartaba si la lista se recargaba mientras tanto. Ahora la desconexión es independiente de las recargas: su resultado siempre se aplica y su marca pendiente siempre se libera. Al terminar (bien o mal) se vuelve a pedir la lista en segundo plano, para que quede lo que confirma el backend. Un timeout no prueba que el backend no procesó el DELETE, por eso también se reconcilia al fallar.
2. **Una autorización abandonada abría el navegador al llegar la respuesta.** Cada intento tiene ahora un número que se invalida al salir de la pantalla; si la respuesta llega después, no se abre nada. Se mantiene el candado de doble toque y los errores permiten reintentar.

Pruebas de regresión nuevas (7):
- El intercalado del revisor: cargar → DELETE pendiente → recarga que trae la cuenta conectada → el DELETE responde desconectada. Termina desconectada y sin ids pendientes.
- Una recarga vieja que llega después del DELETE no pisa el estado desconectado.
- DELETE fallido con recarga simultánea: avisa, libera la marca y deja lo que confirma el backend.
- DELETE que termina con la pantalla cerrada: no falla ni pide la lista.
- Autorización: salir antes de la respuesta no abre el navegador; el flujo normal abre exactamente una vez; un intento fallido se puede reintentar.

## Límites conocidos
- No se envía `retorno`: el backend lo valida con `URLField` y una lista blanca, y probablemente rechace `ojoalgasto://`. Falta VI-14 y el callback (AN-27).
- No se envía el consentimiento (`correo-v1`) porque el contrato de FE-03 hoy no lo recibe.
- Se abre con `Linking.openURL`. Para un "navegador seguro" con retorno automático haría falta `expo-web-browser`.
- Esta PR inicia el flujo; **no** acredita la conexión final ni cierra AN-27.
- No se probó en dispositivo ni con un proveedor real.

## Verificación
- [ ] `cd frontend/shared && npx vitest run`
- [ ] `cd frontend/movil && npx vitest run`
- [ ] `cd frontend/movil && npx tsc --noEmit`
- `npx expo lint` no se puede ejecutar: el repo no tiene ESLint configurado.
