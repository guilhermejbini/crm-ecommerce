import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePDVExcelFile, parseDate, parseNumber, formatCpf } from '../src/services/pdvParser';
import { computeRFMWindowMetrics } from '../src/services/rfmCalculator';
import { buildXlsx } from './helpers';
import { createFirestoreMock, MemStore } from './firestoreMock';

const mem = vi.hoisted(() => ({ store: new Map() as any }));
vi.mock('firebase/firestore', () => createFirestoreMock(mem.store));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

// Planilha PDV artificial (CPFs sintéticos). Datas como texto, formato BR.
const HEADER = ['Cupom', 'Data Emissão', 'CPF Cliente', 'Nome Cliente', 'Produto', 'Quantidade', 'Valor Unitário', 'Valor Total', 'Loja'];
const ROWS = [
  ['1001', '15/01/2026 10:30', '529.982.247-25', 'Cliente A', 'Arroz 5kg', '2', '25,90', '51,80', 'Astral Rodovia dos Minérios'],
  ['1001', '15/01/2026 10:30', '529.982.247-25', 'Cliente A', 'Feijão 1kg', '1', '8,50', '8,50', 'Astral Rodovia dos Minérios'],
  ['1002', '20/03/2026 18:05', '111.444.777-00', 'Cliente B', 'Leite 1L', '6', '4,99', '', 'Av. Emílio Johnson, 675'],
  ['1003', '10/06/2026', '', '', 'Pão', '1', '0', '0', 'Super Astral Bertolina']
];
const pdvFile = () => buildXlsx([HEADER, ...ROWS], 'Vendas');

describe('pdvParser - parsePDVExcelFile', () => {
  it('identifica cupons e agrupa itens do mesmo cupom', async () => {
    const r = await parsePDVExcelFile(pdvFile());
    expect(r.headerRowNumber).toBe(1);
    expect(r.detectedColumns.receiptCol).toBe('Cupom');
    const { purchases, errors } = r.extractAllPurchases();
    expect(purchases.map(p => p.couponReceiptNumber)).toEqual(['1001', '1002']);
    const c1001 = purchases.find(p => p.couponReceiptNumber === '1001')!;
    expect(c1001.items).toHaveLength(2);
    expect(c1001.totalAmount).toBe(60.3);
    expect(c1001.netAmount).toBe(60.3);
    expect(c1001.storeId).toBe('store-01');
    // Cupom zerado vira erro, não compra
    expect(errors).toHaveLength(1);
    expect(errors[0].receiptNo).toBe('1003');
  });

  it('valores: formato BR e total calculado por quantidade x unitário', async () => {
    const { purchases } = (await parsePDVExcelFile(pdvFile())).extractAllPurchases();
    const c1002 = purchases.find(p => p.couponReceiptNumber === '1002')!;
    expect(c1002.items[0].totalPrice).toBe(29.94);
    expect(c1002.totalAmount).toBe(29.94);
    expect(c1002.storeId).toBe('store-02');
    expect(parseNumber('R$ 1.250,50')).toBe(1250.5);
    expect(parseNumber('1250.50')).toBe(1250.5);
    expect(parseNumber('', 7)).toBe(7);
  });

  it('CPF válido é formatado; CPF inválido não é aceito', async () => {
    const { purchases } = (await parsePDVExcelFile(pdvFile())).extractAllPurchases();
    expect(purchases.find(p => p.couponReceiptNumber === '1001')!.customerCpf).toBe('529.982.247-25');
    expect(purchases.find(p => p.couponReceiptNumber === '1002')!.customerCpf).toBe('');
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCpf('52998224724')).toBe('');
    expect(formatCpf('11111111111')).toBe('');
  });

  it('datas em texto BR (com e sem hora) são convertidas', async () => {
    const { purchases } = (await parsePDVExcelFile(pdvFile())).extractAllPurchases();
    expect(purchases.find(p => p.couponReceiptNumber === '1001')!.purchaseDate)
      .toBe(new Date(2026, 0, 15, 10, 30, 0).toISOString());
    expect(parseDate('10/06/2026')).toBe(new Date(2026, 5, 10, 12, 0, 0).toISOString());
    expect(parseDate('2026-06-10T08:00:00.000Z')).toBe('2026-06-10T08:00:00.000Z');
    // Rodada 2: serial sem horário segue a mesma regra das datas em texto (12:00 local),
    // antes era meia-noite UTC (= dia anterior no horário de Brasília).
    expect(parseDate(45672)).toBe(new Date(2025, 0, 15, 12, 0, 0).toISOString());
  });

  it('mesma planilha processada duas vezes gera os mesmos IDs determinísticos', async () => {
    const a = (await parsePDVExcelFile(pdvFile())).extractAllPurchases().purchases.map(p => p.id);
    const b = (await parsePDVExcelFile(pdvFile())).extractAllPurchases().purchases.map(p => p.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe('pdv_store-01_1001_20260115');
  });

  it('compras importadas alimentam a janela RFM de 90 dias corretamente', async () => {
    const { purchases } = (await parsePDVExcelFile(pdvFile())).extractAllPurchases();
    const ref = new Date('2026-04-10T12:00:00.000Z');
    const m = computeRFMWindowMetrics(purchases, 90, ref);
    // 15/01 (85 dias) e 20/03 dentro da janela
    expect(m.rfmFrequency).toBe(2);
    expect(m.rfmMonetary).toBe(90.24);
    const later = computeRFMWindowMetrics(purchases, 90, new Date('2026-05-01T12:00:00.000Z'));
    // 15/01 sai da janela, mas continua no histórico
    expect(later.rfmFrequency).toBe(1);
    expect(later.rfmMonetary).toBe(29.94);
    expect(later.totalPurchases).toBe(2);
    expect(later.totalSpent).toBe(90.24);
  });

  // Pendência da rodada 1 (célula de data do Excel lida como m/d/aa) coberta em importIntegrity.test.ts
});

describe('pdvParser + importPurchasesBatch - idempotência', () => {
  beforeEach(() => {
    (mem.store as MemStore).clear();
    vi.resetModules();
  });

  const user = { id: 'u1', name: 'Tester', email: 't@exemplo.test', role: 'admin' } as any;

  it('importar a mesma planilha duas vezes não duplica compras', async () => {
    const svc1 = await import('../src/services/firestoreService');
    const p1 = (await parsePDVExcelFile(pdvFile())).extractAllPurchases().purchases;
    const r1 = await svc1.importPurchasesBatch(p1, user, true);
    expect(r1.persistedCount).toBe(2);
    expect(r1.duplicatesCount).toBe(0);
    expect((mem.store as MemStore).get('purchases')!.size).toBe(2);

    // Novo módulo (sem cache em memória) -> lê do "Firestore"
    vi.resetModules();
    const svc2 = await import('../src/services/firestoreService');
    const p2 = (await parsePDVExcelFile(pdvFile())).extractAllPurchases().purchases;
    const r2 = await svc2.importPurchasesBatch(p2, user, true);
    expect(r2.persistedCount).toBe(0);
    expect(r2.duplicatesCount).toBe(2);
    expect((mem.store as MemStore).get('purchases')!.size).toBe(2);
  });

  it('só cria cliente automaticamente para CPF válido, sem consentimento de marketing', async () => {
    const svc = await import('../src/services/firestoreService');
    const p = (await parsePDVExcelFile(pdvFile())).extractAllPurchases().purchases;
    const r = await svc.importPurchasesBatch(p, user, true);
    expect(r.newCustomersCount).toBe(1);
    const customers = Array.from((mem.store as MemStore).get('customers')!.values());
    expect(customers).toHaveLength(1);
    expect(customers[0].cpf).toBe('529.982.247-25');
    expect(customers[0].consent.whatsappMarketing).toBe(false);
    expect(customers[0].totalPurchases).toBe(1);
  });
});
