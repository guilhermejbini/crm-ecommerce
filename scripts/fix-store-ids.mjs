#!/usr/bin/env node
/**
 * Correção da identificação das lojas 01 e 02 no Firestore do CRM Super Astral.
 *
 *   Antes (errado):  store-01 = Av. Emílio Johnson, 675   | store-02 = Travessa Paulo Bini, 250
 *   Depois (certo):  store-01 = Astral Rodovia dos Minérios (Travessa Paulo Bini, 250)  [LJ01]
 *                    store-02 = Astral Centro (Avenida Emílio Johnson, 675)             [LJ02]
 *                    store-03 = Astral Bertolina (só o nome muda; endereço e dados mantidos) [LJ03]
 *
 * Cada registro é ligado à loja FÍSICA indicada pelo nome/endereço gravado nele, não apenas
 * pelo ID. Registros já corretos não são tocados (idempotente: rodar de novo não altera nada).
 *
 * O que é corrigido:
 *   - stores: troca o conteúdo físico dos documentos store-01 e store-02 (sem criar/apagar lojas)
 *   - purchases: storeId/storeName; o ID do documento (pdv_store-0X_...) é renomeado para a loja certa;
 *                cupons SEM-CUPOM-<hash> só são renomeados se o hash antigo for reproduzido exatamente
 *   - customers: favoriteStoreId/favoriteStoreName
 *   - club_offer_usages: storeId/storeName
 *   - interactions: storeName (rótulo)
 * Qualquer outra referência a store-01/store-02/slugs do site encontrada é só listada; a execução é
 * recusada até que seja revisada (--accept-unknown-refs após revisar). audit_logs é histórico e não muda.
 *
 * Uso (credencial de dono/editor do projeto, ex. no Cloud Shell):
 *   GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/fix-store-ids.mjs            # simulação
 *   GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/fix-store-ids.mjs --execute  # executa
 *   ... --rollback <arquivo-de-backup.json>    desfaz uma execução a partir do backup gerado
 * Opções: --backup-dir <dir> (padrão: $HOME), --samples <n> (padrão 5)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Identidade física das lojas (mesmas regras de src/services/storeAndLocationData.ts)
// ---------------------------------------------------------------------------
export const STORES = {
  'store-01': {
    code: 'LJ01',
    name: 'Astral Rodovia dos Minérios',
    address: 'Travessa Paulo Bini, 250',
    label: 'Astral Rodovia dos Minérios - Travessa Paulo Bini, 250',
    physical: [/paulo\s*bini/, /\bminerios\b/, /\b250\b/, /\bmatriz\b/]
  },
  'store-02': {
    code: 'LJ02',
    name: 'Astral Centro',
    address: 'Avenida Emílio Johnson, 675',
    label: 'Astral Centro - Avenida Emílio Johnson, 675',
    physical: [/\bemilio\b/, /\b675\b/, /\bastral\s*centro\b/]
  },
  'store-03': {
    code: 'LJ03',
    name: 'Astral Bertolina', // só o nome muda; endereço e demais dados são mantidos
    label: 'Astral Bertolina - Rua Bertolina Kendrick de Oliveira, 1025',
    physical: [/bertolina|kendrick/, /\b1025\b/]
  }
};
const SWAPPED_IDS = ['store-01', 'store-02'];

const norm = v => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Loja física indicada por um texto (nome/endereço/slug). null se ausente ou ambíguo. */
export function physicalStoreFromText(text) {
  const t = norm(text);
  if (!t) return null;
  const hits = Object.entries(STORES).filter(([, s]) => s.physical.some(re => re.test(t))).map(([id]) => id);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Destino de um registro com (storeId, storeName).
 *  { target, reason }  reason: 'name' | 'kept' | 'ambiguous' | 'none'
 */
export function resolveRecordStore(storeId, storeName) {
  const byName = physicalStoreFromText(storeName);
  if (byName) return { target: byName, reason: 'name' };
  if (!storeId) return { target: null, reason: 'none' };
  if (SWAPPED_IDS.includes(storeId)) return { target: null, reason: 'ambiguous' };
  return { target: storeId, reason: 'kept' };
}

// Mesmo hash de src/services/pdvParser.ts (cupons sem número)
export function stableHash(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function isValidCpf(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = len => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function noReceiptHash(storeId, f) {
  const cpfDigits = String(str(f, 'customerCpf') || '').replace(/\D/g, '');
  const cpf = isValidCpf(cpfDigits) ? cpfDigits : '';
  const pos = String(str(f, 'posNumber') || '').trim().toLowerCase();
  return `SEM-CUPOM-${stableHash([storeId, str(f, 'purchaseDate') || '', pos, cpf].join('|'))}`;
}

// ---------------------------------------------------------------------------
// Helpers de documentos REST do Firestore (valores tipados preservados sem conversão)
// ---------------------------------------------------------------------------
const str = (fields, key) => fields?.[key]?.stringValue;
const sv = value => ({ stringValue: value });
const docId = doc => doc.name.split('/').pop();
const clone = o => JSON.parse(JSON.stringify(o));
/** IDs no relatório sem dados pessoais: sequências de 8+ dígitos (CPF/CNPJ) ficam mascaradas. */
export const maskId = id => String(id).replace(/\d{8,}/g, m => `${m.slice(0, 3)}${'*'.repeat(m.length - 5)}${m.slice(-2)}`);

const SLUG_OR_ID_RE = /\bstore-0[12]\b|paulo-bini|\bmatriz\b/i; // referências a revisar
function findStoreRefs(value, path, out) {
  if (!value || typeof value !== 'object') return;
  if ('stringValue' in value) {
    if (SLUG_OR_ID_RE.test(value.stringValue)) out.push(path);
  } else if (value.mapValue) {
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) findStoreRefs(v, path ? `${path}.${k}` : k, out);
  } else if (value.arrayValue) {
    (value.arrayValue.values || []).forEach(v => findStoreRefs(v, `${path}[]`, out));
  }
}
function storeRefPaths(fields) {
  const out = [];
  for (const [k, v] of Object.entries(fields || {})) findStoreRefs(v, k, out);
  return out;
}

// Campos que este script trata, por coleção
const HANDLED_FIELDS = {
  stores: ['id', 'code', 'name', 'address'],
  purchases: ['id', 'storeId', 'storeName', 'couponReceiptNumber'],
  customers: ['favoriteStoreId', 'favoriteStoreName'],
  club_offer_usages: ['storeId', 'storeName'],
  interactions: ['storeName']
};
const HISTORY_COLLECTIONS = ['audit_logs']; // histórico: só listado, nunca alterado

// ---------------------------------------------------------------------------
// Planejamento (somente leitura)
// ---------------------------------------------------------------------------
export function planMigration(collections) {
  const plan = {
    stores: { status: 'ok', changes: [], notes: [] },
    purchases: { scanned: 0, relink: 0, labelOnly: 0, renames: 0, ambiguous: [], conflicts: [], noReceiptUnverified: [], changes: [] },
    customers: { scanned: 0, relink: 0, labelOnly: 0, inferredFromPurchases: 0, fromSiteId: 0, ambiguous: [], changes: [] },
    club_offer_usages: { scanned: 0, relink: 0, labelOnly: 0, ambiguous: [], changes: [] },
    interactions: { scanned: 0, labelOnly: 0, changes: [] },
    unknownRefs: {},
    historyRefs: {}
  };

  // ---- stores
  const storeDocs = new Map((collections.stores || []).map(d => [docId(d), d]));
  const s1 = storeDocs.get('store-01');
  const s2 = storeDocs.get('store-02');
  const phys = d => (d ? physicalStoreFromText(`${str(d.fields, 'name') || ''} ${str(d.fields, 'address') || ''}`) : null);
  const p1 = phys(s1);
  const p2 = phys(s2);
  const canonicalStore = (sourceDoc, id) => {
    const f = clone(sourceDoc.fields || {});
    const def = STORES[id];
    f.code = sv(def.code);
    f.name = sv(def.name);
    f.address = sv(def.address);
    if (f.id) f.id = sv(id);
    return f;
  };
  const differs = (d, f) => ['code', 'name', 'address', 'id'].some(k => (f[k]?.stringValue ?? null) !== (d.fields?.[k]?.stringValue ?? null));
  if (!s1 || !s2) {
    plan.stores.status = 'missing';
    plan.stores.notes.push('Documentos stores/store-01 e/ou stores/store-02 não existem; lojas não serão alteradas (o CRM cria as lojas corretas se a coleção estiver vazia).');
  } else if (p1 === 'store-02' && p2 === 'store-01') {
    plan.stores.status = 'swap';
    plan.stores.changes.push({ kind: 'replace', collection: 'stores', from: s2, targetId: 'store-01', fields: canonicalStore(s2, 'store-01'), precondition: s1 });
    plan.stores.changes.push({ kind: 'replace', collection: 'stores', from: s1, targetId: 'store-02', fields: canonicalStore(s1, 'store-02'), precondition: s2 });
  } else if (p1 === 'store-01' && p2 === 'store-02') {
    plan.stores.status = 'aligned';
    for (const [d, id] of [[s1, 'store-01'], [s2, 'store-02']]) {
      const f = canonicalStore(d, id);
      if (differs(d, f)) plan.stores.changes.push({ kind: 'replace', collection: 'stores', from: d, targetId: id, fields: f, precondition: d });
    }
  } else {
    plan.stores.status = 'ambiguous';
    plan.stores.notes.push(`Não foi possível identificar com segurança a loja física de stores/store-01 (${p1 || '?'}) e stores/store-02 (${p2 || '?'}). Lojas não serão alteradas.`);
  }

  // store-03: só o nome comercial (endereço e demais dados mantidos)
  const s3 = storeDocs.get('store-03');
  if (s3 && phys(s3) === 'store-03' && str(s3.fields, 'name') !== STORES['store-03'].name) {
    plan.stores.changes.push({
      kind: 'update', collection: 'stores', from: s3,
      fields: { name: sv(STORES['store-03'].name) }, mask: ['name']
    });
  }

  // ---- purchases (primeiro, para inferir a loja de clientes sem nome de loja)
  const purchases = collections.purchases || [];
  const allPurchaseIds = new Set(purchases.map(docId));
  const physicalByCustomer = new Map();
  const purchaseMoves = [];
  for (const d of purchases) {
    plan.purchases.scanned++;
    const f = d.fields || {};
    const curId = str(f, 'storeId');
    const { target, reason } = resolveRecordStore(curId, str(f, 'storeName'));
    if (!target) {
      if (reason === 'ambiguous') plan.purchases.ambiguous.push(docId(d));
      continue;
    }
    const cust = str(f, 'customerId');
    if (cust) {
      const m = physicalByCustomer.get(cust) || new Map();
      m.set(target, (m.get(target) || 0) + 1);
      physicalByCustomer.set(cust, m);
    }
    const label = STORES[target].label;
    if (curId === target && str(f, 'storeName') === label) continue;

    const nf = clone(f);
    nf.storeId = sv(target);
    nf.storeName = sv(label);
    let newDocId = docId(d);
    if (curId !== target) {
      plan.purchases.relink++;
      const oldPrefix = `pdv_${curId}_`;
      if (curId && newDocId.startsWith(oldPrefix)) {
        let rest = newDocId.slice(oldPrefix.length);
        const receipt = str(f, 'couponReceiptNumber') || '';
        if (receipt.startsWith('SEM-CUPOM-')) {
          if (noReceiptHash(curId, f) === receipt) {
            const newReceipt = noReceiptHash(target, f);
            nf.couponReceiptNumber = sv(newReceipt);
            rest = rest.replace(receipt, newReceipt);
          } else {
            plan.purchases.noReceiptUnverified.push(docId(d));
          }
        }
        newDocId = `pdv_${target}_${rest}`;
      }
      if (nf.id) nf.id = sv(newDocId);
    } else {
      plan.purchases.labelOnly++;
    }
    purchaseMoves.push({ d, newDocId, fields: nf });
  }
  // Conflitos de ID: destino ocupado por documento que não vai sair de lá, ou dois documentos com o
  // mesmo destino. Resolvido até estabilizar (um conflito impede a saída do documento em conflito).
  const renames = purchaseMoves.filter(m => m.newDocId !== docId(m.d));
  const blocked = new Set();
  for (let changed = true; changed;) {
    changed = false;
    const active = renames.filter(m => !blocked.has(m));
    const leavingIds = new Set(active.map(m => docId(m.d)));
    const targetCount = new Map();
    active.forEach(m => targetCount.set(m.newDocId, (targetCount.get(m.newDocId) || 0) + 1));
    for (const m of active) {
      const occupied = allPurchaseIds.has(m.newDocId) && !leavingIds.has(m.newDocId);
      if (occupied || targetCount.get(m.newDocId) > 1) {
        blocked.add(m);
        changed = true;
      }
    }
  }
  for (const m of purchaseMoves) {
    const oldId = docId(m.d);
    if (m.newDocId === oldId) {
      plan.purchases.changes.push({ kind: 'update', collection: 'purchases', from: m.d, fields: m.fields, mask: HANDLED_FIELDS.purchases.filter(k => m.fields[k]) });
    } else if (blocked.has(m)) {
      plan.purchases.conflicts.push(`${oldId} -> ${m.newDocId}`);
    } else {
      plan.purchases.renames++;
      plan.purchases.changes.push({ kind: 'rename', collection: 'purchases', from: m.d, targetId: m.newDocId, fields: m.fields });
    }
  }

  // ---- customers
  for (const d of collections.customers || []) {
    plan.customers.scanned++;
    const f = d.fields || {};
    const curId = str(f, 'favoriteStoreId');
    const curName = str(f, 'favoriteStoreName');
    let { target, reason } = resolveRecordStore(curId, curName);
    // Cadastro vindo do site (registerWebsiteCustomer): os IDs da função seguem a ordem das lojas do site
    // (matriz=store-01, paulo-bini=store-02, bertolina=store-03) e estavam certos; os NOMES gravados
    // estavam trocados. Para esses clientes vale o ID, e o nome é corrigido.
    if (docId(d).startsWith('cust-site-') && curId && STORES[curId]) {
      target = curId;
      reason = 'site';
      plan.customers.fromSiteId++;
    }
    if (reason === 'ambiguous') {
      // Loja preferencial = loja física com mais compras do cliente (empate: não decide)
      const ranked = [...(physicalByCustomer.get(docId(d)) || new Map()).entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
        target = ranked[0][0];
        plan.customers.inferredFromPurchases++;
      } else {
        plan.customers.ambiguous.push(docId(d));
        continue;
      }
    }
    if (!target) continue;
    const label = STORES[target].label;
    if (curId === target && curName === label) continue;
    if (curId !== target) plan.customers.relink++;
    else plan.customers.labelOnly++;
    plan.customers.changes.push({
      kind: 'update', collection: 'customers', from: d,
      fields: { favoriteStoreId: sv(target), favoriteStoreName: sv(label) },
      mask: ['favoriteStoreId', 'favoriteStoreName'],
      before: `${curId || '-'} | ${curName || '-'}`, after: `${target} | ${label}`
    });
  }

  // ---- club_offer_usages
  for (const d of collections.club_offer_usages || []) {
    plan.club_offer_usages.scanned++;
    const f = d.fields || {};
    const curId = str(f, 'storeId');
    const { target, reason } = resolveRecordStore(curId, str(f, 'storeName'));
    if (!target) {
      if (reason === 'ambiguous') plan.club_offer_usages.ambiguous.push(docId(d));
      continue;
    }
    const label = STORES[target].label;
    if (curId === target && str(f, 'storeName') === label) continue;
    if (curId !== target) plan.club_offer_usages.relink++;
    else plan.club_offer_usages.labelOnly++;
    plan.club_offer_usages.changes.push({
      kind: 'update', collection: 'club_offer_usages', from: d,
      fields: { storeId: sv(target), storeName: sv(label) }, mask: ['storeId', 'storeName']
    });
  }

  // ---- interactions (somente rótulo; não têm storeId)
  for (const d of collections.interactions || []) {
    plan.interactions.scanned++;
    const name = str(d.fields, 'storeName');
    const target = physicalStoreFromText(name);
    if (!target || name === STORES[target].label) continue;
    plan.interactions.labelOnly++;
    plan.interactions.changes.push({
      kind: 'update', collection: 'interactions', from: d,
      fields: { storeName: sv(STORES[target].label) }, mask: ['storeName']
    });
  }

  // ---- referências não tratadas (qualquer coleção)
  for (const [col, docs] of Object.entries(collections)) {
    const handled = HANDLED_FIELDS[col] || [];
    const bucket = HISTORY_COLLECTIONS.includes(col) ? plan.historyRefs : plan.unknownRefs;
    for (const d of docs) {
      for (const p of storeRefPaths(d.fields)) {
        if (handled.includes(p.split(/[.[]/)[0])) continue;
        const key = `${col}.${p}`;
        const e = bucket[key] || (bucket[key] = { count: 0, sampleIds: [] });
        e.count++;
        if (e.sampleIds.length < 5) e.sampleIds.push(docId(d));
      }
    }
  }
  return plan;
}

// Agrupa mudanças que precisam ir no mesmo commit (renomeações que trocam de ID entre si)
function groupChanges(changes) {
  const byOldName = new Map(changes.map(c => [c.from.name, c]));
  const seen = new Set();
  const groups = [];
  const targetName = (c, base) => (c.kind === 'rename' || c.kind === 'replace') ? `${base}/${c.collection}/${c.targetId}` : c.from.name;
  return base => {
    for (const c of changes) {
      if (seen.has(c)) continue;
      const group = [];
      const stack = [c];
      while (stack.length) {
        const x = stack.pop();
        if (seen.has(x)) continue;
        seen.add(x);
        group.push(x);
        const other = byOldName.get(targetName(x, base));
        if (other && !seen.has(other)) stack.push(other);
        for (const y of changes) if (!seen.has(y) && targetName(y, base) === x.from.name) stack.push(y);
      }
      groups.push(group);
    }
    return groups;
  };
}

function toWrites(group, base) {
  const oldNames = new Set(group.map(c => c.from.name));
  const writes = [];
  const createdNames = [];
  for (const c of group) {
    if (c.kind === 'update') {
      writes.push({
        update: { name: c.from.name, fields: c.fields },
        updateMask: { fieldPaths: c.mask },
        currentDocument: { updateTime: c.from.updateTime }
      });
      continue;
    }
    const newName = `${base}/${c.collection}/${c.targetId}`;
    const occupant = group.find(o => o.from.name === newName) || (c.precondition && c.precondition.name === newName ? { from: c.precondition } : null);
    writes.push({
      update: { name: newName, fields: c.fields },
      currentDocument: occupant ? { updateTime: occupant.from.updateTime } : { exists: false }
    });
    if (!occupant) createdNames.push(newName);
  }
  const newNames = new Set(group.filter(c => c.kind !== 'update').map(c => `${base}/${c.collection}/${c.targetId}`));
  for (const c of group) {
    if (c.kind === 'rename' && !newNames.has(c.from.name) && oldNames.has(c.from.name)) {
      writes.push({ delete: c.from.name, currentDocument: { updateTime: c.from.updateTime } });
    }
  }
  return { writes, createdNames };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
export async function runFixStoreIds({ fetchImpl, token, projectId, databaseId, argv = [], log = console.log, writeFile = writeFileSync, readFile = readFileSync, backupDir = homedir(), now = () => new Date() }) {
  const execute = argv.includes('--execute');
  const acceptUnknown = argv.includes('--accept-unknown-refs');
  const rollbackIdx = argv.indexOf('--rollback');
  const samplesIdx = argv.indexOf('--samples');
  const samples = samplesIdx >= 0 ? Number(argv[samplesIdx + 1]) || 5 : 5;
  const bdIdx = argv.indexOf('--backup-dir');
  if (bdIdx >= 0 && argv[bdIdx + 1]) backupDir = argv[bdIdx + 1];

  const root = `projects/${projectId}/databases/${databaseId}`;
  const base = `${root}/documents`;
  const api = `https://firestore.googleapis.com/v1/${encodeURI(root)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (url, init = {}) => {
    const res = await fetchImpl(url, { ...init, headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${body?.error?.message || 'erro'}`);
    return body;
  };
  const commit = writes => call(`${api}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });

  // ---- rollback
  if (rollbackIdx >= 0) {
    const file = argv[rollbackIdx + 1];
    if (!file) throw new Error('Informe o arquivo de backup: --rollback <arquivo.json>');
    const backup = JSON.parse(readFile(file, 'utf8'));
    const writes = [
      ...backup.originals.map(o => ({ update: { name: o.name, fields: o.fields } })),
      ...backup.created.filter(n => !backup.originals.some(o => o.name === n)).map(n => ({ delete: n }))
    ];
    for (let i = 0; i < writes.length; i += 400) await commit(writes.slice(i, i + 400));
    log(`ROLLBACK CONCLUÍDO: ${backup.originals.length} documento(s) restaurado(s), ${writes.length - backup.originals.length} documento(s) criado(s) pela migração removido(s).`);
    return { rolledBack: true };
  }

  // ---- leitura completa (somente leitura)
  const collectionIds = [];
  let pt;
  do {
    const body = await call(`${api}/documents:listCollectionIds`, { method: 'POST', body: JSON.stringify({ pageSize: 100, ...(pt ? { pageToken: pt } : {}) }) });
    collectionIds.push(...(body.collectionIds || []));
    pt = body.nextPageToken;
  } while (pt);

  const collections = {};
  for (const col of collectionIds) {
    const docs = [];
    let t;
    do {
      const q = new URLSearchParams({ pageSize: '300' });
      if (t) q.set('pageToken', t);
      const body = await call(`${api}/documents/${encodeURIComponent(col)}?${q}`);
      docs.push(...(body.documents || []));
      t = body.nextPageToken;
    } while (t);
    collections[col] = docs;
  }

  const plan = planMigration(collections);
  const allChanges = [
    ...plan.stores.changes,
    ...plan.purchases.changes,
    ...plan.customers.changes,
    ...plan.club_offer_usages.changes,
    ...plan.interactions.changes
  ];

  // ---- relatório (sem dados pessoais: só IDs de documento e campos de loja)
  log(`\n=== ${execute ? 'EXECUÇÃO' : 'SIMULAÇÃO (nada será gravado)'} - correção das lojas 01/02 - ${projectId} / ${databaseId} ===`);
  log(`Coleções lidas: ${collectionIds.map(c => `${c}(${collections[c].length})`).join(', ') || '-'}`);
  log(`\n[stores] situação: ${plan.stores.status}`);
  plan.stores.notes.forEach(n => log(`  - ${n}`));
  for (const c of plan.stores.changes) {
    if (c.kind === 'update') {
      log(`  - stores/${docId(c.from)}: nome "${str(c.from.fields, 'name')}" -> "${c.fields.name.stringValue}" (demais dados mantidos)`);
      continue;
    }
    log(`  - stores/${c.targetId} passa a ser: ${c.fields.code?.stringValue} | ${c.fields.name?.stringValue} | ${c.fields.address?.stringValue}  (dados físicos vindos de stores/${docId(c.from)}: "${str(c.from.fields, 'name')}")`);
  }
  const P = plan.purchases;
  log(`\n[purchases] lidas: ${P.scanned} | loja trocada: ${P.relink} | só rótulo: ${P.labelOnly} | IDs renomeados: ${P.renames} | ambíguas (sem nome de loja, não alteradas): ${P.ambiguous.length} | conflitos de ID (não alteradas): ${P.conflicts.length} | SEM-CUPOM sem hash verificável (loja corrigida, cupom mantido): ${P.noReceiptUnverified.length}`);
  P.changes.slice(0, samples).forEach(c => log(`  ex.: ${maskId(docId(c.from))} [${str(c.from.fields, 'storeId')} | ${str(c.from.fields, 'storeName')}] -> ${maskId(c.kind === 'rename' ? c.targetId : docId(c.from))} [${c.fields.storeId.stringValue} | ${c.fields.storeName.stringValue}]`));
  if (P.ambiguous.length) log(`  ambíguas (ex.): ${P.ambiguous.slice(0, samples).map(maskId).join(', ')}`);
  if (P.conflicts.length) log(`  conflitos (ex.): ${P.conflicts.slice(0, samples).map(maskId).join(', ')}`);
  const C = plan.customers;
  log(`\n[customers] lidos: ${C.scanned} | loja preferencial trocada: ${C.relink} | só rótulo: ${C.labelOnly} | inferidos pelas compras: ${C.inferredFromPurchases} | cadastros do site (vale o ID): ${C.fromSiteId} | ambíguos (não alterados): ${C.ambiguous.length}`);
  C.changes.slice(0, samples).forEach(c => log(`  ex.: ${maskId(docId(c.from))}: ${c.before} -> ${c.after}`));
  if (C.ambiguous.length) log(`  ambíguos (ex.): ${C.ambiguous.slice(0, samples).map(maskId).join(', ')}`);
  const U = plan.club_offer_usages;
  log(`\n[club_offer_usages] lidos: ${U.scanned} | loja trocada: ${U.relink} | só rótulo: ${U.labelOnly} | ambíguos: ${U.ambiguous.length}`);
  log(`[interactions] lidas: ${plan.interactions.scanned} | rótulo atualizado: ${plan.interactions.labelOnly}`);
  const unknownKeys = Object.keys(plan.unknownRefs);
  if (unknownKeys.length) {
    log('\nATENÇÃO - referências a store-01/store-02/slugs do site em campos que este script NÃO trata:');
    unknownKeys.forEach(k => log(`  - ${k}: ${plan.unknownRefs[k].count} doc(s) (ex.: ${plan.unknownRefs[k].sampleIds.map(maskId).join(', ')})`));
  }
  const historyKeys = Object.keys(plan.historyRefs);
  if (historyKeys.length) log(`\nHistórico (não alterado): ${historyKeys.map(k => `${k}(${plan.historyRefs[k].count})`).join(', ')}`);
  log(`\nTotal de documentos a alterar: ${allChanges.length}`);

  if (!execute) {
    log(allChanges.length
      ? 'SIMULAÇÃO: nada foi gravado. Revise as contagens e exemplos acima e rode de novo com --execute.'
      : 'SIMULAÇÃO: base já está correta; nada a fazer.');
    return { executed: false, plan, changes: allChanges.length };
  }
  if (unknownKeys.length && !acceptUnknown) {
    throw new Error('Execução recusada: há referências de loja em campos não tratados (listadas acima). Revise-as; se não precisarem de correção, rode com --accept-unknown-refs.');
  }
  if (plan.stores.status === 'ambiguous') {
    throw new Error('Execução recusada: não foi possível identificar a loja física dos documentos stores/store-01 e stores/store-02.');
  }
  if (allChanges.length === 0) {
    log('Nada a fazer: a base já está correta.');
    return { executed: true, plan, changes: 0 };
  }

  // ---- backup antes de gravar
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const backupFile = join(backupDir, `fix-store-ids-backup-${stamp}.json`);
  const groups = groupChanges(allChanges)(base);
  const backup = { createdAt: now().toISOString(), projectId, databaseId, originals: [], created: [] };
  const originalNames = new Set();
  for (const c of allChanges) {
    if (!originalNames.has(c.from.name)) { backup.originals.push({ name: c.from.name, fields: c.from.fields }); originalNames.add(c.from.name); }
    if (c.precondition && !originalNames.has(c.precondition.name)) { backup.originals.push({ name: c.precondition.name, fields: c.precondition.fields }); originalNames.add(c.precondition.name); }
  }
  const prepared = groups.map(g => toWrites(g, base));
  prepared.forEach(p => backup.created.push(...p.createdNames));
  writeFile(backupFile, JSON.stringify(backup));
  log(`Backup gravado em ${backupFile} (contém dados de clientes: não compartilhe nem versione).`);

  // ---- gravação: grupos atômicos, até 400 escritas por commit
  let committed = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    await commit(batch);
    committed += batch.length;
    batch = [];
  };
  for (const p of prepared) {
    if (batch.length + p.writes.length > 400) await flush();
    batch.push(...p.writes);
  }
  await flush();
  log(`\nMIGRAÇÃO CONCLUÍDA: ${allChanges.length} documento(s) corrigido(s) em ${committed} escrita(s). Para desfazer: --rollback ${backupFile}`);
  return { executed: true, plan, changes: allChanges.length, backupFile };
}

// Execução via linha de comando
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) {
    console.error('Defina GOOGLE_ACCESS_TOKEN (ex.: $(gcloud auth print-access-token)).');
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  runFixStoreIds({
    fetchImpl: fetch,
    token,
    projectId: cfg.projectId,
    databaseId: cfg.firestoreDatabaseId || '(default)',
    argv: process.argv.slice(2)
  }).catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
