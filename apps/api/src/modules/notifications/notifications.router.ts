import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/** Bandeja del usuario autenticado (RLS + filtro por userId). */
notificationsRouter.get('/', async (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const [rows, unread] = await Promise.all([
    req.db!.notification.findMany({
      where: { userId: req.auth!.userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    req.db!.notification.count({ where: { userId: req.auth!.userId, readAt: null } }),
  ]);
  res.json({ unread, rows });
});

notificationsRouter.post('/read', async (req, res) => {
  const ids: unknown = req.body?.ids;
  const result = await req.db!.notification.updateMany({
    where: {
      userId: req.auth!.userId,
      readAt: null,
      ...(Array.isArray(ids) && ids.length > 0 ? { id: { in: ids as string[] } } : {}),
    },
    data: { readAt: new Date() },
  });
  res.json({ updated: result.count });
});
