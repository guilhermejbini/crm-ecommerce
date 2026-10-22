import { describe, it, expect } from 'vitest';
// @ts-ignore - script Node em JS puro
import { runCleanup } from '../scripts/demo-cleanup.mjs';

const BASE = 'https://firestore.googleapis.com/v1/projects/p/databases/db/documents';

/** Firestore REST falso, em memória (nenhum acesso real). */
function fakeFirestore(data: Record<string, Array<{ id: string; isDemo?: boolean }>>) {
  const db = new Map(Object.entries(data).map(([c, docs]) => [c, new Map(docs.map(d => [d.id, d]))]));
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: any = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    const json = (b: any) => ({ ok: true, status: 200, json: async () => b });
    if (url.endsWith('documents:listCollectionIds')) return json({ collectionIds: Array.from(db.keys()) });
    if (url.endsWith('documents:batchWrite')) {
      const { writes } = JSON.parse(init.body);
      writes.forEach((w: any) => {
        const parts = w.delete.replace(`${BASE}/`, '').split('/');
        db.get(parts[0])?.delete(parts[1]);
      });
      return json({});
    }
    const col = decodeURIComponent(url.replace(`${BASE}/`, '').split('?')[0]);
    const docs = Array.from(db.get(col)?.values() || []).map(d => ({
      name: `${BASE}/${col}/${d.id}`,
      fields: d.isDemo ? { isDemo: { booleanValue: true } } : {}
    }));
    return json({ documents: docs });
  };
  return { db, calls, fetchImpl };
}

const seed = () => ({
  customers: [{ id: 'cust-0001', isDemo: true }, { id: 'cust-0002' }],
  purchases: [{ id: 'pdv_store-01_CF-482910_20250110' }],
  campaigns: [{ id: 'camp-1' }],
  audit_logs: [{ id: 'log-1' }],
  authorized_users: [{ id: 'admin@exemplo.test' }],
  stores: [{ id: 'store-01' }, { id: 'store-02' }, { id: 'store-03' }],
  settings: [{ id: 'loyalty' }]
});
const opts = (f: any, argv: string[]) => ({ fetchImpl: f.fetchImpl, token: 't', projectId: 'p', databaseId: 'db', argv, log: () => {} });

describe('scripts/demo-cleanup.mjs (Firestore simulado)', () => {
  it('dry run (padrão) só lê e reporta; não apaga nada', async () => {
    const f = fakeFirestore(seed());
    const r = await runCleanup(opts(f, []));
    expect(r.executed).toBe(false);
    expect(r.report.customers).toMatchObject({ role: 'LIMPAR', count: 2, docsWithDemoHints: 2 });
    expect(r.report.stores.role).toBe('PRESERVAR');
    expect(f.calls.some(c => c.includes('batchWrite'))).toBe(false);
    expect(f.db.get('customers')!.size).toBe(2);
  });

  it('--execute sem confirmação é recusado', async () => {
    const f = fakeFirestore(seed());
    await expect(runCleanup(opts(f, ['--execute']))).rejects.toThrow(/confirm-no-real-data/);
    expect(f.db.get('customers')!.size).toBe(2);
  });

  it('execução apaga só coleções operacionais e preserva lojas, authorized_users, settings e audit_logs', async () => {
    const f = fakeFirestore(seed());
    const r = await runCleanup(opts(f, ['--execute', '--confirm-no-real-data']));
    expect(r.deleted).toBe(4);
    ['customers', 'purchases', 'campaigns'].forEach(c => expect(f.db.get(c)!.size).toBe(0));
    expect(f.db.get('stores')!.size).toBe(3);
    expect(f.db.get('authorized_users')!.size).toBe(1);
    expect(f.db.get('settings')!.size).toBe(1);
    expect(f.db.get('audit_logs')!.size).toBe(1);
  });

  it('audit_logs só com --include-audit-logs', async () => {
    const f = fakeFirestore(seed());
    await runCleanup(opts(f, ['--execute', '--confirm-no-real-data', '--include-audit-logs']));
    expect(f.db.get('audit_logs')!.size).toBe(0);
    expect(f.db.get('stores')!.size).toBe(3);
  });

  it('coleção desconhecida => execução recusada (dúvida = parar)', async () => {
    const f = fakeFirestore({ ...seed(), financeiro_real: [{ id: 'x' }] });
    await expect(runCleanup(opts(f, ['--execute', '--confirm-no-real-data']))).rejects.toThrow(/desconhecidas/);
    expect(f.db.get('customers')!.size).toBe(2);
    expect(f.db.get('financeiro_real')!.size).toBe(1);
  });
});
