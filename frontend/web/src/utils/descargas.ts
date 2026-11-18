/**
 * Le entrega un texto a la persona como un archivo descargado, sin salir de la página.
 * Lo usan las descargas que piden el contenido a la API con la sesión (un enlace directo
 * no mandaría el token).
 */
export function guardarArchivo(nombre: string, contenido: string, tipo: string): void {
  const direccion = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement('a');
  enlace.href = direccion;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Después de que el navegador empezó a descargar, no antes.
  window.setTimeout(() => URL.revokeObjectURL(direccion), 0);
}
