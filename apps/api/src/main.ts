import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
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

await verificarConexiones();

const app = createApp();
app.listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT}`);
});
