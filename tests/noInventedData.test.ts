import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { parsePDVExcelFile } from '../src/services/pdvParser';
import { parseFlexExcelFile } from '../src/services/flexCustomerParser';
import { displayCustomerName } from '../src/utils/customerFormUtils';
import { buildXlsx } from './helpers';
import { createFirestoreMock, MemStore } from './firestoreMock';

const mem = vi.hoisted(() => ({ store: new Map() as any }));
vi.mock('firebase/firestore', () => createFirestoreMock(mem.store));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

const USER = { id: 'u', name: 'Operador', email: 'op@exemplo.test', role: 'admin' } as any;
const H = ['Cupom', 'Data', 'CPF', 'Nome', 'Produto', 'Quantidade', 'Valor Unitário', 'Valor Total', 'Loja'];

beforeEach(() => {
  (mem.store as MemStore).clear();
  vi.resetModules();
});

// ===================================================================
// 1. Nome ausente não vira "Cliente Identificado PDV"
// ===================================================================
describe('PDV - nome do cliente', () => {
  it('A. CPF válido + nome ausente não gera nome fictício (compra nem cliente criado)', async () => {
    const { purchases } = (await parsePDVExcelFile(buildXlsx([
      H, ['1', '10/01/2025', '529.982.247-25', '', 'Arroz', '1', '10', '10', 'Astral Rodovia dos Minérios']
    ]))).extractAllPurchases();
    expect(purchases[0].customerName).toBe('');

    const svc = await import('../src/services/firestoreService');
    const r = await svc.importPurchasesBatch(purchases, USER, true);
    expect(r.newCustomersCount).toBe(1); // cliente por CPF continua sendo criado, sem nome inventado
    const store = mem.store as MemStore;
    const customer = Array.from(store.get('customers')!.values())[0];
    expect(customer.cpf).toBe('529.982.247-25');
    expect(customer.name).toBe('');
    const all = JSON.stringify(Array.from(store.get('purchases')!.values())) + JSON.stringify(customer);
    expect(all).not.toContain('Cliente Identificado PDV');
  });

  it('B. nome real continua preservado', async () => {
    const { purchases } = (await parsePDVExcelFile(buildXlsx([
      H,
      ['1', '10/01/2025', '529.982.247-25', '', 'Arroz', '1', '10', '10', 'Astral Rodovia dos Minérios'],
      ['1', '10/01/2025', '529.982.247-25', 'Maria Teste', 'Feijão', '1', '5', '5', 'Astral Rodovia dos Minérios']
    ]))).extractAllPurchases();
    expect(purchases[0].customerName).toBe('Maria Teste');
    const svc = await import('../src/services/firestoreService');
    await svc.importPurchasesBatch(purchases, USER, true);
    expect(Array.from((mem.store as MemStore).get('customers')!.values())[0].name).toBe('Maria Teste');
  });

  it('C. nome verdadeiro pode preencher a ausência depois (importação Flex)', async () => {
    const flex = parseFlexExcelFile(buildXlsx([
      ...Array.from({ length: 12 }, (_, i) => [`Relatório ${i + 1}`]),
      ['Código', 'Nome Do Cliente', 'CNPJ / CPF'],
      ['C1', 'Maria Verdadeira', '52998224725']
    ]));
    const existing = [{ id: 'cust-0001', name: '', cpf: '529.982.247-25' } as any];
    const { customers, updatedCustomers } = await flex.extractAllCustomers(existing);
    expect(customers[0]).toMatchObject({ id: 'cust-0001', name: 'Maria Verdadeira' });
    expect(updatedCustomers.map(c => c.id)).toContain('cust-0001');
  });

  it('nome ausente aparece como "Cliente sem nome" só na apresentação', () => {
    expect(displayCustomerName('')).toBe('Cliente sem nome');
    expect(displayCustomerName('   ')).toBe('Cliente sem nome');
    expect(displayCustomerName(undefined)).toBe('Cliente sem nome');
    expect(displayCustomerName('Maria')).toBe('Maria');
    const src = ['src/services/pdvParser.ts', 'src/components/Purchases/PDVImportModal.tsx']
      .map(f => readFileSync(f, 'utf8')).join('\n');
    expect(src).not.toContain('Cliente Identificado PDV');
  });
});

// ===================================================================
// 2. Quantidade ausente não vira 1
// ===================================================================
describe('PDV - quantidade', () => {
  it('D. quantidade ausente (célula vazia ou sem coluna) não vira 1 nem inventa valores', async () => {
    const semColuna = (await parsePDVExcelFile(buildXlsx([
      ['Cupom', 'Data', 'Produto', 'Valor Total', 'Loja'],
      ['1', '10/01/2025', 'Arroz', '10', 'Astral Rodovia dos Minérios']
    ]))).extractAllPurchases().purchases[0];
    expect(semColuna.items[0].quantity).toBeNull();
    expect(semColuna.items[0].totalPrice).toBe(10);
    expect(semColuna.items[0].unitPrice).not.toBe(10); // não divide o total por uma quantidade inventada

    const vazia = (await parsePDVExcelFile(buildXlsx([
      H, ['2', '10/01/2025', '', '', 'Arroz', '', '7,50', '', 'Astral Rodovia dos Minérios'],
      ['2', '10/01/2025', '', '', 'Feijão', '', '', '4', 'Astral Rodovia dos Minérios']
    ]))).extractAllPurchases();
    // sem quantidade e sem total não há valor confiável do item: não multiplica por 1
    expect(vazia.purchases[0].items.map(i => i.quantity)).toEqual([null, null]);
    expect(vazia.purchases[0].items[0].totalPrice).toBe(0);
    expect(vazia.purchases[0].totalAmount).toBe(4);
  });

  it('E. quantidade válida continua funcionando (inclusive fracionada)', async () => {
    const { purchases } = (await parsePDVExcelFile(buildXlsx([
      H,
      ['1', '10/01/2025', '', '', 'Picanha', '1,45', '79,90', '', 'Astral Rodovia dos Minérios'],
      ['1', '10/01/2025', '', '', 'Cerveja', '12', '', '52,68', 'Astral Rodovia dos Minérios']
    ]))).extractAllPurchases();
    expect(purchases[0].items[0]).toMatchObject({ quantity: 1.45, unitPrice: 79.9, totalPrice: 115.86 });
    expect(purchases[0].items[1]).toMatchObject({ quantity: 12, unitPrice: 4.39, totalPrice: 52.68 });
  });
});

// ===================================================================
// 3/4. Clube Astral
// ===================================================================
describe('Clube Astral', () => {
  it('F. uso sem PDV informado não grava "PDV 01"', async () => {
    const src = readFileSync('src/components/Loyalty/LoyaltyClubView.tsx', 'utf8');
    expect(src).not.toMatch(/posNumber:\s*'PDV 01'/);

    const svc = await import('../src/services/firestoreService');
    const usage = await svc.recordClubOfferUsage({
      offerId: 'o1', productSku: 'X', productName: 'Produto', customerId: 'c1', customerName: 'Cliente',
      quantity: 1, normalPrice: 10, clubPrice: 9, unitDiscount: 1, totalSavings: 1, totalPaid: 9
    } as any, USER);
    const saved = (mem.store as MemStore).get('club_offer_usages')!.get(usage.id);
    expect(saved.posNumber).toBeUndefined();
  });

  it('G. catálogo demo de produtos não é exposto no formulário', () => {
    const src = readFileSync('src/components/Loyalty/LoyaltyClubView.tsx', 'utf8');
    expect(src).not.toMatch(/DEMO_PRODUCT_CATALOG|handleSelectDemoProduct/);
    expect(src).not.toMatch(/'7896006711124'|Casillero del Diablo/);
  });
});

// ===================================================================
// 5/7. Lojas e base vazia continuam como na rodada 3
// ===================================================================
describe('Sem regressões de loja/base', () => {
  it('H. store-04 escolhida manualmente continua funcionando e não há fallback store-01', async () => {
    const r = await parsePDVExcelFile(buildXlsx([
      ['Cupom', 'Data', 'Produto', 'Quantidade', 'Valor Total'],
      ['9', '10/01/2025', 'Arroz', '1', '10']
    ]));
    expect(r.extractAllPurchases().purchases).toEqual([]);
    const { purchases } = r.extractAllPurchases({ manualStore: { id: 'store-04', name: 'Loja 04' } });
    expect(purchases[0]).toMatchObject({ storeId: 'store-04', id: 'pdv_store-04_9_20250110' });
  });

  it('I. base vazia não executa seed demo e o botão de exemplo não reapareceu', async () => {
    const svc = await import('../src/services/firestoreService');
    expect(await svc.initializeDatabase()).toEqual({ isSeeded: false, count: 0 });
    const store = mem.store as MemStore;
    ['customers', 'purchases', 'campaigns', 'coupons', 'club_offers', 'club_offer_usages'].forEach(c =>
      expect(store.get(c)?.size ?? 0).toBe(0)
    );
    const modal = readFileSync('src/components/Purchases/PDVImportModal.tsx', 'utf8');
    expect(modal).not.toMatch(/handleLoadSampleData|Carregar Lote Exemplo/);
  });
});
