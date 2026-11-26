import argon2 from 'argon2';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { CLAVES_PUBLICADAS, revisarEntorno } from './lib/credenciales.js';
import { prismaAdmin, prismaRuntime } from './lib/prisma.js';

/**
 * Comprobación de arranque de las DOS conexiones.
 *
 * El sistema usa dos roles distintos a propósito (§2.2): el administrativo
 * para el login y el panel de plataforma, y `app_runtime` —sin poder saltarse
 * el aislamiento— para todo lo demás. Si solo el segundo está mal configurado,
 * el síntoma es desconcertante: el ingreso funciona, el panel del super admin
 * funciona, y el tendero recibe "Error interno del servidor" al entrar a su
 * tienda. Pasó en producción al rotar la contraseña de ese rol sin actualizar
 * la variable.
 *
 * Por eso se comprueban las dos antes de aceptar tráfico, y el arranque falla
 * con un mensaje que nombra la variable culpable.
 */
async function verificarConexiones(): Promise<void> {
  const conexiones = [
    { nombre: 'DATABASE_URL (rol administrativo)', cliente: prismaAdmin },
    { nombre: 'APP_DATABASE_URL (rol app_runtime)', cliente: prismaRuntime },
  ];

  for (const { nombre, cliente } of conexiones) {
    try {
      await cliente.$queryRaw`SELECT 1`;
    } catch (err) {
      logger.fatal(
        { err, variable: nombre },
        `No se pudo conectar con ${nombre}. Revise que la variable esté bien ` +
          'escrita y que la contraseña del rol coincida con la de la base. ' +
          'El API no arranca a medias: serviría el login y fallaría al entrar.',
      );
      process.exit(1);
    }
  }
  logger.info('Conexiones verificadas: administrativa y de ejecución');
}

/**
 * Credenciales publicadas: el arranque se niega en producción.
 *
 * El repositorio es público y en él están, porque hacen falta para levantar
 * el proyecto, la contraseña del rol de ejecución que crea la migración de
 * RLS, el secreto de ejemplo del JWT y la clave inicial del super admin. Ya
 * pasó una vez que la del rol de ejecución siguiera siendo válida contra
 * producción, y RLS no protege de eso: quien se conecta con ese rol elige él
 * mismo el `app.tenant_id`.
 *
 * Una contraseña rotada se puede volver a olvidar en el próximo despliegue;
 * un arranque que se niega, no. En desarrollo solo avisa: ahí esas claves son
 * exactamente lo que se quiere.
 */
async function verificarCredenciales(): Promise<void> {
  const hallazgos = revisarEntorno(process.env);

  // La del super admin no se puede leer, pero sí comprobar contra el hash:
  // es la cuenta que ve a TODOS los clientes.
  try {
    const sa = await prismaAdmin.platformUser.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { email: true, passwordHash: true },
    });
    if (sa && (await argon2.verify(sa.passwordHash, CLAVES_PUBLICADAS.superAdmin))) {
      hallazgos.push({
        variable: `super admin (${sa.email})`,
        motivo:
          'conserva la contraseña inicial que está escrita en el repositorio. ' +
          'Es la cuenta que ve a todos los clientes: cámbiela antes de seguir.',
      });
    }
  } catch {
    /* si no se puede comprobar, no se bloquea el arranque por eso */
  }

  if (hallazgos.length === 0) return;

  const esProduccion = env.NODE_ENV === 'production';
  for (const h of hallazgos) {
    const mensaje = `CREDENCIAL PUBLICADA — ${h.variable} ${h.motivo}`;
    if (esProduccion) logger.fatal(mensaje);
    else logger.warn(mensaje);
  }
  if (esProduccion) {
    logger.fatal(
      'El API no arranca con credenciales que están publicadas en el repositorio.',
    );
    process.exit(1);
  }
}

await verificarConexiones();
await verificarCredenciales();

const app = createApp();
app.listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT}`);
});
