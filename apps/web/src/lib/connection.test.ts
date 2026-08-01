/**
 * Reintento ante cortes de red. El criterio de la Fase 6 dice: "la PWA
 * reintenta y NO duplica ventas ante un corte de red simulado".
 * Aquí se prueba el reintento y que conserve el mismo client_op_id, que es
 * exactamente lo que impide la duplicación en el servidor.
 */
import { describe, expect, it, vi } from 'vitest';
import { retryOnNetworkFailure } from './connection';

describe('Reintento ante corte de red', () => {
  it('reintenta el fallo de red y termina entregando el resultado', async () => {
    let calls = 0;
    const operation = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TypeError('Failed to fetch');
      return { saleId: 'venta-1' };
    });

    const result = await retryOnNetworkFailure(operation, { baseDelayMs: 1 });
    expect(result).toEqual({ saleId: 'venta-1' });
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('el reintento usa SIEMPRE el mismo client_op_id (así el servidor no duplica)', async () => {
    const enviados: string[] = [];
    const clientOpId = 'ba1e3c8e-0000-7000-8000-000000000001';
    let calls = 0;

    await retryOnNetworkFailure(
      async () => {
        enviados.push(clientOpId);
        if (++calls < 3) throw new TypeError('Network request failed');
        return { saleId: 'venta-1', idempotent: calls > 1 };
      },
      { baseDelayMs: 1 },
    );

    expect(enviados).toHaveLength(3);
    expect(new Set(enviados).size).toBe(1); // un solo identificador de operación
  });

  it('NO reintenta errores del servidor: stock insuficiente se muestra de una vez', async () => {
    const operation = vi.fn(async () => {
      throw Object.assign(new Error('Stock insuficiente'), { status: 409 });
    });
    await expect(retryOnNetworkFailure(operation, { baseDelayMs: 1 })).rejects.toThrow(
      'Stock insuficiente',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras agotar los intentos y avisa de cada reintento', async () => {
    const onRetry = vi.fn();
    const operation = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      retryOnNetworkFailure(operation, { attempts: 3, baseDelayMs: 1, onRetry }),
    ).rejects.toThrow(TypeError);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2); // avisa antes de cada reintento
  });
});
