import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { Page } from '../components/Nav';
import {
  Badge, Button, Cell, Empty, Field, Modal, Notice, Row, Table,
} from '../components/ui';

export interface SupplierRow {
  id: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  _count?: { purchases: number };
}

export function SuppliersPage() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    setRows(await api<SupplierRow[]>(`/api/suppliers${params}`));
  }, [search]);

  useEffect(() => {
    load().catch((e) =>
      setError(
        e instanceof ApiError && e.status === 403
          ? 'No tiene permiso para ver proveedores'
          : 'Error cargando proveedores',
      ),
    );
  }, [load]);

  return (
    <Page
      title="Proveedores"
      subtitle="Maestro de proveedores y su historial"
      actions={
        <>
          <Field
            icon="buscar"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar proveedor"
            className="w-56"
          />
          <Button variant="primary" icon="mas" onClick={() => setEditing('new')}>
            Nuevo proveedor
          </Button>
        </>
      }
    >
      {error && <div className="mb-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}

      <Table head={['Proveedor', 'Contacto', 'Compras', '']}>
        {rows.map((s) => (
          <Row key={s.id}>
            <Cell>
              <span
                className={
                  s.isActive
                    ? 'font-medium text-[hsl(var(--text-1))]'
                    : 'text-[hsl(var(--text-3))] line-through'
                }
              >
                {s.name}
              </span>
              {!s.isActive && <Badge>inactivo</Badge>}
              {s.taxId && (
                <span className="block text-xs text-[hsl(var(--text-3))]">NIT: {s.taxId}</span>
              )}
            </Cell>
            <Cell>
              {s.contactName ?? '—'}
              {s.phone && (
                <span className="block text-xs text-[hsl(var(--text-3))]">{s.phone}</span>
              )}
            </Cell>
            <Cell align="right" mono>{s._count?.purchases ?? 0}</Cell>
            <Cell align="right">
              <Button size="sm" variant="outline" icon="editar" onClick={() => setEditing(s)}>
                Editar
              </Button>
            </Cell>
          </Row>
        ))}
        {rows.length === 0 && (
          <tr>
            <Cell colSpan={4}><Empty icon="proveedores">Sin proveedores</Empty></Cell>
          </tr>
        )}
      </Table>

      {editing && (
        <SupplierModal
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </Page>
  );
}

function SupplierModal({
  supplier, onClose, onSaved,
}: {
  supplier: SupplierRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    taxId: supplier?.taxId ?? '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    isActive: supplier?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(supplier ? `/api/suppliers/${supplier.id}` : '/api/suppliers', {
        method: supplier ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: form.name,
          taxId: form.taxId || undefined,
          contactName: form.contactName || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          ...(supplier ? { isActive: form.isActive } : {}),
        }),
      });
      onSaved();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al guardar');
      setBusy(false);
    }
  }

  return (
    <Modal title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Nombre" required minLength={2} autoFocus value={form.name} onChange={set('name')} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="NIT" value={form.taxId} onChange={set('taxId')} />
          <Field label="Contacto" value={form.contactName} onChange={set('contactName')} />
          <Field label="Teléfono" value={form.phone} onChange={set('phone')} />
          <Field label="Correo" type="email" value={form.email} onChange={set('email')} />
        </div>
        {supplier && (
          <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-[hsl(var(--text-2))]">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="size-4 accent-[hsl(var(--accent))]"
            />
            Activo — los inactivos no aceptan compras nuevas
          </label>
        )}
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
          Guardar
        </Button>
      </form>
    </Modal>
  );
}
