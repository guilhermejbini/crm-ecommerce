import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createFirestoreMock, MemStore } from './firestoreMock';
import { canAccessView, canImport, canAnonymize } from '../src/utils/permissions';
import { buildXlsx } from './helpers';

const mem = vi.hoisted(() => ({ store: new Map() as any }));
vi.mock('firebase/firestore', () => createFirestoreMock(mem.store));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

const ADMIN = { id: 'u', name: 'Admin', email: 'admin@exemplo.test', role: 'admin' } as any;

const store = () => mem.store as MemStore;
const put = (col: string, id: string, data: any) => {
  if (!store().has(col)) store().set(col, new Map());
  store().get(col)!.set(id, { ...data });
};
const all = (col: string) => Array.from((store().get(col) || new Map()).values());

beforeEach(async () => {
  store().clear();
  vi.resetModules();
  const svc = await import('../src/services/firestoreService');
  svc.invalidateCache('all');
});

// ===================================================================
// 1. Campanhas: nenhuma métrica de resultado inventada na criação
// ===================================================================
describe('Review 1 - campanhas sem métricas inventadas', () => {
  for (const file of ['src/components/Campaigns/AICampaignModal.tsx', 'src/components/Campaigns/CampaignListView.tsx']) {
    it(`${file}: sem fórmulas de entregues/abertos/conversão/receita/ROI`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/\*\s*0\.(98|72|35|18)\b/);
      expect(src).not.toMatch(/\*\s*145\b/);
      expect(src).not.toMatch(/roi:\s*\d/);
      expect(src).not.toMatch(/estimatedCost/);
      expect(src).toMatch(/sentCount:\s*0/);
      expect(src).toMatch(/convertedCount:\s*0/);
      expect(src).toMatch(/revenueGenerated:\s*0/);
    });
  }
});

// ===================================================================
// 2. Dashboard: métricas a partir dos dados reais
// ===================================================================
describe('Review 2 - Dashboard real', () => {
  it('novos no mês por data de cadastro; opt-in = consentimento LGPD', async () => {
    const { calculateDashboardMetrics } = await import('../src/services/firestoreService');
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString();
    const lastYear = new Date(now.getFullYear() - 1, 0, 15).toISOString();
    const base = { rfmSegment: 'UNCLASSIFIED', daysSinceLastPurchase: 999, totalPurchases: 0, totalSpent: 0 };
    const customers: any[] = [
      // importado agora, mas cadastrado no Flex há 1 ano: não é novo
      { ...base, id: 'a', createdAt: thisMonth, registeredAt: lastYear, whatsapp: '41999990000', consent: { whatsappMarketing: false } },
      // novo de verdade, com consentimento
      { ...base, id: 'b', createdAt: thisMonth, whatsapp: '41999990001', consent: { whatsappMarketing: true } },
      // tem consentimento mas foi anonimizado
      { ...base, id: 'c', createdAt: lastYear, isAnonymized: true, consent: { whatsappMarketing: true } }
    ];
    const m = calculateDashboardMetrics(customers, []);
    expect(m.newCustomersMonth).toBe(1);
    expect(m.customersWithWhatsAppOptIn).toBe(1);
  });

  it('Dashboard sem valores fixos (8% de novos, faturamento base, +14%)', () => {
    const src = readFileSync('src/components/Dashboard/DashboardView.tsx', 'utf8');
    expect(src).not.toMatch(/totalCust \* 0\.08/);
    expect(src).not.toMatch(/baseRevenue/);
    expect(src).not.toMatch(/count \* 0\.\d+/);
    expect(src).not.toMatch(/'\+14% ↑'/);
    expect(src).toMatch(/consent\?\.whatsappMarketing === true/);
  });

  it('Flex grava a "Data Cadastro" como registeredAt', async () => {
    const { parseFlexExcelFile } = await import('../src/services/flexCustomerParser');
    const r = parseFlexExcelFile(buildXlsx([
      ...Array.from({ length: 12 }, (_, i) => [`Relatório ${i + 1}`]),
      ['Código', 'Nome Do Cliente', 'CNPJ / CPF', 'Data Cadastro'],
      ['C1', 'Maria', '52998224725', '15/03/2019']
    ]));
    const { customers } = await r.extractAllCustomers([]);
    const maria = customers.find(c => c.name === 'Maria')!;
    expect(maria.registeredAt).toBe(new Date(2019, 2, 15, 12, 0, 0).toISOString());
  });
});

// ===================================================================
// 3. PDV: ID de cliente novo sem colisão e sem CPF em texto
// ===================================================================
describe('Review 3 - ID de cliente criado no PDV', () => {
  const purchase = (receipt: string, cpf: string) => ({
    id: '', couponReceiptNumber: receipt, storeId: 'store-01', storeName: 'Astral Rodovia dos Minérios - Travessa Paulo Bini, 250',
    purchaseDate: '2025-01-10T12:00:00.000Z', totalAmount: 10, netAmount: 10, customerCpf: cpf, customerName: '', items: []
  } as any);

  it('dois CPFs novos geram IDs distintos, estáveis e sem o CPF', async () => {
    const svc = await import('../src/services/firestoreService');
    await svc.importPurchasesBatch([purchase('1', '529.982.247-25'), purchase('2', '111.444.777-35')], ADMIN, true);
    const custs = all('customers');
    expect(custs).toHaveLength(2);
    const ids = Array.from(store().get('customers')!.keys());
    expect(new Set(ids).size).toBe(2);
    ids.forEach(id => {
      expect(id).toMatch(/^cust-pdv-[0-9a-f]{16}$/);
      expect(id).not.toContain('52998224725');
      expect(id).not.toContain('11144477735');
    });
    expect(svc.pdvCustomerId('52998224725')).toBe(svc.pdvCustomerId('52998224725'));
  });

  it('não sobrescreve cliente existente que tenha o mesmo ID (outro CPF)', async () => {
    const svc = await import('../src/services/firestoreService');
    const takenId = svc.pdvCustomerId('52998224725');
    put('customers', takenId, { id: takenId, name: 'Outra Pessoa', cpf: '111.444.777-35', createdAt: '2024-01-01T00:00:00.000Z' });
    await svc.importPurchasesBatch([purchase('9', '529.982.247-25')], ADMIN, true);
    expect(store().get('customers')!.get(takenId)).toMatchObject({ name: 'Outra Pessoa', cpf: '111.444.777-35' });
    expect(store().get('customers')!.get(`${takenId}-1`)).toMatchObject({ cpf: '529.982.247-25' });
  });

  it('reimportar o mesmo arquivo não duplica nem troca o cliente', async () => {
    const svc = await import('../src/services/firestoreService');
    await svc.importPurchasesBatch([purchase('1', '529.982.247-25')], ADMIN, true);
    svc.invalidateCache('all');
    await svc.importPurchasesBatch([purchase('1', '529.982.247-25')], ADMIN, true);
    expect(all('customers')).toHaveLength(1);
    expect(all('purchases')).toHaveLength(1);
  });
});

// ===================================================================
// 4. LGPD: anonimização completa
// ===================================================================
describe('Review 4 - anonimização LGPD completa', () => {
  const CPF = '529.982.247-25';
  const seed = () => {
    put('customers', 'cust-flex-52998224725', {
      id: 'cust-flex-52998224725', name: 'Maria da Silva', cpf: CPF, whatsapp: '(41) 99999-1234', email: 'maria@exemplo.test',
      createdAt: '2024-01-01T00:00:00.000Z', origin: 'Importação Flex'
    });
    put('customers', 'cust-outro', { id: 'cust-outro', name: 'João Souza', cpf: '111.444.777-35', createdAt: '2024-01-01T00:00:00.000Z' });
    put('purchases', 'p1', { id: 'p1', customerId: 'cust-flex-52998224725', customerName: 'Maria da Silva', customerCpf: CPF });
    put('purchases', 'p2', { id: 'p2', customerId: 'cust-outro', customerName: 'João Souza', customerCpf: '111.444.777-35' });
    put('interactions', 'i1', {
      id: 'i1', customerId: 'cust-flex-52998224725', customerName: 'Maria da Silva',
      subject: 'Reclamação da Maria da Silva', description: 'CPF 529.982.247-25, tel 41999991234, maria@exemplo.test', resolution: 'Ok'
    });
    put('interactions', 'i2', { id: 'i2', customerId: 'cust-outro', customerName: 'João Souza', subject: 'Elogio', description: 'João Souza elogiou' });
    put('tasks', 't1', { id: 't1', customerId: 'cust-flex-52998224725', customerName: 'Maria da Silva', title: 'Ligar para Maria da Silva', description: 'CPF 52998224725' });
    put('club_offer_usages', 'u1', { id: 'u1', customerId: 'cust-flex-52998224725', customerName: 'Maria da Silva', customerCpf: CPF });
    put('club_offer_usages', 'u2', { id: 'u2', customerId: 'cust-outro', customerName: 'João Souza', customerCpf: '111.444.777-35' });
    put('club_offers', 'o1', { id: 'o1', selectedCustomerIds: ['cust-outro', 'cust-flex-52998224725'] });
  };

  it('zero nome/CPF/contato residual do titular (inclusive no ID); outros clientes intactos', async () => {
    seed();
    const svc = await import('../src/services/firestoreService');
    const auditBefore = all('audit_logs').length;
    const result = await svc.anonymizeCustomerLGPD('cust-flex-52998224725', ADMIN);

    // ID novo sem CPF; documento antigo removido
    const newId = result!.id;
    expect(newId).toMatch(/^cust-anon-[0-9a-f]{16}$/);
    expect(store().get('customers')!.has('cust-flex-52998224725')).toBe(false);
    const anon = store().get('customers')!.get(newId);
    expect(anon.name).toMatch(/^Titular Anonimizado #[0-9A-Z]{7}$/);

    const touched = JSON.stringify([
      [newId, anon],
      store().get('purchases')!.get('p1'),
      store().get('interactions')!.get('i1'),
      store().get('tasks')!.get('t1'),
      store().get('club_offer_usages')!.get('u1'),
      store().get('club_offers')!.get('o1'),
      all('audit_logs').slice(auditBefore)
    ]);
    for (const pii of ['Maria da Silva', '529.982.247-25', '52998224725', '41999991234', '99999-1234', 'maria@exemplo.test']) {
      expect(touched).not.toContain(pii);
    }
    // referências seguem o titular
    for (const [col, id] of [['purchases', 'p1'], ['interactions', 'i1'], ['tasks', 't1'], ['club_offer_usages', 'u1']]) {
      expect(store().get(col)!.get(id).customerId).toBe(newId);
    }
    expect(store().get('club_offers')!.get('o1').selectedCustomerIds).toEqual(['cust-outro', newId]);
    expect(store().get('interactions')!.get('i1')).toMatchObject({ customerName: anon.name, resolution: 'Ok' });
    expect(store().get('club_offer_usages')!.get('u1').customerCpf).toBe('***.***.***-**');

    // outro cliente intacto
    expect(store().get('customers')!.get('cust-outro').name).toBe('João Souza');
    expect(store().get('purchases')!.get('p2')).toMatchObject({ customerId: 'cust-outro', customerName: 'João Souza' });
    expect(store().get('interactions')!.get('i2').description).toBe('João Souza elogiou');
    expect(store().get('club_offer_usages')!.get('u2').customerCpf).toBe('111.444.777-35');
  });

  it('cliente com ID sem dado pessoal (ex.: cadastro do site) mantém o ID', async () => {
    const id = 'cust-site-402c935df5d8160887be0964';
    put('customers', id, { id, name: 'Ana Lima', cpf: '529.982.247-25', createdAt: '2024-01-01T00:00:00.000Z' });
    const svc = await import('../src/services/firestoreService');
    const r = await svc.anonymizeCustomerLGPD(id, ADMIN);
    expect(r!.id).toBe(id);
    expect(store().get('customers')!.get(id)).toMatchObject({ isAnonymized: true, cpf: '***.***.***-**' });
    expect(JSON.stringify(store().get('customers')!.get(id))).not.toContain('Ana Lima');
  });

  it('IDs em hexadecimal (PDV) e por timestamp não são trocados', async () => {
    const svc = await import('../src/services/firestoreService');
    for (const id of [svc.pdvCustomerId('52998224725'), 'cust-1696000000000']) {
      put('customers', id, { id, name: 'Fulano Teste', cpf: '529.982.247-25', createdAt: '2024-01-01T00:00:00.000Z' });
      const r = await svc.anonymizeCustomerLGPD(id, ADMIN);
      expect(r!.id).toBe(id);
    }
  });
});

// ===================================================================
// 5-7. Permissões e carga inicial
// ===================================================================
describe('Review 5-7 - permissões e carga', () => {
  it('perfis: Consulta não importa nem acessa LGPD/Configurações; só admin anonimiza', () => {
    expect(canImport('viewer')).toBe(false);
    expect(canImport('manager')).toBe(true);
    expect(canAccessView('viewer', 'lgpd')).toBe(false);
    expect(canAccessView('viewer', 'settings')).toBe(false);
    expect(canAccessView('viewer', 'dashboard')).toBe(true);
    expect(canAccessView('manager', 'lgpd')).toBe(true);
    expect(canAnonymize('manager')).toBe(false);
    expect(canAnonymize('admin')).toBe(true);
  });

  it('tela de LGPD e handler exigem admin para anonimizar', () => {
    expect(readFileSync('src/components/LGPD/LGPDComplianceView.tsx', 'utf8')).toMatch(/currentUser\.role === 'admin' && !c\.isAnonymized/);
    expect(readFileSync('src/context/CRMContext.tsx', 'utf8')).toMatch(/handleAnonymizeCustomer = async[\s\S]{0,200}role !== 'admin'/);
    expect(readFileSync('firestore.rules', 'utf8')).toMatch(/isAnonymized/);
  });

  it('campanhas/cupons/ofertas/segmentos/tarefas sem limite arbitrário', async () => {
    const src = readFileSync('src/services/firestoreService.ts', 'utf8');
    expect(src).not.toMatch(/collection\(db, (CAMPAIGNS|COUPONS|CLUB_OFFERS|SEGMENTS|TASKS)_COL\), limit\(/);
    const svc = await import('../src/services/firestoreService');
    for (let i = 0; i < 160; i++) put('campaigns', `c${i}`, { id: `c${i}`, name: `Campanha ${i}` });
    expect(await svc.getCampaigns({ forceRefresh: true })).toHaveLength(160);
  });
});
