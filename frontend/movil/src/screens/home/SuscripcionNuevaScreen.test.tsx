// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ErrorDeApi,
  configurarApi,
  type CatalogosSuscripciones,
  type OpcionesSuscripcion,
  type Suscripcion,
} from '@ojoalgasto/shared';
import SuscripcionNuevaScreen, {
  NuevaSuscripcionFormView,
} from './SuscripcionNuevaScreen';

describe('Pantalla Móvil Nueva Suscripción (SE-22)', () => {
  const CATALOGO_MOCK: CatalogosSuscripciones = {
    monedas: [
      { codigo: 'CLP', nombre: 'Peso chileno', activo: true, orden: 1 },
      { codigo: 'USD', nombre: 'Dólar estadounidense', activo: true, orden: 2 },
      { codigo: 'EUR', nombre: 'Euro', activo: false, orden: 3 },
    ],
    categorias: [
      { codigo: 'streaming', nombre: 'Streaming', activo: true, orden: 1 },
      { codigo: 'musica', nombre: 'Música', activo: true, orden: 2 },
      { codigo: 'salud', nombre: 'Salud', activo: true, orden: 3 },
      { codigo: 'software', nombre: 'Software', activo: false, orden: 4 },
    ],
    frecuencias: [
      { codigo: 'mensual', nombre: 'Mensual' },
      { codigo: 'anual', nombre: 'Anual' },
    ],
    predeterminados: {
      moneda: 'CLP',
      categoria: 'streaming',
      frecuencia: 'mensual',
    },
  };

  beforeEach(() => {
    configurarApi({ urlBase: 'http://localhost:8000' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/catalogos/suscripciones/')) {
          return new Response(JSON.stringify(CATALOGO_MOCK), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ detail: 'Ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('Maquetación, controles iniciales y accesibilidad', () => {
    it('renderiza título, subtítulo, campos obligatorios y botones de acción', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      expect(screen.getByText('Nueva Suscripción')).toBeTruthy();
      expect(
        screen.getByText(
          'Registra un servicio recurrente para controlar tus gastos y alertas.',
        ),
      ).toBeTruthy();

      expect(screen.getByTestId('input-nombre')).toBeTruthy();
      expect(screen.getByTestId('input-monto')).toBeTruthy();
      expect(screen.getByTestId('selector-moneda')).toBeTruthy();
      expect(screen.getByTestId('selector-frecuencia')).toBeTruthy();
      expect(screen.getByTestId('selector-categoria')).toBeTruthy();
      expect(screen.getByTestId('input-fecha-cobro')).toBeTruthy();
      expect(screen.getByTestId('checkbox-en-prueba')).toBeTruthy();
      expect(screen.getByTestId('btn-guardar-suscripcion')).toBeTruthy();
      expect(screen.getByTestId('go-back')).toBeTruthy();

      // Por defecto no está en prueba, por lo que no debe mostrar input de fin de prueba
      expect(screen.queryByTestId('input-fin-prueba')).toBeNull();
    });

    it('muestra y oculta el campo condicional de fin de prueba al conmutar el checkbox', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      expect(screen.queryByTestId('input-fin-prueba')).toBeNull();

      // Activar periodo de prueba
      fireEvent.click(screen.getByTestId('checkbox-en-prueba'));
      expect(screen.getByTestId('input-fin-prueba')).toBeTruthy();
      expect(
        screen.getByText('Te avisamos antes de que empiece a cobrar.'),
      ).toBeTruthy();

      // Desactivar periodo de prueba
      fireEvent.click(screen.getByTestId('checkbox-en-prueba'));
      expect(screen.queryByTestId('input-fin-prueba')).toBeNull();
    });

    it('refleja estado deshabilitado e indicador de carga durante isSaving', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} isSaving={true} />);

      const botonGuardar = screen.getByTestId('btn-guardar-suscripcion');
      expect(botonGuardar).toBeTruthy();

      // Al estar guardando, los campos no permiten edición
      const inputNombre = screen.getByTestId('input-nombre');
      expect(inputNombre.getAttribute('readonly')).toBeDefined();
    });
  });

  describe('Criterio 1: Datos inválidos se identifican por campo', () => {
    it('identifica campos obligatorios vacíos al intentar enviar', async () => {
      const onSubmit = vi.fn();
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));

      // No debe llamar a onSubmit si hay errores
      expect(onSubmit).not.toHaveBeenCalled();

      // Mensajes de error por campo
      expect(screen.getByTestId('error-nombre').textContent).toBe(
        'Ingresa el nombre del servicio.',
      );
      expect(screen.getByTestId('error-monto').textContent).toBe(
        'Ingresa el monto.',
      );
      expect(screen.getByTestId('error-fecha-cobro').textContent).toBe(
        'Ingresa la fecha del próximo cobro.',
      );
    });

    it('identifica nombre demasiado largo (> 100 caracteres)', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'A'.repeat(101) },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));

      expect(screen.getByTestId('error-nombre').textContent).toBe(
        'El nombre puede tener hasta 100 caracteres.',
      );
    });

    it('identifica montos negativos, no numéricos o con más de dos decimales', () => {
      const { rerender } = render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      // Monto negativo
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '-500' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-monto').textContent).toBe(
        'El monto debe ser mayor a 0.',
      );

      // Monto cero
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '0' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-monto').textContent).toBe(
        'El monto debe ser mayor a 0.',
      );

      // Con más de dos decimales
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '12.345' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-monto').textContent).toBe(
        'Usa como máximo 2 decimales.',
      );

      // Texto no numérico
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: 'abc' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-monto').textContent).toBe(
        'Ingresa un monto válido, solo con números.',
      );

      // Supera el monto máximo
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '1000000000' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-monto').textContent).toBe(
        'El monto no puede superar 99.999.999,99.',
      );
    });

    it('identifica fechas inexistentes en fecha de cobro y fin de prueba', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      // Fecha imposible (30 de febrero)
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-02-30' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-fecha-cobro').textContent).toBe(
        'Esa fecha no existe.',
      );

      // Activar prueba y poner fecha imposible
      fireEvent.click(screen.getByTestId('checkbox-en-prueba'));
      fireEvent.change(screen.getByTestId('input-fin-prueba'), {
        target: { value: '2026-13-01' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-fin-prueba').textContent).toBe(
        'Esa fecha no existe.',
      );
    });

    it('identifica fin de prueba obligatorio cuando enPrueba está activo', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      fireEvent.click(screen.getByTestId('checkbox-en-prueba'));
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));

      expect(screen.getByTestId('error-fin-prueba').textContent).toBe(
        'Ingresa cuándo termina la prueba.',
      );
    });

    it('limpia el error de un campo de inmediato cuando el usuario lo edita', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      // Provocar errores
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      expect(screen.getByTestId('error-nombre')).toBeTruthy();
      expect(screen.getByTestId('error-monto')).toBeTruthy();

      // Modificar nombre -> desaparece error de nombre pero permanece monto
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Spotify' },
      });
      expect(screen.queryByTestId('error-nombre')).toBeNull();
      expect(screen.getByTestId('error-monto')).toBeTruthy();

      // Modificar monto -> desaparece error de monto
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '4500' },
      });
      expect(screen.queryByTestId('error-monto')).toBeNull();
    });

    it('valida opciones restringidas según el catálogo provisto', () => {
      const opcionesRestringidas: OpcionesSuscripcion = {
        monedas: ['USD'],
        categorias: ['musica'],
        frecuencias: ['anual'],
      };

      render(
        <NuevaSuscripcionFormView opciones={opcionesRestringidas} />,
      );

      // Los defaults son CLP, streaming y mensual, que no están en opcionesRestringidas
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Apple Music' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '99' },
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-11-20' },
      });

      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));

      expect(screen.getByTestId('error-moneda').textContent).toBe(
        'Elige una moneda de la lista.',
      );
      expect(screen.getByTestId('error-categoria').textContent).toBe(
        'Elige una categoría de la lista.',
      );
      expect(screen.getByTestId('error-frecuencia').textContent).toBe(
        'Elige cada cuánto se cobra.',
      );
    });
  });

  describe('Criterio 2: No se pierde lo escrito al cerrar teclado, re-renderizar o fallar envío', () => {
    it('conserva valores tipeados al interactuar con el teclado o perder el foco', () => {
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} />);

      const inputNombre = screen.getByTestId('input-nombre');
      const inputMonto = screen.getByTestId('input-monto');
      const inputFecha = screen.getByTestId('input-fecha-cobro');

      fireEvent.change(inputNombre, { target: { value: 'Gimnasio Pacific' } });
      fireEvent.blur(inputNombre);

      fireEvent.change(inputMonto, { target: { value: '24990' } });
      fireEvent.blur(inputMonto);

      fireEvent.change(inputFecha, { target: { value: '2026-12-05' } });
      fireEvent.blur(inputFecha);

      // Simular cambio de opción en chips
      fireEvent.click(screen.getByTestId('opcion-moneda-USD'));
      fireEvent.click(screen.getByTestId('opcion-frecuencia-anual'));
      fireEvent.click(screen.getByTestId('opcion-categoria-salud'));

      // Verificar que los valores tipeados permanecen inalterados
      expect(screen.getByTestId('input-nombre')).toHaveProperty(
        'value',
        'Gimnasio Pacific',
      );
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '24990');
      expect(screen.getByTestId('input-fecha-cobro')).toHaveProperty(
        'value',
        '2026-12-05',
      );
    });

    it('conserva los datos escritos tras un fallo en onSubmit (promesa rechazada o retorno false)', async () => {
      const onSubmitRechaza = vi.fn().mockRejectedValue(new Error('Fallo de red'));
      const { rerender } = render(
        <NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} onSubmit={onSubmitRechaza} />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Disney+' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '7990' },
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-11-30' },
      });

      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));

      expect(onSubmitRechaza).toHaveBeenCalledTimes(1);

      // Tras el fallo, los datos deben seguir exactamente en los inputs
      expect(screen.getByTestId('input-nombre')).toHaveProperty(
        'value',
        'Disney+',
      );
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '7990');
      expect(screen.getByTestId('input-fecha-cobro')).toHaveProperty(
        'value',
        '2026-11-30',
      );
    });

    it('conserva los datos escritos ante un re-render del componente padre', () => {
      const { rerender } = render(
        <NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} isSaving={false} />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Notion' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '10' },
      });

      // Simular re-renderizado por cambio de orientación o props externas
      rerender(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} isSaving={false} />);

      expect(screen.getByTestId('input-nombre')).toHaveProperty('value', 'Notion');
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '10');
    });
  });

  describe('Envío exitoso y reseteo del formulario', () => {
    it('llama a onSubmit con el payload tipado correcto y resetea los campos al tener éxito', async () => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} onSubmit={onSubmit} />);

      // Completar formulario válido
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: '   HBO Max   ' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '5990,50' }, // coma decimal aceptada
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-12-10' },
      });
      fireEvent.click(screen.getByTestId('opcion-moneda-CLP'));
      fireEvent.click(screen.getByTestId('opcion-frecuencia-mensual'));
      fireEvent.click(screen.getByTestId('opcion-categoria-streaming'));

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      expect(onSubmit).toHaveBeenCalledWith({
        nombre: 'HBO Max',
        monto: 5990.5,
        moneda: 'CLP',
        frecuencia: 'mensual',
        categoria: 'streaming',
        fecha_proximo_cobro: '2026-12-10',
        estado: 'activo',
      });

      // Al ser exitoso, los campos vuelven al estado inicial
      await waitFor(() => {
        expect(screen.getByTestId('input-nombre')).toHaveProperty('value', '');
        expect(screen.getByTestId('input-monto')).toHaveProperty('value', '');
        expect(screen.getByTestId('input-fecha-cobro')).toHaveProperty('value', '');
      });
    });

    it('envía estado "prueba" y "fin_prueba" cuando está en período de prueba gratis', async () => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} onSubmit={onSubmit} />);

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'YouTube Premium' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '8650' },
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-12-01' },
      });

      // Activar prueba y completar fin de prueba
      fireEvent.click(screen.getByTestId('checkbox-en-prueba'));
      fireEvent.change(screen.getByTestId('input-fin-prueba'), {
        target: { value: '2026-11-28' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      expect(onSubmit).toHaveBeenCalledWith({
        nombre: 'YouTube Premium',
        monto: 8650,
        moneda: 'CLP',
        frecuencia: 'mensual',
        categoria: 'streaming',
        fecha_proximo_cobro: '2026-12-01',
        estado: 'prueba',
        fin_prueba: '2026-11-28',
      });
    });
  });

  describe('Detección de cambios sin guardar (SE-31)', () => {
    it('notifica onCambiosSinGuardar con true al escribir y false si se vuelve al valor inicial', () => {
      const onCambios = vi.fn();
      render(<NuevaSuscripcionFormView catalogos={CATALOGO_MOCK} onCambiosSinGuardar={onCambios} />);

      // Inicialmente sin cambios
      expect(onCambios).toHaveBeenLastCalledWith(false);

      // Escribir en un campo
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'AWS' },
      });
      expect(onCambios).toHaveBeenLastCalledWith(true);

      // Dejarlo vacío nuevamente como al inicio
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: '' },
      });
      expect(onCambios).toHaveBeenLastCalledWith(false);
    });
  });

  describe('Errores de API / Servidor', () => {
    it('distribuye errores del backend por campo y generales', () => {
      render(
        <NuevaSuscripcionFormView
          catalogos={CATALOGO_MOCK}
          errorGeneral="Servidor no disponible"
          erroresCampos={{
            nombre: ['Ya existe una suscripción con este nombre.'],
            non_field_errors: ['Error en validación global.'],
          }}
        />,
      );

      expect(screen.getByTestId('error-general').textContent).toContain(
        'Servidor no disponible',
      );
      expect(screen.getByTestId('error-general').textContent).toContain(
        'Error en validación global.',
      );
      expect(screen.getByTestId('error-nombre').textContent).toBe(
        'Ya existe una suscripción con este nombre.',
      );
    });
  });

  describe('Contenedor de pantalla SuscripcionNuevaScreen', () => {
    it('renderiza correctamente y ejecuta navigation.goBack() al pulsar "Cancelar y Volver"', () => {
      const goBackMock = vi.fn();
      render(
        <SuscripcionNuevaScreen
          navigation={{ goBack: goBackMock } as any}
        />,
      );

      expect(screen.getByTestId('screen-suscripcion-nueva')).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-back'));
      expect(goBackMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Conexión con crearSuscripcion y navegación al resultado (SE-23)', () => {
    async function llenarFormularioValido({
      nombre = 'Disney Plus',
      monto = '7990',
      fecha = '2026-11-25',
    } = {}) {
      await screen.findByTestId('opcion-moneda-CLP');
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: nombre },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: monto },
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: fecha },
      });
    }

    it('Criterio 1: Éxito agrega exactamente una suscripción y navega al detalle con su ID', async () => {
      const suscripcionCreada: Suscripcion = {
        id: 'sub-nueva-99',
        nombre: 'Disney Plus',
        monto: 7990,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-11-25',
        categoria: 'streaming',
        estado: 'activo',
      };

      const onCrearSuscripcion = vi.fn().mockResolvedValue(suscripcionCreada);
      const onExito = vi.fn();
      const replaceMock = vi.fn();
      const navigateMock = vi.fn();

      render(
        <SuscripcionNuevaScreen
          navigation={{ replace: replaceMock, navigate: navigateMock } as any}
          onCrearSuscripcion={onCrearSuscripcion}
          onExito={onExito}
        />,
      );

      await llenarFormularioValido();

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      // Se envió exactamente una petición POST con los datos correctos
      expect(onCrearSuscripcion).toHaveBeenCalledTimes(1);
      expect(onCrearSuscripcion).toHaveBeenCalledWith({
        nombre: 'Disney Plus',
        monto: 7990,
        moneda: 'CLP',
        frecuencia: 'mensual',
        categoria: 'streaming',
        fecha_proximo_cobro: '2026-11-25',
        estado: 'activo',
      });

      // Notificó callback de éxito
      expect(onExito).toHaveBeenCalledWith(suscripcionCreada);

      // Navegó al resultado (detalle con el ID creado)
      expect(replaceMock).toHaveBeenCalledWith('SuscripcionDetalle', {
        id: 'sub-nueva-99',
      });
    });

    it('Bloqueo de doble envío: múltiples pulsaciones solo envían exactamente un POST', async () => {
      let resolverPeticion: (sub: Suscripcion) => void = () => {};
      const promesaPendiente = new Promise<Suscripcion>((resolve) => {
        resolverPeticion = resolve;
      });
      const onCrearSuscripcion = vi.fn().mockReturnValue(promesaPendiente);

      render(
        <SuscripcionNuevaScreen
          navigation={{ replace: vi.fn() } as any}
          onCrearSuscripcion={onCrearSuscripcion}
        />,
      );

      await llenarFormularioValido();

      // Primer clic dispara la petición
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      expect(onCrearSuscripcion).toHaveBeenCalledTimes(1);

      // Intentar enviar repetidas veces mientras está en vuelo
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      // NO se enviaron más peticiones (bloqueo antirrebote estricto)
      expect(onCrearSuscripcion).toHaveBeenCalledTimes(1);

      // Resolver la petición
      await act(async () => {
        resolverPeticion({
          id: 'sub-1',
          nombre: 'Disney Plus',
          monto: 7990,
          moneda: 'CLP',
          frecuencia: 'mensual',
          fecha_proximo_cobro: '2026-11-25',
          categoria: 'streaming',
          estado: 'activo',
        });
      });
    });

    it('Criterio 2: Fallo con errores 400 del servidor conserva formulario y muestra error por campo', async () => {
      const errorApi = new ErrorDeApi('Datos inválidos', 400, {
        nombre: ['Ya existe una suscripción registrada con este nombre.'],
      });
      const onCrearSuscripcion = vi.fn().mockRejectedValue(errorApi);
      const replaceMock = vi.fn();

      render(
        <SuscripcionNuevaScreen
          navigation={{ replace: replaceMock } as any}
          onCrearSuscripcion={onCrearSuscripcion}
        />,
      );

      await llenarFormularioValido({ nombre: 'Netflix Duplicado' });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      expect(onCrearSuscripcion).toHaveBeenCalledTimes(1);

      // No navega al resultado
      expect(replaceMock).not.toHaveBeenCalled();

      // Muestra error devuelto por la API en el campo correspondiente
      expect(screen.getByTestId('error-nombre').textContent).toBe(
        'Ya existe una suscripción registrada con este nombre.',
      );

      // Conserva los datos tipeados (no se borran ni se inserta registro ficticio)
      expect(screen.getByTestId('input-nombre')).toHaveProperty(
        'value',
        'Netflix Duplicado',
      );
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '7990');
      expect(screen.getByTestId('input-fecha-cobro')).toHaveProperty(
        'value',
        '2026-11-25',
      );
    });

    it('Criterio 2: Fallo de red o 500 muestra error general, conserva datos y no inserta registro ficticio', async () => {
      const onCrearSuscripcion = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));
      const replaceMock = vi.fn();

      render(
        <SuscripcionNuevaScreen
          navigation={{ replace: replaceMock } as any}
          onCrearSuscripcion={onCrearSuscripcion}
        />,
      );

      await llenarFormularioValido();

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      expect(onCrearSuscripcion).toHaveBeenCalledTimes(1);
      expect(replaceMock).not.toHaveBeenCalled();

      // Muestra alerta general
      expect(screen.getByTestId('error-general').textContent).toContain(
        'No pudimos conectar con el servidor',
      );

      // Los datos siguen disponibles para no perder lo escrito
      expect(screen.getByTestId('input-nombre')).toHaveProperty(
        'value',
        'Disney Plus',
      );
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '7990');
    });
  });

  describe('Consumo dinámico de catálogos y opciones activas (SE-22 / SE-23 revisión)', () => {
    it('obtiene catálogo dinámico de la API por ruta real, muestra sólo opciones activas y permite crear con nueva opción', async () => {
      const CATALOGO_DINAMICO: CatalogosSuscripciones = {
        monedas: [
          { codigo: 'CLP', nombre: 'Peso chileno', activo: true, orden: 1 },
          { codigo: 'USD', nombre: 'Dólar estadounidense', activo: true, orden: 2 },
          { codigo: 'EUR', nombre: 'Euro', activo: false, orden: 3 },
        ],
        categorias: [
          { codigo: 'transporte', nombre: 'Transporte', activo: true, orden: 1 },
          { codigo: 'streaming', nombre: 'Streaming', activo: false, orden: 2 },
        ],
        frecuencias: [
          { codigo: 'mensual', nombre: 'Mensual' },
        ],
        predeterminados: {
          moneda: 'CLP',
          categoria: 'transporte',
          frecuencia: 'mensual',
        },
      };

      const mockCargarCatalogos = vi.fn().mockResolvedValue(CATALOGO_DINAMICO);
      const onCrearSuscripcion = vi.fn().mockResolvedValue({
        id: 'sub-metro-1',
        nombre: 'Tarjeta Metro',
        monto: 15000,
        moneda: 'CLP',
        frecuencia: 'mensual',
        categoria: 'transporte',
        fecha_proximo_cobro: '2026-11-28',
        estado: 'activo',
      });
      const replaceMock = vi.fn();

      render(
        <SuscripcionNuevaScreen
          navigation={{ replace: replaceMock } as any}
          onCargarCatalogos={mockCargarCatalogos}
          onCrearSuscripcion={onCrearSuscripcion}
        />,
      );

      // Esperar a que cargue el catálogo dinámico
      expect(await screen.findByTestId('opcion-categoria-transporte')).toBeTruthy();

      // Muestra únicamente opciones activas:
      expect(screen.getByTestId('opcion-categoria-transporte')).toBeTruthy();
      expect(screen.getByTestId('opcion-moneda-CLP')).toBeTruthy();
      expect(screen.getByTestId('opcion-moneda-USD')).toBeTruthy();
      expect(screen.getByTestId('opcion-frecuencia-mensual')).toBeTruthy();

      // NO ofrece la opción inactiva streaming ni la moneda inactiva EUR
      expect(screen.queryByTestId('opcion-categoria-streaming')).toBeNull();
      expect(screen.queryByTestId('opcion-moneda-EUR')).toBeNull();

      // Los predeterminados del catálogo se seleccionan automáticamente
      await waitFor(() => {
        expect(screen.getByTestId('opcion-categoria-transporte').getAttribute('aria-selected')).toBe('true');
      });

      // Completar campos y guardar con la nueva opción
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Tarjeta Metro' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '15000' },
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-11-28' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      expect(onCrearSuscripcion).toHaveBeenCalledWith({
        nombre: 'Tarjeta Metro',
        monto: 15000,
        moneda: 'CLP',
        frecuencia: 'mensual',
        categoria: 'transporte',
        fecha_proximo_cobro: '2026-11-28',
        estado: 'activo',
      });
      expect(replaceMock).toHaveBeenCalledWith('SuscripcionDetalle', {
        id: 'sub-metro-1',
      });
    });

    it('maneja fallo de carga del catálogo con estado visible y reintento, sin inventar opciones falsas', async () => {
      let resolverReintento: (val: CatalogosSuscripciones) => void = () => {};
      const promesaReintento = new Promise<CatalogosSuscripciones>((res) => {
        resolverReintento = res;
      });

      const onCargarCatalogos = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fallo al obtener catálogo'))
        .mockReturnValueOnce(promesaReintento);

      render(
        <SuscripcionNuevaScreen onCargarCatalogos={onCargarCatalogos} />,
      );

      // Muestra estado de error con rol alert y mensaje claro
      expect(await screen.findByTestId('error-catalogo')).toBeTruthy();
      expect(screen.getByTestId('error-catalogo').textContent).toContain(
        'No pudimos cargar las opciones. Intenta de nuevo.',
      );

      // No inventa opciones falsas (ningún selector tiene chips de monedas o categorías)
      expect(screen.queryByTestId('opcion-moneda-CLP')).toBeNull();
      expect(screen.queryByTestId('opcion-categoria-streaming')).toBeNull();

      // El botón de guardar suscripción está deshabilitado
      const btnGuardar = screen.getByTestId('btn-guardar-suscripcion');
      expect(btnGuardar.getAttribute('aria-disabled')).toBe('true');

      // Botón de reintento visible
      const btnReintentar = screen.getByTestId('btn-reintentar-catalogos');
      expect(btnReintentar).toBeTruthy();

      // Presionar reintento
      fireEvent.click(btnReintentar);
      expect(onCargarCatalogos).toHaveBeenCalledTimes(2);

      // Ahora resuelve el reintento
      await act(async () => {
        resolverReintento(CATALOGO_MOCK);
      });

      // El error desaparece y aparecen las opciones reales
      expect(screen.queryByTestId('error-catalogo')).toBeNull();
      expect(await screen.findByTestId('opcion-categoria-streaming')).toBeTruthy();
    });

    it('los valores iniciales del catálogo no pisan datos ya ingresados por el usuario', async () => {
      let resolverCatalogo: (val: CatalogosSuscripciones) => void = () => {};
      const promesaCatalogo = new Promise<CatalogosSuscripciones>((res) => {
        resolverCatalogo = res;
      });

      const onCargarCatalogos = vi.fn().mockReturnValue(promesaCatalogo);

      render(<SuscripcionNuevaScreen onCargarCatalogos={onCargarCatalogos} />);

      // Muestra indicador de carga de opciones
      expect(screen.getByTestId('estado-carga-catalogos')).toBeTruthy();
      expect(screen.getByText('Cargando opciones…')).toBeTruthy();

      // Usuario ingresa datos antes de que responda el catálogo
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Mi Servicio Previo' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '9990' },
      });

      // Resuelve el catálogo con predeterminados
      await act(async () => {
        resolverCatalogo(CATALOGO_MOCK);
      });

      // Los datos ingresados por el usuario se conservan intactos
      expect(screen.getByTestId('input-nombre')).toHaveProperty(
        'value',
        'Mi Servicio Previo',
      );
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '9990');

      // Y las opciones predeterminadas se asignan correctamente
      expect(screen.getByTestId('opcion-moneda-CLP').getAttribute('aria-selected')).toBe('true');
      expect(screen.getByTestId('opcion-categoria-streaming').getAttribute('aria-selected')).toBe('true');
    });
  });
});
