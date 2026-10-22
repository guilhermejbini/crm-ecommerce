#!/usr/bin/env node
/**
 * Limpeza da base DEMO/teste antes da primeira carga real do CRM Super Astral.
 *
 * Padrão: DRY RUN (somente leitura). Lista, por coleção, a quantidade de documentos,
 * exemplos de IDs e indícios de dado demo. Nada é apagado sem --execute.
 *
 * Uso (credencial de dono/editor do projeto; as regras do Firestore não se aplicam ao token do gcloud):
 *   GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/demo-cleanup.mjs
 *   GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/demo-cleanup.mjs --execute --confirm-no-real-data
 *   (opcional) --include-audit-logs  também apaga audit_logs
 *
 * NUNCA apaga: authorized_users, stores, settings, users, nem coleções desconhecidas.
 * Se encontrar coleção desconhecida, a execução é recusada (dúvida => parar).
 */
import { readFileSync } from 'node:fs';

// Coleções operacionais do CRM (dados de clientes/vendas/marketing) - candidatas à limpeza
export const CLEANUP_COLLECTIONS = [
  'customers',
  'purchases',
  'campaigns',
  'coupons',
  'interactions',
  'tasks',
  'segments',
  'club_offers',
  'club_offer_usages'
];
// Histórico de auditoria: só é apagado com --include-audit-logs
export const OPTIONAL_COLLECTIONS = ['audit_logs'];
// Configuração, autenticação e lojas reais: nunca apagar
export const PROTECTED_COLLECTIONS = ['authorized_users', 'stores', 'settings', 'users'];

const DEMO_ID_PATTERNS = [/^cust-\d{4}$/, /^cust-\d{13}$/, /CF-4829\d\d/, /demo/i, /test/i, /mock/i];

function demoHints(doc) {
  const id = doc.name.split('/').pop();
  const hints = [];
  if (doc.fields?.isDemo?.booleanValue === true) hints.push('isDemo=true');
  if (DEMO_ID_PATTERNS.some(re => re.test(id))) hints.push('id com padrão demo/teste');
  return hints;
}

export async function runCleanup({ fetchImpl, token, projectId, databaseId, argv = [], log = console.log }) {
  const execute = argv.includes('--execute');
  const confirmed = argv.includes('--confirm-no-real-data');
  const includeAudit = argv.includes('--include-audit-logs');
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const call = async (url, init = {}) => {
    const res = await fetchImpl(url, { ...init, headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${body?.error?.message || 'erro'}`);
    return body;
  };

  // 1. Coleções existentes na raiz
  const collectionIds = [];
  let pageToken;
  do {
    const body = await call(`${base}/documents:listCollectionIds`, {
      method: 'POST',
      body: JSON.stringify({ pageSize: 100, ...(pageToken ? { pageToken } : {}) })
    });
    collectionIds.push(...(body.collectionIds || []));
    pageToken = body.nextPageToken;
  } while (pageToken);

  const known = new Set([...CLEANUP_COLLECTIONS, ...OPTIONAL_COLLECTIONS, ...PROTECTED_COLLECTIONS]);
  const unknown = collectionIds.filter(c => !known.has(c));

  // 2. Inventário (somente leitura)
  const report = {};
  for (const col of collectionIds) {
    const docs = [];
    let token2;
    do {
      const q = new URLSearchParams({ pageSize: '300', 'mask.fieldPaths': 'isDemo' });
      if (token2) q.set('pageToken', token2);
      const body = await call(`${base}/documents/${encodeURIComponent(col)}?${q}`);
      docs.push(...(body.documents || []));
      token2 = body.nextPageToken;
    } while (token2);

    const role = PROTECTED_COLLECTIONS.includes(col)
      ? 'PRESERVAR'
      : CLEANUP_COLLECTIONS.includes(col)
        ? 'LIMPAR'
        : OPTIONAL_COLLECTIONS.includes(col)
          ? (includeAudit ? 'LIMPAR' : 'PRESERVAR (use --include-audit-logs)')
          : 'DESCONHECIDA - NÃO TOCAR';
    const withHints = docs.filter(d => demoHints(d).length > 0).length;
    report[col] = {
      role,
      count: docs.length,
      sampleIds: docs.slice(0, 5).map(d => d.name.split('/').pop()),
      docsWithDemoHints: withHints,
      docNames: docs.map(d => d.name)
    };
  }

  log(`\n=== ${execute ? 'EXECUÇÃO' : 'DRY RUN (nada será apagado)'} - projeto ${projectId} / banco ${databaseId} ===`);
  log('Critério: o CRM nunca recebeu dados reais (declarado pelo responsável); todo documento das coleções operacionais é demo/teste.');
  log('Indícios adicionais exibidos: campo isDemo=true e IDs com padrão demo/teste.\n');
  for (const [col, r] of Object.entries(report)) {
    log(`- ${col}: ${r.count} doc(s) [${r.role}] | com indício demo: ${r.docsWithDemoHints} | exemplos: ${r.sampleIds.join(', ') || '-'}`);
  }
  if (unknown.length) log(`\nATENÇÃO: coleções desconhecidas encontradas (não serão tocadas): ${unknown.join(', ')}`);

  const toDelete = Object.entries(report)
    .filter(([, r]) => r.role === 'LIMPAR')
    .flatMap(([, r]) => r.docNames);

  if (!execute) {
    log(`\nDRY RUN: ${toDelete.length} documento(s) seriam apagados. Para executar: --execute --confirm-no-real-data`);
    return { executed: false, deleted: 0, report, unknown };
  }
  if (!confirmed) {
    throw new Error('Execução recusada: informe --confirm-no-real-data para confirmar que não há dados reais.');
  }
  if (unknown.length) {
    throw new Error(`Execução recusada: há coleções desconhecidas (${unknown.join(', ')}). Revise antes de limpar.`);
  }

  // 3. Exclusão em lotes de até 500 (somente coleções LIMPAR)
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 500) {
    const chunk = toDelete.slice(i, i + 500);
    await call(`${base}/documents:batchWrite`, {
      method: 'POST',
      body: JSON.stringify({ writes: chunk.map(name => ({ delete: name })) })
    });
    deleted += chunk.length;
  }
  log(`\nLIMPEZA CONCLUÍDA: ${deleted} documento(s) apagados. Coleções preservadas: ${PROTECTED_COLLECTIONS.join(', ')}.`);
  return { executed: true, deleted, report, unknown };
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
  runCleanup({
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
