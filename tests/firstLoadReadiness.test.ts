import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { parsePDVExcelFile, getPDVImportBlockReason, formatCpf as pdvFormatDoc } from '../src/services/pdvParser';
import { normalizeDocument } from '../src/services/flexCustomerParser';
import { isValidCnpj, formatCnpj, cleanCnpjDigits } from '../src/utils/cnpjValidator';
import { normalizeOptionalText } from '../src/utils/customerFormUtils';
import { buildXlsx } from './helpers';
import { createFirestoreMock, MemStore } from './firestoreMock';

const mem = vi.hoisted(() => ({ store: new Map() as any }));
vi.mock('firebase/firestore', () => createFirestoreMock(mem.store));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

const STORE_04 = { id: 'store-04', name: 'Super Astral - Loja 04 (futura)' };

// ===================================================================
// 1. Arquivo PDV sem loja / loja não reconhecida
// ===================================================================
describe('PDV - resolução de loja', () => {
  const H = ['Cupom', 'Data', 'Produto', 'Categoria', 'Valor Total', 'Loja', 'PDV', 'Forma Pagamento'];

  it('A. arquivo com loja reconhecida usa a loja do arquivo', async () => {
    const r = await parsePDVExcelFile(buildXlsx([H, ['1', '10/01/2025', 'Arroz', 'Mercearia', '10', 'Astral Centro', 'PDV 1', 'PIX']]));
    expect(r.storeResolution).toEqual({ storeColumnFound: true, unresolvedReceiptsCount: 0, unrecognizedValues: [] });
    expect(getPDVImportBlockReason(r, null)).toBeNull();
    const { purchases, errors } = r.extractAllPurchases();
    expect(errors).toEqual([]);
    expect(purchases[0].storeId).toBe('store-02');
  });

  it('B. arquivo sem coluna de loja pede seleção manual (não assume store-01 nem rejeita de cara)', async () => {
    const r = await parsePDVExcelFile(buildXlsx([
      ['Cupom', 'Data', 'Produto', 'Valor Total'],
      ['1', '10/01/2025', 'Arroz', '10'],
      ['2', '11/01/2025', 'Feijão', '8']
    ]));
    expect(r.storeResolution.storeColumnFound).toBe(false);
    expect(r.storeResolution.unresolvedReceiptsCount).toBe(2);
    expect(getPDVImportBlockReason(r, null)).toMatch(/não informa a loja/i);
  });

  it('C. seleção manual aplica a loja escolhida só aos cupons sem loja reconhecida (inclusive futura store-04)', async () => {
    const r = await parsePDVExcelFile(buildXlsx([
      H,
      ['1', '10/01/2025', 'Arroz', 'Mercearia', '10', '', 'PDV 1', 'PIX'],
      ['2', '10/01/2025', 'Arroz', 'Mercearia', '10', 'Super Astral Bertolina', 'PDV 1', 'PIX']
    ]));
    expect(getPDVImportBlockReason(r, STORE_04)).toBeNull();
    const { purchases, errors } = r.extractAllPurchases({ manualStore: STORE_04 });
    expect(errors).toEqual([]);
    expect(purchases.find(p => p.couponReceiptNumber === '1')).toMatchObject({ storeId: 'store-04', storeName: STORE_04.name, id: 'pdv_store-04_1_20250110' });
    expect(purchases.find(p => p.couponReceiptNumber === '2')!.storeId).toBe('store-03');
    // a escolha vale só para esta extração
    expect(r.extractAllPurchases().purchases.map(p => p.couponReceiptNumber)).toEqual(['2']);
  });

  it('C. cupom sem número com loja escolhida gera o mesmo ID que o arquivo com a loja explícita', async () => {
    const rowNoStore = ['', '10/01/2025 09:15', 'Arroz', 'Mercearia', '10', '', 'PDV 3', 'PIX'];
    const rowStore = ['', '10/01/2025 09:15', 'Arroz', 'Mercearia', '10', 'Astral Rodovia dos Minérios', 'PDV 3', 'PIX'];
    const manual = (await parsePDVExcelFile(buildXlsx([H, rowNoStore])))
      .extractAllPurchases({ manualStore: { id: 'store-01', name: 'Astral Rodovia dos Minérios - Travessa Paulo Bini, 250' } });
    const explicit = (await parsePDVExcelFile(buildXlsx([H, rowStore]))).extractAllPurchases();
    expect(manual.errors).toEqual([]);
    expect(manual.purchases[0].id).toBe(explicit.purchases[0].id);
  });

  it('D. loja desconhecida não vira store-01 e o valor encontrado é informado', async () => {
    const r = await parsePDVExcelFile(buildXlsx([H, ['1', '10/01/2025', 'Arroz', 'Mercearia', '10', 'Filial Centro', 'PDV 1', 'PIX']]));
    expect(r.storeResolution.unrecognizedValues).toEqual(['Filial Centro']);
    expect(getPDVImportBlockReason(r, null)).toContain('Filial Centro');
    const { purchases, errors } = r.extractAllPurchases();
    expect(purchases).toEqual([]);
    expect(errors[0].reason).toContain('Filial Centro');
  });

  it('E. sem loja escolhida a importação fica bloqueada e nada é gerado para esses cupons', async () => {
    const r = await parsePDVExcelFile(buildXlsx([['Cupom', 'Data', 'Produto', 'Valor Total'], ['1', '10/01/2025', 'Arroz', '10']]));
    expect(getPDVImportBlockReason(r, null)).not.toBeNull();
    expect(getPDVImportBlockReason(r, undefined)).not.toBeNull();
    expect(r.extractAllPurchases().purchases).toEqual([]);
    expect(r.extractAllPurchases({ manualStore: null }).purchases).toEqual([]);
  });

  it('modal usa as lojas do sistema (contexto) e não tem mais botão de dados de exemplo', () => {
    const src = readFileSync('src/components/Purchases/PDVImportModal.tsx', 'utf8');
    expect(src).toMatch(/stores/);
    expect(src).not.toMatch(/handleLoadSampleData/);
    expect(src).not.toMatch(/'Nome Cliente': 'Guilherme Bini'/);
  });
});

// ===================================================================
// 2. Defaults inventados no PDV
// ===================================================================
describe('PDV - sem valores inventados', () => {
  it('F/G/H. ausência de PDV, pagamento e categoria não cria "PDV 01", "Cartão Crédito", "Mercearia"', async () => {
    const r = await parsePDVExcelFile(buildXlsx([['Cupom', 'Data', 'Valor Total', 'Loja'], ['1', '10/01/2025', '10', 'Astral Rodovia dos Minérios']]));
    const { purchases } = r.extractAllPurchases();
    const p = purchases[0];
    expect(p.posNumber).toBe('');
    expect(p.paymentMethod).toBeUndefined();
    expect(p.items[0].category).toBe('');
    expect(p.items[0].productName).toBe('');
    expect(p.items[0].sku).toBe('');
    expect(JSON.stringify(p)).not.toMatch(/PDV 01|Cartão Crédito|Mercearia|Produto Varejo|SKU-\d/);
  });

  it('valores informados continuam sendo usados', async () => {
    const r = await parsePDVExcelFile(buildXlsx([
      ['Cupom', 'Data', 'Produto', 'Categoria', 'Valor Total', 'Loja', 'PDV', 'Forma Pagamento'],
      ['1', '10/01/2025', 'Arroz', 'Mercearia', '10', 'Astral Rodovia dos Minérios', 'PDV 07', 'pix'],
      ['2', '10/01/2025', 'Arroz', 'Mercearia', '10', 'Astral Rodovia dos Minérios', 'PDV 07', 'Vale Refeição Xyz'],
      ['3', '10/01/2025', 'Arroz', 'Mercearia', '10', 'Astral Rodovia dos Minérios', 'PDV 07', 'Cheque']
    ]));
    const { purchases } = r.extractAllPurchases();
    expect(purchases[0]).toMatchObject({ posNumber: 'PDV 07', paymentMethod: 'PIX' });
    expect(purchases[0].items[0].category).toBe('Mercearia');
    expect(purchases[1].paymentMethod).toBe('Astral Vale'); // regra existente: "vale"
    expect(purchases[2].paymentMethod).toBe('Outro');       // informado mas não mapeado: não vira cartão
  });
});

// ===================================================================
// 3. Cidade / UF no cadastro manual
// ===================================================================
describe('Cadastro manual - cidade e UF', () => {
  it('I/J. cidade e UF vazias continuam vazias', () => {
    expect(normalizeOptionalText('')).toBeUndefined();
    expect(normalizeOptionalText('   ')).toBeUndefined();
    expect(normalizeOptionalText(undefined)).toBeUndefined();
    expect(normalizeOptionalText(' Curitiba ')).toBe('Curitiba');
    const src = readFileSync('src/components/Customers/CustomerModal.tsx', 'utf8');
    expect(src).not.toMatch(/useState\('Almirante Tamandaré'\)|useState\('PR'\)/);
    expect(src).not.toMatch(/\|\|\s*'Almirante Tamandaré'|\|\|\s*'PR'/);
    expect(src).not.toMatch(/setCity\('Almirante Tamandaré'\)|setState\('PR'\)/);
  });
});

// ===================================================================
// 4. CNPJ
// ===================================================================
describe('CNPJ - validação central', () => {
  it('K. CNPJ válido', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('45997418000153')).toBe(true);
  });
  it('N. CNPJ mascarado válido', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(cleanCnpjDigits(' 11.222.333/0001-81 ')).toBe('11222333000181');
  });
  it('L. CNPJ inválido / DV incorreto / tamanho errado', () => {
    expect(isValidCnpj('11222333000180')).toBe(false); // DV2
    expect(isValidCnpj('11222333000191')).toBe(false); // DV1
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('112223330001810')).toBe(false);
    expect(isValidCnpj('abc')).toBe(false);
  });
  it('M. sequência repetida', () => {
    for (let d = 0; d <= 9; d++) expect(isValidCnpj(String(d).repeat(14))).toBe(false);
  });
  it('vazio', () => {
    expect(isValidCnpj('')).toBe(false);
    expect(isValidCnpj(null)).toBe(false);
    expect(isValidCnpj(undefined)).toBe(false);
    expect(cleanCnpjDigits(null)).toBe('');
  });
  it('zeros à esquerda preservados como string', () => {
    // 00.623.904/0001-73 (sintético válido com zeros à esquerda)
    expect(isValidCnpj('00623904000173')).toBe(true);
    expect(formatCnpj('00623904000173')).toBe('00.623.904/0001-73');
    expect(typeof cleanCnpjDigits('00.623.904/0001-73')).toBe('string');
    expect(cleanCnpjDigits('00.623.904/0001-73')).toBe('00623904000173');
  });
  it('Flex usa a validação central (mantendo o preenchimento de zeros à esquerda do Flex)', () => {
    expect(normalizeDocument('11.222.333/0001-81')).toMatchObject({ type: 'CNPJ', formatted: '11.222.333/0001-81' });
    expect(normalizeDocument('11.222.333/0001-80').type).toBe('INVALIDO');
    expect(normalizeDocument(623904000173)).toMatchObject({ type: 'CNPJ', digits: '00623904000173' });
  });
  it('PDV usa a validação central', () => {
    expect(pdvFormatDoc('11222333000181')).toBe('11.222.333/0001-81');
    expect(pdvFormatDoc('11222333000180')).toBe('');
  });
});

// ===================================================================
// 6/8. Base vazia não ativa seed demo
// ===================================================================
describe('Base vazia', () => {
  beforeEach(() => {
    (mem.store as MemStore).clear();
    vi.resetModules();
  });

  it('O. base vazia é estado válido e não recria dados demo (abrir, refresh, sincronizar)', async () => {
    const svc = await import('../src/services/firestoreService');
    const r1 = await svc.initializeDatabase();
    expect(r1).toEqual({ isSeeded: false, count: 0 });
    expect(await svc.getCustomers({ forceRefresh: true })).toEqual([]);
    expect(await svc.getPurchases({ forceRefresh: true })).toEqual([]);

    // "refresh" / novo carregamento do app
    vi.resetModules();
    const svc2 = await import('../src/services/firestoreService');
    expect(await svc2.initializeDatabase()).toEqual({ isSeeded: false, count: 0 });

    const store = mem.store as MemStore;
    for (const col of ['customers', 'purchases', 'campaigns', 'coupons', 'interactions', 'tasks', 'segments', 'club_offers', 'club_offer_usages']) {
      expect(store.get(col)?.size ?? 0).toBe(0);
    }
    // Somente as 3 lojas reais são garantidas
    expect(Array.from(store.get('stores')!.keys()).sort()).toEqual(['store-01', 'store-02', 'store-03']);
  });

  it('O. lojas existentes (ex.: store-04 cadastrada) não são sobrescritas nem recriadas', async () => {
    const store = mem.store as MemStore;
    store.set('stores', new Map([['store-04', { id: 'store-04', name: 'Loja 04' }]]));
    const svc = await import('../src/services/firestoreService');
    const stores = await svc.getStores({ forceRefresh: true });
    expect(stores.map(s => s.id)).toEqual(['store-04']);
    expect(Array.from(store.get('stores')!.keys())).toEqual(['store-04']);
  });
});
