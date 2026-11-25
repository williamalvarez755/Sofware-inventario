import { describe, expect, it } from 'vitest';
import { crearColaEscaneos } from './colaEscaneos';

/** Promesa que se resuelve cuando uno quiere: simula una búsqueda en vuelo. */
function diferida() {
  let resolver!: () => void;
  const promesa = new Promise<void>((r) => {
    resolver = r;
  });
  return { promesa, resolver };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('cola de escaneos', () => {
  it('no pierde los códigos que llegan mientras procesa el anterior', async () => {
    // Esta es LA prueba del fallo reportado: cuatro escaneos seguidos sin
    // pausa entraba uno solo. El primero se queda en vuelo a propósito,
    // que es lo que pasa de verdad con la red de una tienda.
    const procesados: string[] = [];
    const primera = diferida();
    let llamadas = 0;

    const cola = crearColaEscaneos(async (codigo) => {
      llamadas += 1;
      procesados.push(codigo);
      if (llamadas === 1) await primera.promesa;
    });

    cola.encolar('7401');
    cola.encolar('7402');
    cola.encolar('7403');
    cola.encolar('7404');
    await tick();

    // Con el primero todavía en vuelo, los otros tres esperan su turno:
    // ninguno se descartó.
    expect(procesados).toEqual(['7401']);
    expect(cola.pendientes()).toBe(3);

    primera.resolver();
    await tick();

    expect(procesados).toEqual(['7401', '7402', '7403', '7404']);
    expect(cola.pendientes()).toBe(0);
  });

  it('respeta el orden en que se escanearon', async () => {
    const procesados: string[] = [];
    const cola = crearColaEscaneos(async (codigo) => {
      await tick();
      procesados.push(codigo);
    });

    for (const c of ['a', 'b', 'c']) cola.encolar(c);
    await tick();
    await tick();
    await tick();
    await tick();

    expect(procesados).toEqual(['a', 'b', 'c']);
  });

  it('un código que falla no detiene a los que vienen atrás', async () => {
    // Escanear algo que no existe es normal en una tienda; no puede dejar
    // la caja muerta hasta recargar.
    const procesados: string[] = [];
    const fallidos: string[] = [];

    const cola = crearColaEscaneos(
      async (codigo) => {
        if (codigo === 'malo') throw new Error('no existe');
        procesados.push(codigo);
      },
      (codigo) => fallidos.push(codigo),
    );

    cola.encolar('bueno1');
    cola.encolar('malo');
    cola.encolar('bueno2');
    await tick();

    expect(procesados).toEqual(['bueno1', 'bueno2']);
    expect(fallidos).toEqual(['malo']);
  });

  it('ignora vacíos y recorta espacios', async () => {
    const procesados: string[] = [];
    const cola = crearColaEscaneos(async (c) => {
      procesados.push(c);
    });

    cola.encolar('   ');
    cola.encolar('');
    cola.encolar('  7401  ');
    await tick();

    expect(procesados).toEqual(['7401']);
  });

  it('vaciar descarta lo pendiente sin tocar lo que ya está en vuelo', async () => {
    const procesados: string[] = [];
    const primera = diferida();
    let llamadas = 0;

    const cola = crearColaEscaneos(async (codigo) => {
      llamadas += 1;
      procesados.push(codigo);
      if (llamadas === 1) await primera.promesa;
    });

    cola.encolar('7401');
    cola.encolar('7402');
    await tick();
    cola.vaciar();
    primera.resolver();
    await tick();

    expect(procesados).toEqual(['7401']);
    expect(cola.pendientes()).toBe(0);
  });
});
