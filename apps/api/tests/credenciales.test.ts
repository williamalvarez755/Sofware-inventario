/**
 * Credenciales publicadas.
 *
 * El repositorio es público y en él están —porque hacen falta para levantar
 * el proyecto— la contraseña del rol de ejecución, el secreto de ejemplo del
 * JWT y la clave inicial del super admin. Estas pruebas fijan la detección:
 * sin ellas, el día que alguien renombre una constante el arranque dejaría de
 * avisar y nadie se enteraría hasta que fuera tarde.
 *
 * Los valores "buenos" de abajo son inventados para la prueba y no se parecen
 * a ninguna credencial real: un archivo de pruebas es tan público como el
 * resto del repositorio.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAVES_PUBLICADAS,
  LARGO_MINIMO_JWT,
  revisarEntorno,
  secretoJwtDebil,
  usaClavePublicada,
} from '../src/lib/credenciales.js';

const ROTADA = 'postgresql://app_runtime:CLAVE-DE-PRUEBA-NO-REAL@host:5432/db?sslmode=require';
const PUBLICADA = `postgresql://app_runtime:${CLAVES_PUBLICADAS.rolEjecucion}@host:5432/db`;

describe('clave publicada en la cadena de conexión', () => {
  it('detecta la que deja escrita la migración de RLS', () => {
    expect(usaClavePublicada(PUBLICADA)).toBe(true);
  });

  it('no se queja de una contraseña rotada', () => {
    expect(usaClavePublicada(ROTADA)).toBe(false);
  });

  it('mira la contraseña, no la cadena entera', () => {
    // Un servidor o una base que por casualidad se llamen así no son un
    // hallazgo; buscar la cadena suelta daría falsos positivos.
    expect(usaClavePublicada('postgresql://u:secreta@app_runtime_dev:5432/db')).toBe(false);
    expect(usaClavePublicada('postgresql://u:secreta@host:5432/app_runtime_dev')).toBe(false);
  });

  it('entiende una contraseña con caracteres escapados', () => {
    const escapada = `postgresql://app_runtime:${encodeURIComponent(
      CLAVES_PUBLICADAS.rolEjecucion,
    )}@host:5432/db`;
    expect(usaClavePublicada(escapada)).toBe(true);
  });

  it('una cadena ilegible no se reporta aquí', () => {
    // De eso avisa la comprobación de conexión, con un mensaje mucho mejor.
    expect(usaClavePublicada('esto no es una url')).toBe(false);
    expect(usaClavePublicada(undefined)).toBe(false);
  });
});

describe('secreto de firma', () => {
  it('rechaza el de ejemplo, el ausente y el corto', () => {
    expect(secretoJwtDebil(CLAVES_PUBLICADAS.jwt)).toMatch(/ejemplo/);
    expect(secretoJwtDebil(undefined)).toMatch(/no está definido/);
    expect(secretoJwtDebil('corto')).toMatch(/mínimo/);
  });

  it('acepta uno largo y propio', () => {
    expect(secretoJwtDebil('x'.repeat(LARGO_MINIMO_JWT))).toBeNull();
  });
});

describe('revisión completa del entorno', () => {
  it('nombra cada variable culpable', () => {
    const hallazgos = revisarEntorno({
      DATABASE_URL: PUBLICADA,
      APP_DATABASE_URL: PUBLICADA,
      JWT_SECRET: CLAVES_PUBLICADAS.jwt,
    });
    expect(hallazgos.map((h) => h.variable).sort()).toEqual([
      'APP_DATABASE_URL',
      'DATABASE_URL',
      'JWT_SECRET',
    ]);
  });

  it('un entorno bien configurado no produce hallazgos', () => {
    expect(
      revisarEntorno({
        DATABASE_URL: ROTADA,
        APP_DATABASE_URL: ROTADA,
        JWT_SECRET: 'y'.repeat(LARGO_MINIMO_JWT + 8),
      }),
    ).toEqual([]);
  });
});
