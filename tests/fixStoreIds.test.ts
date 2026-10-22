import { describe, it, expect } from 'vitest';
// @ts-ignore - script Node em JS puro
import * as fixStoreIds from '../scripts/fix-store-ids.mjs';

const { runFixStoreIds, stableHash, maskId } = fixStoreIds as any;

const ROOT = 'projects/p/databases/db';
const BASE = `${ROOT}/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;

type Doc = { name: string; fields: Record<string, any>; updateTime: string };

/** Firestore REST falso, em memória, com commit atômico e pré-condições (nenhum acesso real). */
function fakeFirestore(seed: Record<string, Record<string, Record<string, any>>>) {
  let clock = 0;
  const tick = () => `2026-09-29T00:00:${String(++clock).padStart(2, '0')}.000000Z`;
  const toValue = (v: any): any => (typeof v === 'string' ? { stringValue: v }
    : typeof v === 'number' ? { doubleValue: v }
    : Array.isArray(v) ? { arrayValue: { values: v.map(toValue) } }
    : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } });
  const docs = new Map<string, Doc>();
  for (const [col, byId] of Object.entries(seed)) {
    for (const [id, data] of Object.entries(byId)) {
      const name = `${BASE}/${col}/${id}`;
      docs.set(name, { name, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)])), updateTime: tick() });
    }
  }
  const writes: any[] = [];
  const fetchImpl = async (url: string, init: any = {}) => {
    const json = (b: any, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (url === `${API}/documents:listCollectionIds`) {
      const cols = new Set(Array.from(docs.keys()).map(n => n.slice(BASE.length + 1).split('/')[0]));
      return json({ collectionIds: Array.from(cols) });
    }
    if (url === `${API}/documents:commit`) {
      const { writes: ws } = JSON.parse(init.body);
      const next = new Map(Array.from(docs.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
      for (const w of ws) {
        const target = w.update ? w.update.name : w.delete;
        const cur = next.get(target);
        const pre = w.currentDocument;
        if (pre?.exists === false && cur) return json({ error: { message: `ALREADY_EXISTS ${target}` } }, 409);
        if (pre?.updateTime && (!cur || cur.updateTime !== pre.updateTime)) return json({ error: { message: `FAILED_PRECONDITION ${target}` } }, 400);
        if (w.delete) { next.delete(target); continue; }
        const fields = w.updateMask ? { ...(cur?.fields || {}), ...Object.fromEntries(w.updateMask.fieldPaths.map((k: string) => [k, w.update.fields[k]])) } : w.update.fields;
        next.set(target, { name: target, fields, updateTime: tick() });
      }
      docs.clear();
      next.forEach((v, k) => docs.set(k, v));
      writes.push(...ws);
      return json({});
    }
    const col = decodeURIComponent(url.replace(`${API}/documents/`, '').split('?')[0]);
    return json({ documents: Array.from(docs.values()).filter(d => d.name.startsWith(`${BASE}/${col}/`)) });
  };
  const get = (col: string, id: string) => docs.get(`${BASE}/${col}/${id}`);
  const s = (col: string, id: string, field: string) => get(col, id)?.fields[field]?.stringValue;
  const snapshot = () => JSON.stringify(Array.from(docs.values()).map(d => [d.name, d.fields]).sort());
  return { docs, writes, fetchImpl, get, s, snapshot };
}

// Compra sem número gravada antes da correção (hash com store-01)
const semCupomOld = `SEM-CUPOM-${stableHash(['store-01', '2025-01-10T12:15:00.000Z', 'pdv 03', '52998224725'].join('|'))}`;
const semCupomNew = `SEM-CUPOM-${stableHash(['store-02', '2025-01-10T12:15:00.000Z', 'pdv 03', '52998224725'].join('|'))}`;

const OLD_EMILIO = 'Super Astral - Av. Emílio Johnson, 675';
const OLD_BINI = 'Super Astral - Travessa Paulo Bini, 250';

const seed = () => ({
  stores: {
    'store-01': { id: 'store-01', code: 'LJ01', name: 'Super Astral - Av. Emílio Johnson', address: 'Av. Emílio Johnson, 675', managerName: 'Carlos', latitude: -25.3115083 },
    'store-02': { id: 'store-02', code: 'LJ02', name: 'Super Astral - Travessa Paulo Bini', address: 'Travessa Paulo Bini, 250', managerName: 'Mariana', latitude: -25.3163582 },
    'store-03': { id: 'store-03', code: 'LJ03', name: 'Super Astral Bertolina', address: 'Rua Bertolina Kendrick de Oliveira' }
  },
  purchases: {
    // mesmo cupom/data nas duas lojas: renomeação cruzada (troca de IDs)
    'pdv_store-01_1001_20250110': { id: 'pdv_store-01_1001_20250110', storeId: 'store-01', storeName: OLD_EMILIO, customerId: 'cust-1', couponReceiptNumber: '1001', netAmount: 10 },
    'pdv_store-02_1001_20250110': { id: 'pdv_store-02_1001_20250110', storeId: 'store-02', storeName: OLD_BINI, customerId: 'cust-2', couponReceiptNumber: '1001', netAmount: 20 },
    [`pdv_store-01_${semCupomOld}_20250110`]: {
      id: `pdv_store-01_${semCupomOld}_20250110`, storeId: 'store-01', storeName: OLD_EMILIO, customerId: 'cust-1',
      couponReceiptNumber: semCupomOld, purchaseDate: '2025-01-10T12:15:00.000Z', posNumber: 'PDV 03', customerCpf: '529.982.247-25', netAmount: 5
    },
    'pdv_store-03_7_20250110': { id: 'pdv_store-03_7_20250110', storeId: 'store-03', storeName: 'Super Astral Bertolina - Rua Bertolina Kendrick de Oliveira, 1025', couponReceiptNumber: '7', netAmount: 3 },
    'pdv_store-01_9_20250110': { id: 'pdv_store-01_9_20250110', storeId: 'store-01', storeName: 'Super Astral Loja 01', couponReceiptNumber: '9', netAmount: 4 }
  },
  customers: {
    'cust-1': { name: 'Cliente Um', favoriteStoreId: 'store-01', favoriteStoreName: OLD_EMILIO },
    'cust-2': { name: 'Cliente Dois', favoriteStoreId: 'store-02' }, // sem nome: inferido pelas compras
    'cust-flex-52998224725': { name: 'Cliente Três', favoriteStoreId: 'store-01' }, // sem nome e sem compras: ambíguo
    'cust-4': { name: 'Cliente Quatro' },
    // gravado pela função do site (matriz): ID certo, nome trocado
    'cust-site-402c935df5d8160887be0964': { name: 'Cadastro Site', favoriteStoreId: 'store-01', favoriteStoreName: 'Super Astral - Av. Emílio Johnson' }
  },
  club_offer_usages: { 'usage-1': { storeId: 'store-02', storeName: OLD_BINI } },
  interactions: { 'int-1': { storeName: OLD_EMILIO } },
  audit_logs: { 'log-1': { description: 'Importação na store-01' } }
});

const opts = (f: any, argv: string[], extra: any = {}) => ({
  fetchImpl: f.fetchImpl, token: 't', projectId: 'p', databaseId: 'db', argv, log: () => {},
  writeFile: (p: string, c: string) => { extra.files = extra.files || {}; extra.files[p] = c; },
  readFile: (p: string) => extra.files[p],
  backupDir: '/tmp', now: () => new Date('2026-09-29T15:00:00Z')
});

describe('scripts/fix-store-ids.mjs (Firestore simulado)', () => {
  it('simulação (padrão) só lê: contagens e exemplos, nenhuma escrita', async () => {
    const f = fakeFirestore(seed());
    const before = f.snapshot();
    const lines: string[] = [];
    const r = await runFixStoreIds({ ...opts(f, []), log: (l: string) => lines.push(l) });
    expect(r.executed).toBe(false);
    expect(f.writes).toHaveLength(0);
    expect(f.snapshot()).toBe(before);
    expect(r.plan.stores.status).toBe('swap');
    expect(r.plan.purchases).toMatchObject({ scanned: 5, relink: 3, labelOnly: 1, renames: 3, conflicts: [] });
    expect(r.plan.purchases.ambiguous).toEqual(['pdv_store-01_9_20250110']);
    expect(r.plan.customers).toMatchObject({ relink: 2, labelOnly: 1, inferredFromPurchases: 1, fromSiteId: 1 });
    expect(r.plan.customers.ambiguous).toEqual(['cust-flex-52998224725']);
    // relatório sem CPF em claro
    expect(lines.join('\n')).not.toContain('52998224725');
    expect(maskId('cust-flex-52998224725')).toBe('cust-flex-529******25');
  });

  it('executa, preserva vínculos e renomeia IDs; rodar de novo não altera nada; rollback restaura', async () => {
    const f = fakeFirestore(seed());
    const before = f.snapshot();
    const extra: any = {};
    const r = await runFixStoreIds(opts(f, ['--execute'], extra));
    expect(r.executed).toBe(true);

    // lojas: conteúdo físico trocado, sem criar/apagar documentos
    expect([f.s('stores', 'store-01', 'code'), f.s('stores', 'store-01', 'name'), f.s('stores', 'store-01', 'address'), f.s('stores', 'store-01', 'managerName')])
      .toEqual(['LJ01', 'Astral Rodovia dos Minérios', 'Travessa Paulo Bini, 250', 'Mariana']);
    expect([f.s('stores', 'store-02', 'code'), f.s('stores', 'store-02', 'name'), f.s('stores', 'store-02', 'managerName')])
      .toEqual(['LJ02', 'Astral Centro', 'Carlos']);
    // store-03: só o nome muda
    expect(f.s('stores', 'store-03', 'name')).toBe('Astral Bertolina');
    expect(f.s('stores', 'store-03', 'address')).toBe('Rua Bertolina Kendrick de Oliveira');
    expect(f.s('stores', 'store-03', 'code')).toBe('LJ03');

    // compras: cada uma na loja física, IDs coerentes, nenhuma perdida
    expect(f.s('purchases', 'pdv_store-02_1001_20250110', 'customerId')).toBe('cust-1');
    expect(f.s('purchases', 'pdv_store-02_1001_20250110', 'storeId')).toBe('store-02');
    expect(f.s('purchases', 'pdv_store-02_1001_20250110', 'id')).toBe('pdv_store-02_1001_20250110');
    expect(f.s('purchases', 'pdv_store-01_1001_20250110', 'customerId')).toBe('cust-2');
    expect(f.s('purchases', 'pdv_store-01_1001_20250110', 'storeName')).toBe('Astral Rodovia dos Minérios - Travessa Paulo Bini, 250');
    expect(f.get('purchases', `pdv_store-01_${semCupomOld}_20250110`)).toBeUndefined();
    expect(f.s('purchases', `pdv_store-02_${semCupomNew}_20250110`, 'couponReceiptNumber')).toBe(semCupomNew);
    expect(f.s('purchases', 'pdv_store-03_7_20250110', 'storeId')).toBe('store-03');
    expect(f.s('purchases', 'pdv_store-03_7_20250110', 'storeName')).toBe('Astral Bertolina - Rua Bertolina Kendrick de Oliveira, 1025');
    expect(f.s('purchases', 'pdv_store-01_9_20250110', 'storeId')).toBe('store-01'); // ambígua: intocada
    expect(Array.from(f.docs.keys()).filter(n => n.includes('/purchases/'))).toHaveLength(5);

    // clientes e demais referências
    expect([f.s('customers', 'cust-1', 'favoriteStoreId'), f.s('customers', 'cust-1', 'favoriteStoreName')])
      .toEqual(['store-02', 'Astral Centro - Avenida Emílio Johnson, 675']);
    expect(f.s('customers', 'cust-2', 'favoriteStoreId')).toBe('store-01'); // inferido: a compra dele é da Paulo Bini
    expect(f.s('customers', 'cust-2', 'name')).toBe('Cliente Dois');
    expect(f.s('customers', 'cust-flex-52998224725', 'favoriteStoreId')).toBe('store-01'); // ambíguo: intocado
    // cadastro do site: continua na Loja 01 (matriz), só o nome é corrigido
    expect([f.s('customers', 'cust-site-402c935df5d8160887be0964', 'favoriteStoreId'), f.s('customers', 'cust-site-402c935df5d8160887be0964', 'favoriteStoreName')])
      .toEqual(['store-01', 'Astral Rodovia dos Minérios - Travessa Paulo Bini, 250']);
    expect(f.s('club_offer_usages', 'usage-1', 'storeId')).toBe('store-01');
    expect(f.s('interactions', 'int-1', 'storeName')).toBe('Astral Centro - Avenida Emílio Johnson, 675');
    expect(f.s('audit_logs', 'log-1', 'description')).toBe('Importação na store-01');

    // idempotente
    const after = f.snapshot();
    const writesBefore = f.writes.length;
    const again = await runFixStoreIds(opts(f, ['--execute'], extra));
    expect(again.changes).toBe(0);
    expect(f.writes.length).toBe(writesBefore);
    expect(f.snapshot()).toBe(after);

    // rollback a partir do backup
    await runFixStoreIds(opts(f, ['--rollback', r.backupFile], extra));
    expect(f.snapshot()).toBe(before);
  });

  it('referência de loja em campo não tratado bloqueia a execução até revisão', async () => {
    const data: any = seed();
    data.customers['cust-site'] = { name: 'Cadastro Site', storeSlug: 'paulo-bini' };
    const f = fakeFirestore(data);
    await expect(runFixStoreIds(opts(f, ['--execute']))).rejects.toThrow(/campos não tratados/);
    expect(f.writes).toHaveLength(0);
    const r = await runFixStoreIds(opts(f, [], {}));
    expect(r.plan.unknownRefs['customers.storeSlug']).toMatchObject({ count: 1 });
    const ok = await runFixStoreIds(opts(f, ['--execute', '--accept-unknown-refs'], {}));
    expect(ok.executed).toBe(true);
  });

  it('base já correta: nada a fazer', async () => {
    const f = fakeFirestore({
      stores: {
        'store-01': { code: 'LJ01', name: 'Astral Rodovia dos Minérios', address: 'Travessa Paulo Bini, 250' },
        'store-02': { code: 'LJ02', name: 'Astral Centro', address: 'Avenida Emílio Johnson, 675' },
        'store-03': { code: 'LJ03', name: 'Astral Bertolina', address: 'Rua Bertolina Kendrick de Oliveira' }
      },
      purchases: { 'pdv_store-01_1_20250110': { storeId: 'store-01', storeName: 'Astral Rodovia dos Minérios - Travessa Paulo Bini, 250' } }
    });
    const r = await runFixStoreIds(opts(f, ['--execute']));
    expect(r.changes).toBe(0);
    expect(f.writes).toHaveLength(0);
  });

  it('destino ocupado por outra compra que não se move: não sobrescreve (conflito reportado)', async () => {
    const f = fakeFirestore({
      stores: seed().stores,
      purchases: {
        'pdv_store-01_5_20250110': { storeId: 'store-01', storeName: OLD_EMILIO, couponReceiptNumber: '5' },
        // já existe uma compra (correta) da Emílio com o mesmo cupom/data
        'pdv_store-02_5_20250110': { storeId: 'store-02', storeName: 'Astral Centro - Avenida Emílio Johnson, 675', couponReceiptNumber: '5' }
      }
    });
    const r = await runFixStoreIds(opts(f, ['--execute']));
    expect(r.plan.purchases.conflicts).toEqual(['pdv_store-01_5_20250110 -> pdv_store-02_5_20250110']);
    expect(f.s('purchases', 'pdv_store-02_5_20250110', 'storeName')).toBe('Astral Centro - Avenida Emílio Johnson, 675');
    expect(f.get('purchases', 'pdv_store-01_5_20250110')).toBeDefined();
  });
});
