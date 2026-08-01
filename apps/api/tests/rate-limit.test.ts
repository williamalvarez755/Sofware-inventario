/**
 * Claves de los limitadores de autenticación.
 *
 * Lo que se garantiza aquí es la propiedad que motivó el diseño: en una tienda
 * todos los cajeros salen por la MISMA conexión, así que el cubo de intentos
 * de contraseña debe ser por cuenta — si no, un compañero equivocándose deja
 * fuera a los demás en pleno mostrador.
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { accountKey, ipKey } from '../src/middleware/rate-limit.js';

function fakeRequest(ip: string, email?: string): Request {
  return { ip, body: email ? { email } : {} } as unknown as Request;
}

describe('Clave por cuenta', () => {
  it('dos cajeros de la misma tienda NO comparten cubo', () => {
    const a = accountKey(fakeRequest('190.10.20.30', 'cajero1@tienda.gt'));
    const b = accountKey(fakeRequest('190.10.20.30', 'cajero2@tienda.gt'));
    expect(a).not.toBe(b);
  });

  it('el mismo cajero desde la misma conexión sí comparte cubo', () => {
    const a = accountKey(fakeRequest('190.10.20.30', 'cajero1@tienda.gt'));
    const b = accountKey(fakeRequest('190.10.20.30', 'CAJERO1@Tienda.GT  '));
    expect(a).toBe(b); // normaliza mayúsculas y espacios: no se evade así
  });

  it('la misma cuenta desde otra conexión usa cubo aparte', () => {
    const a = accountKey(fakeRequest('190.10.20.30', 'duena@tienda.gt'));
    const b = accountKey(fakeRequest('181.55.44.33', 'duena@tienda.gt'));
    expect(a).not.toBe(b);
  });
});

describe('Clave por conexión', () => {
  it('agrupa IPv6 por prefijo /64 para que un bloque no evada el límite', () => {
    const a = ipKey(fakeRequest('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd'));
    const b = ipKey(fakeRequest('2001:db8:1234:5678:1111:2222:3333:4444'));
    expect(a).toBe(b);

    const otherBlock = ipKey(fakeRequest('2001:db8:1234:9999:aaaa:bbbb:cccc:dddd'));
    expect(otherBlock).not.toBe(a);
  });

  it('IPv4 se usa tal cual', () => {
    expect(ipKey(fakeRequest('190.10.20.30'))).toBe('190.10.20.30');
  });

  it('una petición sin IP no revienta ni colapsa a la clave de otro', () => {
    const sinIp = ipKey({ body: {} } as unknown as Request);
    expect(sinIp).toBe('desconocida');
  });
});
