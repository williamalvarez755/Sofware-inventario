# Respaldos y restauración

> **Ensayo realizado el 2026-08-01** sobre la base de desarrollo (115 ventas,
> 7,667 movimientos de kardex, 743 registros de auditoría). Resultado: los
> conteos, los totales y **todas las defensas de seguridad** sobrevivieron
> intactos. Repetir este ensayo **cada mes** — un respaldo que nunca se
> restauró no es un respaldo, es una suposición.

## Qué respalda Aiven por sí solo

El servicio gestionado hace respaldo automático diario y conserva WAL para
restauración a un punto en el tiempo (PITR). Verifique en la consola de Aiven
que la retención sea la del plan contratado y que aparezcan respaldos recientes.

**Eso no exime del ensayo:** lo que importa no es que el respaldo exista, sino
que se pueda restaurar y que lo restaurado siga siendo seguro.

## Respaldo manual (antes de una migración grande)

```bash
pg_dump "$DATABASE_URL" -Fc -f respaldo_$(date +%F).dump
```

El formato `-Fc` (custom) permite restaurar tablas sueltas y comprime solo.

## Ensayo de restauración (mensual)

1. Crear una base vacía aparte — **nunca** restaurar sobre producción:
   ```bash
   createdb minimarket_restore
   pg_restore -d minimarket_restore --no-owner respaldo_2026-08-01.dump
   ```

2. **Comparar los ledgers** contra el origen. Deben coincidir exactamente:
   ```sql
   SELECT 'ventas' AS tabla, COUNT(*)::text FROM sales
   UNION ALL SELECT 'lineas', COUNT(*)::text FROM sale_items
   UNION ALL SELECT 'kardex', COUNT(*)::text FROM inventory_movements
   UNION ALL SELECT 'caja', COUNT(*)::text FROM cash_movements
   UNION ALL SELECT 'auditoria', COUNT(*)::text FROM audit_logs
   UNION ALL SELECT 'suma_ventas', COALESCE(SUM(total),0)::text
     FROM sales WHERE status='COMPLETED'
   ORDER BY 1;
   ```

3. **Verificar que las defensas viajaron con los datos.** Este es el paso que
   suele olvidarse: una base restaurada sin RLS entrega datos de un cliente a
   otro sin que nada falle a la vista.
   ```sql
   -- Esperado el 2026-08-01: 28 tablas con RLS, 56 políticas, 9 triggers
   SELECT COUNT(*) FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
     WHERE t.schemaname = 'public' AND c.relrowsecurity;
   SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
   SELECT COUNT(*) FROM pg_trigger WHERE tgname LIKE 'trg_%' AND NOT tgisinternal;
   ```

4. **Prueba funcional del aislamiento** — la prueba que de verdad cuenta:
   ```sql
   SET ROLE app_runtime;
   SELECT COUNT(*) FROM products;  -- DEBE devolver 0 (sin contexto de tenant)
   ```
   Si devuelve filas, la restauración perdió RLS: **no la promueva a producción**.

5. **Confirmar que el rol de runtime sigue sin acceso al material sensible:**
   ```sql
   SELECT tablename, has_table_privilege('app_runtime', 'public.'||tablename, 'SELECT')
   FROM pg_tables WHERE schemaname='public'
     AND tablename IN ('recovery_codes','refresh_tokens','platform_users');
   -- Las tres deben dar false
   ```

6. Borrar la base de ensayo: `dropdb minimarket_restore`.

## Restauración real ante un desastre

1. Poner el Web Service de Render en mantenimiento (o suspenderlo) para que
   nadie escriba mientras se restaura.
2. Restaurar sobre una base **nueva** y correr los pasos 2 a 5 de arriba.
3. Apuntar `DATABASE_URL` y `APP_DATABASE_URL` a la base restaurada.
4. Volver a fijar la contraseña del rol de runtime:
   `ALTER ROLE app_runtime PASSWORD '<secreto>';`
5. Reactivar el servicio y validar con un login real y una venta de prueba.

## Registro de ensayos

| Fecha | Origen | Resultado |
|---|---|---|
| 2026-08-01 | desarrollo (115 ventas, 7,667 mov. kardex) | ✅ Conteos, totales, 28 tablas con RLS, 56 políticas, 9 triggers y permisos del rol runtime idénticos. Aislamiento verificado funcionalmente. |
