import { Router } from 'express';
import { PERMISSIONS } from '@minimarket/shared';
import {
  userAssignStoresSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@minimarket/shared';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import {
  actualizarUsuario,
  asignarTiendas,
  crearUsuario,
  listarUsuarios,
  reiniciarContrasena,
  type ActorContext,
} from './users.service.js';

/**
 * Usuarios de la tienda. Todo exige `users.manage`, que según la matriz de
 * CLAUDE.md §3.2 tienen OWNER y STORE_ADMIN.
 *
 * Las reglas que impiden la escalada de privilegios viven en el SERVICIO, no
 * aquí (D-037): una ruta nueva que olvide comprobarlas quedaría abierta, y en
 * el servicio queda cubierto cualquier llamador, presente o futuro.
 */
export const usersRouter = Router();
usersRouter.use(requireAuth);

function actor(req: Parameters<Parameters<typeof usersRouter.get>[1]>[0]): ActorContext {
  return {
    tenantId: req.auth!.tenantId!,
    userId: req.auth!.userId,
    memberships: req.memberships!,
  };
}

usersRouter.get('/', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  res.json(await listarUsuarios(req.auth!.tenantId!));
});

usersRouter.post(
  '/',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate(userCreateSchema),
  async (req, res) => {
    res.status(201).json(await crearUsuario(actor(req), req.body, req));
  },
);

usersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate(userUpdateSchema),
  async (req, res) => {
    res.json(await actualizarUsuario(actor(req), req.params.id as string, req.body, req));
  },
);

usersRouter.put(
  '/:id/stores',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate(userAssignStoresSchema),
  async (req, res) => {
    res.json(await asignarTiendas(actor(req), req.params.id as string, req.body.stores, req));
  },
);

usersRouter.post(
  '/:id/password',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  async (req, res) => {
    res.json(await reiniciarContrasena(actor(req), req.params.id as string, req));
  },
);
