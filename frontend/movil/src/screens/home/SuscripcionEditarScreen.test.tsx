// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ErrorDeApi,
  configurarApi,
  type CatalogosSuscripciones,
  type Suscripcion,
} from '@ojoalgasto/shared';
import SuscripcionEditarScreen, {
  EditarSuscripcionFormView,
  aFormulario,
  calcularPatch,
  type EditarSuscripcionFormData,
} from './SuscripcionEditarScreen';

const SUSCRIPCION_BASE: Suscripcion = {
  id: 'sub-100',
  nombre: 'Spotify Familiar',
  monto: 6490,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-11-25',
  categoria: 'musica',
  estado: 'activo',
  horas_uso_mes: 12,
};

const SUSCRIPCION_EN_PRUEBA: Suscripcion = {
  id: 'sub-200',
  nombre: 'Apple TV+',
  monto: 4990,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-12-10',
  categoria: 'streaming',
  estado: 'prueba',
  fin_prueba: '2026-12-05',
};

const CATALOGO_MOCK: CatalogosSuscripciones = {
  monedas: [
    { codigo: 'CLP', nombre: 'Peso chileno', activo: true, orden: 1 },
    { codigo: 'USD', nombre: 'Dólar estadounidense', activo: true, orden: 2 },
    { codigo: 'EUR', nombre: 'Euro', activo: false, orden: 3 },
  ],
  frecuencias: [
    { codigo: 'mensual', nombre: 'Mensual' },
    { codigo: 'anual', nombre: 'Anual' },
  ],
  categorias: [
    { codigo: 'streaming', nombre: 'Streaming', activo: true, orden: 1 },
    { codigo: 'musica', nombre: 'Música', activo: true, orden: 2 },
    { codigo: 'salud', nombre: 'Salud', activo: true, orden: 3 },
    { codigo: 'antigua_legada', nombre: 'Categoría Antigua', activo: false, orden: 4 },
  ],
  predeterminados: {
    moneda: 'CLP',
    frecuencia: 'mensual',
    categoria: 'musica',
  },
};

describe('Formulario Móvil de Edición de Suscripción (SE-24)', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    configurarApi({ urlBase: 'http://localhost:8000' });
  });

  describe('Precarga de valores y conservación de identidad', () => {
    it('función aFormulario transforma correctamente la entidad del dominio', () => {
      const formData = aFormulario(SUSCRIPCION_BASE);
      expect(formData.id).toBe('sub-100');
      expect(formData.nombre).toBe('Spotify Familiar');
      expect(formData.monto).toBe('6490');
      expect(formData.moneda).toBe('CLP');
      expect(formData.frecuencia).toBe('mensual');
      expect(formData.categoria).toBe('musica');
      expect(formData.fechaDeCobro).toBe('2026-11-25');
      expect(formData.enPrueba).toBe(false);
      expect(formData.finPrueba).toBe('');
    });

    it('renderiza con los valores precargados en los inputs y chips activos', () => {
      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
        />,
      );

      expect(screen.getByTestId('screen-suscripcion-editar')).toBeTruthy();
      expect(screen.getByText('Editar Suscripción')).toBeTruthy();

      const inputNombre = screen.getByTestId('input-nombre') as HTMLInputElement;
      expect(inputNombre.value).toBe('Spotify Familiar');

      const inputMonto = screen.getByTestId('input-monto') as HTMLInputElement;
      expect(inputMonto.value).toBe('6490');

      const inputFecha = screen.getByTestId('input-fecha-cobro') as HTMLInputElement;
      expect(inputFecha.value).toBe('2026-11-25');

      const opcionMoneda = screen.getByTestId('opcion-moneda-CLP');
      expect(opcionMoneda.getAttribute('aria-selected')).toBe('true');

      const opcionFrecuencia = screen.getByTestId('opcion-frecuencia-mensual');
      expect(opcionFrecuencia.getAttribute('aria-selected')).toBe('true');

      const opcionCategoria = screen.getByTestId('opcion-categoria-musica');
      expect(opcionCategoria.getAttribute('aria-selected')).toBe('true');
    });

    it('precarga suscripción en período de prueba gratis con su fecha de fin', () => {
      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_EN_PRUEBA}
          catalogos={CATALOGO_MOCK}
        />,
      );

      const inputFinPrueba = screen.getByTestId('input-fin-prueba') as HTMLInputElement;
      expect(inputFinPrueba).toBeTruthy();
      expect(inputFinPrueba.value).toBe('2026-12-05');
    });
  });

  describe('Criterio 1: Cancelar conserva datos originales', () => {
    it('al pulsar "Cancelar y Volver", llama a onCancel sin ejecutar onSubmit', () => {
      const onCancel = vi.fn();
      const onSubmit = vi.fn();

      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />,
      );

      fireEvent.click(screen.getByTestId('go-back'));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('modificar campos y luego pulsar cancelar no muta la suscripción original', () => {
      const onCancel = vi.fn();
      const onSubmit = vi.fn();
      const copiaOriginal = { ...SUSCRIPCION_BASE };

      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />,
      );

      // Modificar nombre y monto
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Nombre Alterado' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '99999' },
      });

      // Cancelar
      fireEvent.click(screen.getByTestId('go-back'));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();

      // El objeto original no fue mutado
      expect(SUSCRIPCION_BASE).toEqual(copiaOriginal);
    });
  });

  describe('Criterio 2: Campos opcionales y fecha mantienen formato correcto', () => {
    it('valida que la fecha de próximo cobro sea obligatoria y tenga formato de fecha real', async () => {
      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
        />,
      );

      // Vaciar fecha
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(await screen.findByText('Ingresa la fecha del próximo cobro.')).toBeTruthy();

      // Fecha imposible (30 de febrero)
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-02-30' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(await screen.findByText('Esa fecha no existe.')).toBeTruthy();
    });

    it('muestra fin_prueba y valida formato real cuando la suscripción original está en prueba', async () => {
      const onSubmit = vi.fn();

      // Caso 1: Suscripción en estado activo (no tiene fin_prueba ni indicador de prueba)
      const { rerender } = render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
          onSubmit={onSubmit}
        />,
      );

      expect(screen.queryByTestId('input-fin-prueba')).toBeNull();
      expect(screen.queryByTestId('indicador-en-prueba')).toBeNull();
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(onSubmit).toHaveBeenCalledTimes(1);

      // Caso 2: Suscripción en estado prueba (muestra indicador y campo de fin de prueba)
      rerender(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_EN_PRUEBA}
          catalogos={CATALOGO_MOCK}
          onSubmit={onSubmit}
        />,
      );

      expect(screen.getByTestId('indicador-en-prueba')).toBeTruthy();
      expect(screen.getByTestId('input-fin-prueba')).toBeTruthy();

      // Ingresar fecha imposible
      fireEvent.change(screen.getByTestId('input-fin-prueba'), {
        target: { value: '2026-13-45' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(await screen.findByText('Esa fecha no existe.')).toBeTruthy();

      // Ingresar fecha real válida
      fireEvent.change(screen.getByTestId('input-fin-prueba'), {
        target: { value: '2026-12-20' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(screen.queryByTestId('error-fin-prueba')).toBeNull();
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it('valida monto positivo numérico con máximo 2 decimales', async () => {
      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
        />,
      );

      // Monto negativo
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '-100' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(await screen.findByText('El monto debe ser mayor a 0.')).toBeTruthy();

      // Más de 2 decimales
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '5990.123' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(await screen.findByText('Usa como máximo 2 decimales.')).toBeTruthy();
    });

    it('limpia el error de un campo inmediatamente al comenzar a editarlo', async () => {
      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
        />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      expect(await screen.findByText('Ingresa el nombre del servicio.')).toBeTruthy();

      // Escribir un carácter limpia el error al instante
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'N' },
      });
      expect(screen.queryByTestId('error-nombre')).toBeNull();
    });
  });

  describe('Catálogo dinámico y opciones preexistentes inactivas (legadas)', () => {
    it('permite mantener moneda o categoría original aunque esté inactiva en el catálogo', () => {
      const suscripcionLegada: Suscripcion = {
        ...SUSCRIPCION_BASE,
        moneda: 'EUR', // inactiva en CATALOGO_MOCK
        categoria: 'antigua_legada', // inactiva en CATALOGO_MOCK
      };

      render(
        <EditarSuscripcionFormView
          suscripcion={suscripcionLegada}
          catalogos={CATALOGO_MOCK}
        />,
      );

      // Ambas opciones inactivas deben estar presentes para esta suscripción
      const chipMonedaEur = screen.getByTestId('opcion-moneda-EUR');
      expect(chipMonedaEur).toBeTruthy();
      expect(chipMonedaEur.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('EUR (inactiva)')).toBeTruthy();

      const chipCatAntigua = screen.getByTestId('opcion-categoria-antigua_legada');
      expect(chipCatAntigua).toBeTruthy();
      expect(chipCatAntigua.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('Categoría Antigua (inactiva)')).toBeTruthy();
    });

    it('muestra banner accesible de carga y error con reintento si falla el catálogo', () => {
      const onReintentar = vi.fn();

      const { rerender } = render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          cargandoCatalogos={true}
        />,
      );

      expect(screen.getByTestId('estado-carga-catalogos')).toBeTruthy();
      expect(screen.getByText('Cargando opciones…')).toBeTruthy();

      rerender(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          cargandoCatalogos={false}
          errorCatalogo="No pudimos cargar las opciones."
          onReintentarCatalogos={onReintentar}
        />,
      );

      expect(screen.getByTestId('error-catalogo')).toBeTruthy();
      fireEvent.click(screen.getByTestId('btn-reintentar-catalogos'));
      expect(onReintentar).toHaveBeenCalledTimes(1);
    });
  });

  describe('Detección de cambios sin guardar (SE-31)', () => {
    it('notifica onCambiosSinGuardar(true) al modificar y vuelve a false al restaurar', () => {
      const onCambios = vi.fn();

      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
          onCambiosSinGuardar={onCambios}
        />,
      );

      // Inicialmente sin cambios
      expect(onCambios).toHaveBeenLastCalledWith(false);

      // Cambiar nombre
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Spotify Premium Modificado' },
      });
      expect(onCambios).toHaveBeenLastCalledWith(true);

      // Restaurar valor inicial
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Spotify Familiar' },
      });
      expect(onCambios).toHaveBeenLastCalledWith(false);
    });
  });

  describe('Punto de integración para SE-25: onSubmit y conservación de ID', () => {
    it('onSubmit recibe el ID original y los datos modificados autorizados', async () => {
      let datosEnviados: EditarSuscripcionFormData | null = null;
      const onSubmit = vi.fn((data: EditarSuscripcionFormData) => {
        datosEnviados = data;
      });

      render(
        <EditarSuscripcionFormView
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
          onSubmit={onSubmit}
        />,
      );

      // Modificar monto y fecha de cobro
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '7990' },
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-11-30' },
      });

      // Cambiar categoría a streaming
      fireEvent.click(screen.getByTestId('opcion-categoria-streaming'));

      fireEvent.click(screen.getByTestId('btn-guardar-edicion'));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(datosEnviados).not.toBeNull();
      expect(datosEnviados!.id).toBe('sub-100'); // ID original inmutable
      expect(datosEnviados!.monto).toBe('7990');
      expect(datosEnviados!.fechaDeCobro).toBe('2026-11-30');
      expect(datosEnviados!.categoria).toBe('streaming');
    });
  });

  describe('Pantalla Contenedora SuscripcionEditarScreen', () => {
    it('usa suscripcion pasada por prop directamente', () => {
      render(
        <SuscripcionEditarScreen
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
        />,
      );

      expect(screen.getByTestId('screen-suscripcion-editar')).toBeTruthy();
      const input = screen.getByTestId('input-nombre') as HTMLInputElement;
      expect(input.value).toBe('Spotify Familiar');
    });

    it('carga la suscripción por id cuando no viene en prop', async () => {
      const onCargar = vi.fn().mockResolvedValue(SUSCRIPCION_BASE);

      render(
        <SuscripcionEditarScreen
          route={{ params: { id: 'sub-100' } } as any}
          onCargarSuscripcion={onCargar}
          catalogos={CATALOGO_MOCK}
        />,
      );

      expect(onCargar).toHaveBeenCalledWith('sub-100');
      expect(await screen.findByDisplayValue('Spotify Familiar')).toBeTruthy();
    });

    it('muestra error seguro ante 404 y permite volver', async () => {
      const error404 = new ErrorDeApi('No encontrada', 404);
      const onCargar = vi.fn().mockRejectedValue(error404);
      const onCancel = vi.fn();

      render(
        <SuscripcionEditarScreen
          route={{ params: { id: 'sub-inexistente' } } as any}
          onCargarSuscripcion={onCargar}
          catalogos={CATALOGO_MOCK}
          onCancel={onCancel}
        />,
      );

      expect(
        await screen.findByText('No encontramos esa suscripción. Puede que haya sido eliminada.'),
      ).toBeTruthy();

      fireEvent.click(screen.getByTestId('go-back'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('ejecuta navigation.goBack() al cancelar', () => {
      const goBack = vi.fn();

      render(
        <SuscripcionEditarScreen
          suscripcion={SUSCRIPCION_BASE}
          catalogos={CATALOGO_MOCK}
          navigation={{ goBack } as any}
        />,
      );

      fireEvent.click(screen.getByTestId('go-back'));
      expect(goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Conexión con PATCH y cálculo diferencial (SE-25)', () => {
    describe('Criterio 1: PATCH no borra campos omitidos (calcularPatch)', () => {
      it('incluye exclusivamente el monto cuando solo se modifica el monto', () => {
        const formData = {
          ...aFormulario(SUSCRIPCION_BASE),
          monto: '7990',
        };
        const patch = calcularPatch(formData, SUSCRIPCION_BASE);
        expect(patch).toEqual({ monto: 7990 });
        // Comprobar que ningún otro campo está presente en el patch
        expect('nombre' in patch).toBe(false);
        expect('moneda' in patch).toBe(false);
        expect('frecuencia' in patch).toBe(false);
        expect('categoria' in patch).toBe(false);
        expect('fecha_proximo_cobro' in patch).toBe(false);
      });

      it('incluye exclusivamente la fecha de cobro cuando solo se modifica la fecha', () => {
        const formData = {
          ...aFormulario(SUSCRIPCION_BASE),
          fechaDeCobro: '2026-11-30',
        };
        const patch = calcularPatch(formData, SUSCRIPCION_BASE);
        expect(patch).toEqual({ fecha_proximo_cobro: '2026-11-30' });
        expect('monto' in patch).toBe(false);
      });

      it('nunca incluye el campo estado en el PATCH (evita 400 del backend)', () => {
        const formDataActiva = {
          ...aFormulario(SUSCRIPCION_BASE),
          nombre: 'Nuevo Nombre',
        };
        const patchActiva = calcularPatch(formDataActiva, SUSCRIPCION_BASE);
        expect('estado' in patchActiva).toBe(false);

        const formDataPrueba = {
          ...aFormulario(SUSCRIPCION_EN_PRUEBA),
          finPrueba: '2026-12-25',
        };
        const patchPrueba = calcularPatch(formDataPrueba, SUSCRIPCION_EN_PRUEBA);
        expect('estado' in patchPrueba).toBe(false);
      });

      it('permite actualizar fin_prueba solo si la suscripción original está en prueba', () => {
        const formData = {
          ...aFormulario(SUSCRIPCION_EN_PRUEBA),
          finPrueba: '2026-12-25',
        };
        const patch = calcularPatch(formData, SUSCRIPCION_EN_PRUEBA);
        expect(patch).toEqual({
          fin_prueba: '2026-12-25',
        });
        expect('estado' in patch).toBe(false);
      });

      it('no incluye fin_prueba si la suscripción original no está en prueba', () => {
        const formData = {
          ...aFormulario(SUSCRIPCION_BASE),
          finPrueba: '2026-12-25',
        };
        const patch = calcularPatch(formData, SUSCRIPCION_BASE);
        expect('fin_prueba' in patch).toBe(false);
        expect('estado' in patch).toBe(false);
      });

      it('devuelve objeto vacío si no hubo modificaciones respecto a original', () => {
        const formData = aFormulario(SUSCRIPCION_BASE);
        const patch = calcularPatch(formData, SUSCRIPCION_BASE);
        expect(patch).toEqual({});
      });
    });

    describe('Criterio 2: Integración con actualizarSuscripcion y conciliación con Detalle', () => {
      it('despacha PATCH con sólo los campos modificados y navega a SuscripcionDetalle vía popTo', async () => {
        const subActualizada: Suscripcion = {
          ...SUSCRIPCION_BASE,
          monto: 7990,
        };
        const onActualizar = vi.fn().mockResolvedValue(subActualizada);
        const onExito = vi.fn();
        const popTo = vi.fn();
        const navigate = vi.fn();

        render(
          <SuscripcionEditarScreen
            suscripcion={SUSCRIPCION_BASE}
            catalogos={CATALOGO_MOCK}
            onActualizarSuscripcion={onActualizar}
            onExito={onExito}
            navigation={{ popTo, navigate } as any}
          />,
        );

        // Modificar solo monto
        fireEvent.change(screen.getByTestId('input-monto'), {
          target: { value: '7990' },
        });

        fireEvent.click(screen.getByTestId('btn-guardar-edicion'));

        await waitFor(() => {
          expect(onActualizar).toHaveBeenCalledTimes(1);
        });

        // Solo se envía el ID y { monto: 7990 }
        expect(onActualizar).toHaveBeenCalledWith('sub-100', { monto: 7990 });
        expect(onExito).toHaveBeenCalledWith(subActualizada);
        // Usa popTo para desapilar el formulario de edición y volver al detalle existente
        expect(popTo).toHaveBeenCalledWith('SuscripcionDetalle', {
          id: 'sub-100',
          suscripcion: subActualizada,
        });
        expect(navigate).not.toHaveBeenCalled();
      });

      it('utiliza navigate como respaldo si navigation no implementa popTo', async () => {
        const subActualizada: Suscripcion = {
          ...SUSCRIPCION_BASE,
          monto: 7990,
        };
        const onActualizar = vi.fn().mockResolvedValue(subActualizada);
        const navigate = vi.fn();

        render(
          <SuscripcionEditarScreen
            suscripcion={SUSCRIPCION_BASE}
            catalogos={CATALOGO_MOCK}
            onActualizarSuscripcion={onActualizar}
            navigation={{ navigate } as any}
          />,
        );

        fireEvent.change(screen.getByTestId('input-monto'), {
          target: { value: '7990' },
        });

        fireEvent.click(screen.getByTestId('btn-guardar-edicion'));

        await waitFor(() => {
          expect(onActualizar).toHaveBeenCalledTimes(1);
        });

        expect(navigate).toHaveBeenCalledWith('SuscripcionDetalle', {
          id: 'sub-100',
          suscripcion: subActualizada,
        });
      });

      it('bloqueo de doble envío: múltiples pulsaciones mientras está en vuelo solo envían un PATCH', async () => {
        let resolverActualizacion!: (sub: Suscripcion) => void;
        const promesa = new Promise<Suscripcion>((resolve) => {
          resolverActualizacion = resolve;
        });
        const onActualizar = vi.fn().mockReturnValue(promesa);

        render(
          <SuscripcionEditarScreen
            suscripcion={SUSCRIPCION_BASE}
            catalogos={CATALOGO_MOCK}
            onActualizarSuscripcion={onActualizar}
          />,
        );

        fireEvent.change(screen.getByTestId('input-monto'), {
          target: { value: '7990' },
        });

        const btnGuardar = screen.getByTestId('btn-guardar-edicion');
        fireEvent.click(btnGuardar);
        fireEvent.click(btnGuardar);
        fireEvent.click(btnGuardar);

        expect(onActualizar).toHaveBeenCalledTimes(1);

        // Desbloquear promesa
        await act(async () => {
          resolverActualizacion({ ...SUSCRIPCION_BASE, monto: 7990 });
        });
      });

      it('ante error 400 del backend, distribuye errores por campo y conserva los datos ingresados', async () => {
        const error400 = new ErrorDeApi('Error de validación', 400, {
          monto: ['El monto supera el límite permitido.'],
        });
        const onActualizar = vi.fn().mockRejectedValue(error400);

        render(
          <SuscripcionEditarScreen
            suscripcion={SUSCRIPCION_BASE}
            catalogos={CATALOGO_MOCK}
            onActualizarSuscripcion={onActualizar}
          />,
        );

        fireEvent.change(screen.getByTestId('input-monto'), {
          target: { value: '99999999' },
        });

        fireEvent.click(screen.getByTestId('btn-guardar-edicion'));

        expect(
          await screen.findByText('El monto supera el límite permitido.'),
        ).toBeTruthy();

        // Los datos tipeados se conservan intactos
        const inputMonto = screen.getByTestId('input-monto') as HTMLInputElement;
        expect(inputMonto.value).toBe('99999999');
      });

      it('ante fallo de red, muestra alerta general y conserva el formulario', async () => {
        const onActualizar = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

        render(
          <SuscripcionEditarScreen
            suscripcion={SUSCRIPCION_BASE}
            catalogos={CATALOGO_MOCK}
            onActualizarSuscripcion={onActualizar}
          />,
        );

        fireEvent.change(screen.getByTestId('input-nombre'), {
          target: { value: 'Spotify Family Updated' },
        });

        fireEvent.click(screen.getByTestId('btn-guardar-edicion'));

        expect(
          await screen.findByText(/No pudimos conectar con el servidor/),
        ).toBeTruthy();

        const inputNombre = screen.getByTestId('input-nombre') as HTMLInputElement;
        expect(inputNombre.value).toBe('Spotify Family Updated');
      });
    });
  });
});
