// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  TarjetaSuscripcion,
  formatearTextoCobro,
  sufijoFrecuencia,
  ESTADOS_SUSCRIPCION,
} from './TarjetaSuscripcion';
import type { EstadoSuscripcion, Suscripcion } from '@ojoalgasto/shared';

const SUSCRIPCION_BASE: Suscripcion = {
  id: 'sub-123',
  nombre: 'Spotify Familiar',
  monto: 6990,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-11-20',
  categoria: 'musica',
  estado: 'activo',
  horas_uso_mes: 25,
};

describe('Tarjeta Móvil de Suscripción (SE-18)', () => {
  describe('Renderizado de campos y formatos compartidos', () => {
    it('renderiza nombre, categoría, monto formateado, frecuencia y próximo cobro', () => {
      const onPress = vi.fn();
      render(<TarjetaSuscripcion suscripcion={SUSCRIPCION_BASE} onPress={onPress} />);

      expect(screen.getByText('Spotify Familiar')).toBeTruthy();
      expect(screen.getByText('musica')).toBeTruthy();
      // Formato regional CLP compartido
      expect(screen.getByText(/6\.990/)).toBeTruthy();
      expect(screen.getByText('/mes')).toBeTruthy();
      expect(screen.getByText(/20 nov 2026/)).toBeTruthy();
      expect(screen.getByText('Activa')).toBeTruthy();
    });

    it('formatea correctamente suscripciones anuales con sufijo /año', () => {
      const anual: Suscripcion = {
        ...SUSCRIPCION_BASE,
        id: 'sub-anual',
        nombre: 'Amazon Prime Anual',
        monto: 36000,
        frecuencia: 'anual',
      };

      render(<TarjetaSuscripcion suscripcion={anual} onPress={vi.fn()} />);

      expect(screen.getByText('/año')).toBeTruthy();
      expect(sufijoFrecuencia('anual')).toBe('/año');
      expect(sufijoFrecuencia('mensual')).toBe('/mes');
    });
  });

  describe('Criterio 1: Textos largos no ocultan monto ni acciones', () => {
    it('suscripción con nombre y categoría extremadamente largos conserva el monto y badge visibles', () => {
      const suscripcionLarga: Suscripcion = {
        ...SUSCRIPCION_BASE,
        id: 'sub-largo',
        nombre:
          'Suscripción Corporativa Enterprise con Acceso Total Cloud IA y Servicios de Alta Disponibilidad 24/7',
        categoria: 'infraestructura-y-servicios-en-la-nube-extendidos',
        monto: 1500000,
        moneda: 'CLP',
      };

      render(<TarjetaSuscripcion suscripcion={suscripcionLarga} onPress={vi.fn()} />);

      // Monto formateado debe permanecer presente y visible
      expect(screen.getByText(/1\.500\.000/)).toBeTruthy();
      // Badge de estado debe permanecer visible
      expect(screen.getByText('Activa')).toBeTruthy();
      // Nombre renderizado
      expect(
        screen.getByText(
          'Suscripción Corporativa Enterprise con Acceso Total Cloud IA y Servicios de Alta Disponibilidad 24/7'
        )
      ).toBeTruthy();
    });
  });

  describe('Criterio 2: Estado no se comunica solo con color', () => {
    const estados: { estado: EstadoSuscripcion; etiquetaEsperada: string }[] = [
      { estado: 'activo', etiquetaEsperada: 'Activa' },
      { estado: 'prueba', etiquetaEsperada: 'Prueba gratis' },
      { estado: 'fantasma', etiquetaEsperada: 'Sin uso' },
      { estado: 'por_confirmar', etiquetaEsperada: 'Por confirmar' },
      { estado: 'cancelado', etiquetaEsperada: 'Cancelada' },
    ];

    estados.forEach(({ estado, etiquetaEsperada }) => {
      it(`para estado "${estado}" muestra el texto explícito "${etiquetaEsperada}" y lo anuncia en accesibilidad`, () => {
        const item: Suscripcion = {
          ...SUSCRIPCION_BASE,
          id: `sub-${estado}`,
          estado,
        };

        render(<TarjetaSuscripcion suscripcion={item} onPress={vi.fn()} />);

        // Texto visual explícito dentro de la insignia
        expect(screen.getByText(etiquetaEsperada)).toBeTruthy();

        // Anuncio accesible verbalizado para lectores de pantalla
        const tarjetaBoton = screen.getByRole('button');
        const accessibleLabel = tarjetaBoton.getAttribute('aria-label') ?? '';
        expect(accessibleLabel).toContain(`estado: ${etiquetaEsperada}`);

        // Verificación de configuración en diccionario de estados
        expect(ESTADOS_SUSCRIPCION[estado].etiqueta).toBe(etiquetaEsperada);
      });
    });
  });

  describe('Tratamiento explícito de valores opcionales', () => {
    it('muestra costo por hora cuando horas_uso_mes está presente y es mayor a 0', () => {
      const conUso: Suscripcion = {
        ...SUSCRIPCION_BASE,
        monto: 10000,
        frecuencia: 'mensual',
        horas_uso_mes: 20, // 10000 / 20 = $500 por hora
      };

      render(<TarjetaSuscripcion suscripcion={conUso} onPress={vi.fn()} />);

      // $500/h (20 h)
      expect(screen.getByText(/500\/h/)).toBeTruthy();
      expect(screen.getByText(/20 h/)).toBeTruthy();
    });

    it('no muestra costo por hora cuando horas_uso_mes no está definido o es 0', () => {
      const sinUso: Suscripcion = {
        ...SUSCRIPCION_BASE,
        horas_uso_mes: undefined,
      };

      render(<TarjetaSuscripcion suscripcion={sinUso} onPress={vi.fn()} />);

      expect(screen.queryByText(/\/h/)).toBeNull();
    });

    it('muestra "Sin cobros pendientes" explícitamente cuando estado es cancelado', () => {
      const cancelada: Suscripcion = {
        ...SUSCRIPCION_BASE,
        estado: 'cancelado',
      };

      render(<TarjetaSuscripcion suscripcion={cancelada} onPress={vi.fn()} />);

      expect(screen.getByText('Sin cobros pendientes')).toBeTruthy();
      expect(formatearTextoCobro(cancelada)).toBe('Sin cobros pendientes');
    });

    it('muestra "Prueba termina: <fecha>" cuando estado es prueba y tiene fin_prueba', () => {
      const prueba: Suscripcion = {
        ...SUSCRIPCION_BASE,
        estado: 'prueba',
        fin_prueba: '2026-11-25',
      };

      render(<TarjetaSuscripcion suscripcion={prueba} onPress={vi.fn()} />);

      expect(screen.getByText(/Prueba termina: 25 nov 2026/)).toBeTruthy();
      expect(formatearTextoCobro(prueba)).toContain('Prueba termina: 25 nov 2026');
    });

    it('usa fallback "General" si categoria viene vacía', () => {
      const sinCategoria: Suscripcion = {
        ...SUSCRIPCION_BASE,
        categoria: '',
      };

      render(<TarjetaSuscripcion suscripcion={sinCategoria} onPress={vi.fn()} />);

      expect(screen.getByText('General')).toBeTruthy();
    });
  });

  describe('Área táctil e interacción de detalle', () => {
    it('dispara onPress con la suscripción completa al presionar el área táctil', () => {
      const onPress = vi.fn();
      render(<TarjetaSuscripcion suscripcion={SUSCRIPCION_BASE} onPress={onPress} />);

      const tarjeta = screen.getByTestId('card-suscripcion-sub-123');
      expect(tarjeta).toBeTruthy();

      fireEvent.click(tarjeta);
      expect(onPress).toHaveBeenCalledTimes(1);
      expect(onPress).toHaveBeenCalledWith(SUSCRIPCION_BASE);
    });

    it('permite sobreescribir el testID si se especifica explícitamente', () => {
      render(
        <TarjetaSuscripcion
          suscripcion={SUSCRIPCION_BASE}
          testID="custom-card-id"
          onPress={vi.fn()}
        />
      );

      expect(screen.getByTestId('custom-card-id')).toBeTruthy();
    });
  });
});
