import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock, MemStore } from './firestoreMock';

const mem = vi.hoisted(() => ({ store: new Map() as any }));
vi.mock('firebase/firestore', () => createFirestoreMock(mem.store));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

const user = { id: 'u', name: 'T', email: 't@x', role: 'admin' } as any;
const CPF = '52998224725';

function order(over: Record<string, any> = {}) {
  return {
    id: 'o1',
    code: 'ASCDEF34',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T15:00:00.000Z',
    status: 'concluido',
    statusHistory: [
      { status: 'recebido', at: '2026-10-01T10:00:00.000Z' },
      { status: 'concluido', at: '2026-10-01T14:30:00.000Z' }
    ],
    storeId: 'store-02',
    mode: 'entrega',
    customer: { name: 'Maria da Silva', phone: '32999887766', email: 'Maria@Exemplo.com', cpf: CPF },
    address: { cep: '36400000', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Conselheiro Lafaiete' },
    items: [
      { sku: '123', name: 'Arroz 5kg', quantity: 2, unitPrice: 25, lineTotal: 50 },
      { sku: '456', name: 'Banana', quantity: 1.2, quantityMode: 'kg', unitPrice: 6, lineTotal: 7.2, isEstimate: true }
    ],
    subtotal: 57.2,
    deliveryFee: 5,
    total: 62.2,
    payment: { method: 'pix' },
    ...over
  } as any;
}

describe('Loja online - plano de sincronização (sem banco)', () => {
  it('cria cliente pelo CPF com o mesmo ID do PDV e sem consentimento de marketing', async () => {
    const { planOnlineOrdersSync } = await import('../src/services/onlineOrders');
    const { pdvCustomerId } = await import('../src/services/firestoreService');
    const plan = planOnlineOrdersSync([order()], []);
    expect(plan.newCustomersCount).toBe(1);
    const c = plan.customersToSave[0];
    expect(c.id).toBe(pdvCustomerId(CPF));
    expect(c.cpf).toBe('529.982.247-25');
    expect(c.origin).toBe('Loja Online');
    expect(c.email).toBe('maria@exemplo.com');
    expect(c.cep).toBe('36400000');
    expect(c.consent.whatsappMarketing).toBe(false);
    expect(c.consent.emailMarketing).toBe(false);
    expect(c.tags).toContain('loja-online');
  });

  it('pedido concluído vira compra com ID estável, loja e data de conclusão', async () => {
    const { planOnlineOrdersSync } = await import('../src/services/onlineOrders');
    const plan = planOnlineOrdersSync([order()], []);
    expect(plan.purchases).toHaveLength(1);
    const p = plan.purchases[0];
    expect(p.id).toBe('online_ASCDEF34');
    expect(p.customerId).toBe(plan.customersToSave[0].id);
    expect(p.storeId).toBe('store-02');
    expect(p.posNumber).toBe('Loja Online');
    expect(p.purchaseDate).toBe('2026-10-01T14:30:00.000Z');
    expect(p.netAmount).toBe(62.2);
    expect(p.paymentMethod).toBe('PIX');
    expect(p.items).toHaveLength(2);
  });

  it('pedidos em andamento e cancelados geram cadastro, mas não compra', async () => {
    const { planOnlineOrdersSync } = await import('../src/services/onlineOrders');
    const plan = planOnlineOrdersSync([
      order({ status: 'separando' }),
      order({ id: 'o2', code: 'ASXXXX99', status: 'cancelado', customer: { name: 'João', phone: '32988776655' } })
    ], []);
    expect(plan.purchases).toHaveLength(0);
    expect(plan.newCustomersCount).toBe(2);
  });

  it('cliente existente só recebe campos vazios; nada cadastrado é sobrescrito', async () => {
    const { planOnlineOrdersSync } = await import('../src/services/onlineOrders');
    const existing: any = {
      id: 'cust-flex-1', name: 'MARIA S. (FLEX)', cpf: '529.982.247-25', whatsapp: '32911112222', origin: 'Importação',
      email: '', consent: { whatsappMarketing: true, emailMarketing: false, smsMarketing: false, origin: 'Flex', purpose: 'x' },
      totalSpent: 100, totalPurchases: 3, averageTicket: 33, daysSinceLastPurchase: 5, rfmSegment: 'CAMPEOES',
      recencyScore: 5, frequencyScore: 5, monetaryScore: 5, rfmScoreCode: '555', createdAt: 'x', updatedAt: 'x'
    };
    const plan = planOnlineOrdersSync([order()], [existing]);
    expect(plan.newCustomersCount).toBe(0);
    expect(plan.updatedCustomersCount).toBe(1);
    const c = plan.customersToSave[0];
    expect(c.id).toBe('cust-flex-1');
    expect(c.name).toBe('MARIA S. (FLEX)');
    expect(c.whatsapp).toBe('32911112222');
    expect(c.email).toBe('maria@exemplo.com');
    expect(c.consent.whatsappMarketing).toBe(true);
    expect(plan.purchases[0].customerId).toBe('cust-flex-1');
  });

  it('sem CPF, o celular identifica o mesmo cliente em pedidos diferentes', async () => {
    const { planOnlineOrdersSync } = await import('../src/services/onlineOrders');
    const noCpf = { name: 'Ana', phone: '(32) 99777-6655' };
    const plan = planOnlineOrdersSync([
      order({ customer: noCpf }),
      order({ id: 'o2', code: 'ASYYYY77', customer: noCpf })
    ], []);
    expect(plan.newCustomersCount).toBe(1);
    expect(plan.customersToSave[0].cpf).toBe('');
    expect(plan.customersToSave[0].id).toMatch(/^cust-online-/);
    expect(new Set(plan.purchases.map(p => p.customerId)).size).toBe(1);
  });

  it('pedido sem CPF e sem celular é ignorado com motivo', async () => {
    const { planOnlineOrdersSync } = await import('../src/services/onlineOrders');
    const plan = planOnlineOrdersSync([order({ customer: { name: 'X', phone: '123' } })], []);
    expect(plan.customersToSave).toHaveLength(0);
    expect(plan.skippedOrders).toHaveLength(1);
  });

  it('cliente anonimizado (LGPD) não recebe dados nem compras novas', async () => {
    const { planOnlineOrdersSync } = await import('../src/services/onlineOrders');
    const anon: any = {
      id: 'cust-anon', name: 'Titular anonimizado', cpf: '529.982.247-25', whatsapp: '', email: '', origin: 'PDV',
      isAnonymized: true, consent: { whatsappMarketing: false, emailMarketing: false, smsMarketing: false, origin: 'x', purpose: 'x' },
      totalSpent: 0, totalPurchases: 0, averageTicket: 0, daysSinceLastPurchase: 0, rfmSegment: 'UNCLASSIFIED',
      recencyScore: 0, frequencyScore: 0, monetaryScore: 0, rfmScoreCode: '000', createdAt: 'x', updatedAt: 'x'
    };
    const plan = planOnlineOrdersSync([order()], [anon]);
    const saved = plan.customersToSave.find(c => c.id === 'cust-anon');
    expect(saved?.email ?? '').toBe('');
    expect(plan.purchases).toHaveLength(0);
  });
});

describe('Loja online - sincronização com o banco', () => {
  beforeEach(() => {
    (mem.store as MemStore).clear();
    vi.resetModules();
  });

  it('grava cliente e compra, recalcula métricas e não duplica ao rodar de novo', async () => {
    const store = mem.store as MemStore;
    store.set('shop_orders', new Map([['o1', order()], ['o2', order({ id: 'o2', code: 'ASZZZZ66', status: 'recebido' })]]));
    const { syncOnlineOrders } = await import('../src/services/onlineOrders');

    const r1 = await syncOnlineOrders(user);
    expect(r1.ordersRead).toBe(2);
    expect(r1.newCustomersCount).toBe(1);
    expect(r1.purchasesImported).toBe(1);
    expect(store.get('purchases')!.has('online_ASCDEF34')).toBe(true);
    const cust = Array.from(store.get('customers')!.values())[0];
    expect(cust.totalSpent).toBeCloseTo(62.2);
    expect(cust.totalPurchases).toBe(1);

    vi.resetModules();
    const again = await import('../src/services/onlineOrders');
    const r2 = await again.syncOnlineOrders(user);
    expect(r2.purchasesImported).toBe(0);
    expect(r2.purchasesAlreadyInCRM).toBe(1);
    expect(store.get('purchases')!.size).toBe(1);
    expect(store.get('customers')!.size).toBe(1);
  });

  it('compra online se junta ao histórico do PDV do mesmo CPF', async () => {
    const store = mem.store as MemStore;
    const { pdvCustomerId } = await import('../src/services/firestoreService');
    const id = pdvCustomerId(CPF);
    store.set('customers', new Map([[id, {
      id, name: 'Maria', cpf: '529.982.247-25', whatsapp: '', origin: 'PDV Importação', createdAt: 'x', updatedAt: 'x',
      consent: { whatsappMarketing: false, emailMarketing: false, smsMarketing: false, origin: 'PDV', purpose: 'x' },
      totalSpent: 40, totalPurchases: 1, averageTicket: 40, daysSinceLastPurchase: 0, rfmSegment: 'UNCLASSIFIED',
      recencyScore: 0, frequencyScore: 0, monetaryScore: 0, rfmScoreCode: '000'
    }]]));
    store.set('purchases', new Map([['pdv_store-01_100_20260920', {
      id: 'pdv_store-01_100_20260920', customerId: id, storeId: 'store-01', storeName: 'Astral Rodovia dos Minérios',
      couponReceiptNumber: '100', purchaseDate: '2026-09-20T12:00:00.000Z', totalAmount: 40, netAmount: 40, discountAmount: 0, items: [], itemsCount: 0
    }]]));
    store.set('shop_orders', new Map([['o1', order()]]));
    const { syncOnlineOrders } = await import('../src/services/onlineOrders');
    await syncOnlineOrders(user);
    const cust = store.get('customers')!.get(id);
    expect(store.get('customers')!.size).toBe(1);
    expect(cust.totalPurchases).toBe(2);
    expect(cust.totalSpent).toBeCloseTo(102.2);
    expect(cust.email).toBe('maria@exemplo.com');
  });
});
