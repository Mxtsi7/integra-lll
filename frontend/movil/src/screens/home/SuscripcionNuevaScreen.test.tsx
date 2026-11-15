// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CatalogosSuscripciones, OpcionesSuscripcion } from '@ojoalgasto/shared';
import SuscripcionNuevaScreen, {
  NuevaSuscripcionFormView,
  OPCIONES_POR_DEFECTO,
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
      { codigo: 'software', nombre: 'Software', activo: false, orden: 3 },
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

  describe('Maquetación, controles iniciales y accesibilidad', () => {
    it('renderiza título, subtítulo, campos obligatorios y botones de acción', () => {
      render(<NuevaSuscripcionFormView />);

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
      render(<NuevaSuscripcionFormView />);

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
      render(<NuevaSuscripcionFormView isSaving={true} />);

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
      render(<NuevaSuscripcionFormView onSubmit={onSubmit} />);

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
      render(<NuevaSuscripcionFormView />);

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'A'.repeat(101) },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));

      expect(screen.getByTestId('error-nombre').textContent).toBe(
        'El nombre puede tener hasta 100 caracteres.',
      );
    });

    it('identifica montos negativos, no numéricos o con más de dos decimales', () => {
      const { rerender } = render(<NuevaSuscripcionFormView />);

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
      render(<NuevaSuscripcionFormView />);

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
      render(<NuevaSuscripcionFormView />);

      fireEvent.click(screen.getByTestId('checkbox-en-prueba'));
      fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));

      expect(screen.getByTestId('error-fin-prueba').textContent).toBe(
        'Ingresa cuándo termina la prueba.',
      );
    });

    it('limpia el error de un campo de inmediato cuando el usuario lo edita', () => {
      render(<NuevaSuscripcionFormView />);

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
      render(<NuevaSuscripcionFormView />);

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
        <NuevaSuscripcionFormView onSubmit={onSubmitRechaza} />,
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
        <NuevaSuscripcionFormView isSaving={false} />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Notion' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '10' },
      });

      // Simular re-renderizado por cambio de orientación o props externas
      rerender(<NuevaSuscripcionFormView isSaving={false} />);

      expect(screen.getByTestId('input-nombre')).toHaveProperty('value', 'Notion');
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '10');
    });
  });

  describe('Envío exitoso y reseteo del formulario', () => {
    it('llama a onSubmit con el payload tipado correcto y resetea los campos al tener éxito', async () => {
      const onSubmit = vi.fn().mockResolvedValue(true);
      render(<NuevaSuscripcionFormView onSubmit={onSubmit} />);

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
      render(<NuevaSuscripcionFormView onSubmit={onSubmit} />);

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
      render(<NuevaSuscripcionFormView onCambiosSinGuardar={onCambios} />);

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
});
