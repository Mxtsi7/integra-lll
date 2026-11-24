# S3-MX-06 · Minutos de uso Android por día local

El cálculo recibe tramos de actividad comprobada en milisegundos UTC y una
zona IANA explícita. Los agregados que devuelve hoy el módulo Android no
contienen esos tramos. La entrada real sigue pendiente de S3-MX-05.

1. `calcularMinutosUsoAndroid`, en `frontend/movil/src/services/minutosUsoAndroid.ts`,
   valida la zona y los intervalos semiabiertos [inicio, fin).
2. Agrupa por paquete y une intervalos solapados para que cada milisegundo
   contribuya una sola vez al total de esa aplicación.
3. Separa el tramo cuando cambia la fecha en la zona de informe y suma
   milisegundos por aplicación y día. No usa días fijos de 24 horas.
4. Devuelve duración exacta en milisegundos y minutos fraccionarios para
   presentación. Una lista vacía no indica cobertura ni uso cero observado.

Ejemplo en Santiago: un tramo de 02:59:30Z a 03:00:30Z del 9 de noviembre
de 2026 da 30.000 ms al 8 de noviembre y 30.000 ms al 9. Un intervalo cuyo
fin coincide con la medianoche no añade actividad al día siguiente.

Ejecutar desde `frontend/`:

```sh
npm test --workspace movil -- src/services/minutosUsoAndroid.test.ts
```

Las pruebas usan tramos sintéticos. El componente es un cálculo local sin
endpoint ni persistencia. Antes de conectarlo, se debe verificar la lectura
real autorizada de MX-05 y la resolución de zona del dispositivo.
