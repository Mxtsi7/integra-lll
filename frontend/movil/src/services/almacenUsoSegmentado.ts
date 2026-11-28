/** Doble buffer: un corte a mitad de escritura conserva el manifiesto anterior. */
export function crearAlmacenUsoSegmentado(backend: {
  leer(clave: string): Promise<string | null>; guardar(clave: string, valor: string): Promise<void>;
  identidad?(): string | null;
}, clave: string) {
  const MAX_PARTES = 512;
  type Cabeza = { slot: number; partes: number; reservas: [number, number] };
  async function cabeza(): Promise<Cabeza | null> {
    const texto = await backend.leer(clave);
    if (!texto) return null;
    const valor = JSON.parse(texto) as Cabeza;
    if (![0, 1].includes(valor.slot) || !Number.isInteger(valor.partes) || valor.partes < 0 || valor.partes > MAX_PARTES ||
        !Array.isArray(valor.reservas) || valor.reservas.length !== 2 || valor.reservas.some(n => !Number.isInteger(n) || n < 0 || n > MAX_PARTES)) throw new Error('Cola segura inválida.');
    return valor;
  }
  return {
    async leer() {
      const cabecera = await cabeza();
      if (!cabecera || !cabecera.partes) return null;
      const partes: string[] = [];
      for (let indice = 0; indice < cabecera.partes; indice++) {
        const parte = await backend.leer(`${clave}_${cabecera.slot}_${indice}`);
        if (parte === null) throw new Error('Cola segura incompleta.');
        partes.push(parte);
      }
      return partes.join('');
    },
    async guardar(valor: string) {
      const identidad = backend.identidad?.();
      function vigente() {
        if (backend.identidad && (!identidad || backend.identidad() !== identidad)) throw new Error('La sesión cambió durante la escritura de la cola.');
      }
      async function escribir(clave: string, dato: string) {
        vigente(); await backend.guardar(clave, dato); vigente();
      }
      vigente();
      // JSON del recolector contiene ASCII (UUID, fechas y claves del contrato).
      // 400 unidades UTF-16 mantienen cada entrada bajo 2 KiB incluso con Unicode.
      const partes = Math.max(1, Math.ceil(valor.length / 400));
      if (partes > MAX_PARTES) throw new Error('La cola segura está llena. Sincroniza antes de capturar.');
      const anterior = await cabeza();
      const slot = anterior?.slot === 0 ? 1 : 0;
      const reservas: [number, number] = [...(anterior?.reservas ?? [0, 0])];
      reservas[slot] = Math.max(reservas[slot], partes);
      // Registrar también fragmentos en preparación permite purgarlos al cerrar sesión.
      await escribir(clave, JSON.stringify({ slot: anterior?.slot ?? 1, partes: anterior?.partes ?? 0, reservas }));
      for (let indice = 0; indice < partes; indice++) {
        await escribir(`${clave}_${slot}_${indice}`, valor.slice(indice * 400, (indice + 1) * 400));
      }
      await escribir(clave, JSON.stringify({ slot, partes, reservas }));
    },
  };
}
