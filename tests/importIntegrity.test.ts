import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { parsePDVExcelFile, parsePDVDate, normalizeStore } from '../src/services/pdvParser';
import { parseFlexExcelFile } from '../src/services/flexCustomerParser';
import { normalizeWhatsappInput } from '../src/utils/customerFormUtils';
import { buildXlsx, buildXlsxWithCells } from './helpers';
import { createFirestoreMock, MemStore } from './firestoreMock';

const mem = vi.hoisted(() => ({ store: new Map() as any }));
vi.mock('firebase/firestore', () => createFirestoreMock(mem.store));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

// Datas "sem horário" são tratadas como meio-dia no horário local (mesma regra das datas em texto)
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
const HEADER = ['Cupom', 'Data', 'CPF', 'Nome', 'Produto', 'Quantidade', 'Valor Total', 'Loja', 'PDV'];

// ===================================================================
// BUG 1 / BUG 2 - datas do PDV
// ===================================================================
describe('PDV - datas (parsePDVDate)', () => {
  it('A. string BR DD/MM/AAAA não é lida como MM/DD', () => {
    expect(parsePDVDate('15/01/2025')).toEqual({ ok: true, iso: localNoon(2025, 1, 15), hasTime: false });
    expect(parsePDVDate('31/12/2025')).toEqual({ ok: true, iso: localNoon(2025, 12, 31), hasTime: false });
    expect(parsePDVDate('01/02/2025')).toMatchObject({ ok: true, iso: localNoon(2025, 2, 1) });
  });

  it('A. string BR com horário', () => {
    expect(parsePDVDate('15/01/2025 18:45')).toEqual({ ok: true, iso: new Date(2025, 0, 15, 18, 45, 0).toISOString(), hasTime: true });
    expect(parsePDVDate('15/01/2025 18:45:30')).toMatchObject({ ok: true, iso: new Date(2025, 0, 15, 18, 45, 30).toISOString() });
  });

  it('B. serial Excel vira a data correta (não o ano 45672)', () => {
    expect(parsePDVDate(45672)).toEqual({ ok: true, iso: localNoon(2025, 1, 15), hasTime: false });
    expect(parsePDVDate(46022)).toEqual({ ok: true, iso: localNoon(2025, 12, 31), hasTime: false });
    expect(parsePDVDate(45672.75)).toEqual({ ok: true, iso: new Date(2025, 0, 15, 18, 0, 0).toISOString(), hasTime: true });
  });

  it('ISO válido', () => {
    expect(parsePDVDate('2025-01-15')).toMatchObject({ ok: true, iso: localNoon(2025, 1, 15), hasTime: false });
    expect(parsePDVDate('2025-01-15T08:30:00.000Z')).toEqual({ ok: true, iso: '2025-01-15T08:30:00.000Z', hasTime: true });
    expect(parsePDVDate('2025-01-15 08:30')).toMatchObject({ ok: true, iso: new Date(2025, 0, 15, 8, 30).toISOString(), hasTime: true });
  });

  it('Date nativo', () => {
    expect(parsePDVDate(new Date(2025, 0, 15, 12))).toMatchObject({ ok: true, iso: localNoon(2025, 1, 15) });
  });

  it('C. data impossível é rejeitada', () => {
    expect(parsePDVDate('31/02/2025').ok).toBe(false);
    expect(parsePDVDate('15/13/2025').ok).toBe(false);
    expect(parsePDVDate('1/15/25').ok).toBe(false); // formato americano não é assumido
    expect(parsePDVDate('2025-02-30').ok).toBe(false);
    expect(parsePDVDate('15/01/2025 25:00').ok).toBe(false);
    expect(parsePDVDate('ontem').ok).toBe(false);
    expect(parsePDVDate('Jan 15 2025').ok).toBe(false);
    expect(parsePDVDate(-5).ok).toBe(false);
    expect(parsePDVDate(new Date('x')).ok).toBe(false);
  });

  it('D. valor vazio nunca vira data inventada', () => {
    expect(parsePDVDate('')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePDVDate('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePDVDate(null)).toEqual({ ok: false, reason: 'empty' });
    expect(parsePDVDate(undefined)).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('PDV - datas na planilha', () => {
  it('A/B. célula de data real do Excel (formato m/d/yy) é lida corretamente', async () => {
    const buf = buildXlsxWithCells(
      [HEADER, ['1001', '', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1'], ['1002', '', '', '', 'Feijão', '1', '10', 'Astral Rodovia dos Minérios', '1']],
      { B2: { t: 'n', v: 45672, z: 'm/d/yy' }, B3: { t: 'n', v: 46022, z: 'dd/mm/yyyy' } }
    );
    const { purchases, errors } = (await parsePDVExcelFile(buf)).extractAllPurchases();
    expect(errors).toEqual([]);
    expect(purchases.find(p => p.couponReceiptNumber === '1001')!.purchaseDate).toBe(localNoon(2025, 1, 15));
    expect(purchases.find(p => p.couponReceiptNumber === '1002')!.purchaseDate).toBe(localNoon(2025, 12, 31));
  });

  it('B. serial numérico sem formato de data também é interpretado', async () => {
    const buf = buildXlsx([HEADER, ['1001', 45672, '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1']]);
    const { purchases } = (await parsePDVExcelFile(buf)).extractAllPurchases();
    expect(purchases[0].purchaseDate).toBe(localNoon(2025, 1, 15));
  });

  it('D. cupom sem data ou com data inválida vira erro (não compra de hoje)', async () => {
    const buf = buildXlsx([
      HEADER,
      ['2001', '', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1'],
      ['2002', '31/02/2025', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1'],
      ['2003', '10/01/2025', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1']
    ]);
    const { purchases, errors } = (await parsePDVExcelFile(buf)).extractAllPurchases();
    expect(purchases.map(p => p.couponReceiptNumber)).toEqual(['2003']);
    expect(errors).toHaveLength(2);
    expect(errors.find(e => e.receiptNo === '2001')!.reason).toMatch(/data/i);
    expect(errors.find(e => e.receiptNo === '2002')!.reason).toContain('31/02/2025');
    expect(errors.find(e => e.receiptNo === '2001')!.rowNumber).toBe(2);
  });
});

// ===================================================================
// BUG 3 - loja
// ===================================================================
describe('PDV - lojas', () => {
  it('E. lojas identificadas pelo endereço/nome físico (loja 01 = Paulo Bini, loja 02 = Emílio Johnson)', () => {
    expect(normalizeStore('Travessa Paulo Bini, 250')).toEqual({ id: 'store-01', name: 'Astral Rodovia dos Minérios - Travessa Paulo Bini, 250' });
    expect(normalizeStore('Astral Rodovia dos Minérios')?.id).toBe('store-01');
    expect(normalizeStore('Paulo Bini')?.id).toBe('store-01');
    expect(normalizeStore('Av. Emílio Johnson, 675')).toEqual({ id: 'store-02', name: 'Astral Centro - Avenida Emílio Johnson, 675' });
    expect(normalizeStore('Avenida Emilio Johnson')?.id).toBe('store-02');
    expect(normalizeStore('Astral Centro')?.id).toBe('store-02');
    expect(normalizeStore('Centro')).toBeNull(); // bairro, não loja
    expect(normalizeStore('matriz')?.id).toBe('store-01');
    expect(normalizeStore('Super Astral Bertolina')?.id).toBe('store-03');
    expect(normalizeStore('bertolina')?.id).toBe('store-03');
    expect(normalizeStore('store-02')?.id).toBe('store-02');
  });

  it('E. código só numérico do RP Flex não é atribuído enquanto a numeração não for conferida', () => {
    expect(normalizeStore('Loja 01')).toBeNull();
    expect(normalizeStore('LJ02')).toBeNull();
    expect(normalizeStore('Loja 3')).toBeNull();
    // endereço tem prioridade sobre número divergente no mesmo texto
    expect(normalizeStore('Loja 01 - Av. Emílio Johnson, 675')?.id).toBe('store-02');
    // texto que aponta para duas lojas não é atribuído
    expect(normalizeStore('Paulo Bini / Emílio Johnson')).toBeNull();
  });

  it('F. loja desconhecida não vira store-01', () => {
    expect(normalizeStore('store-04')).toBeNull();
    expect(normalizeStore('Loja 04')).toBeNull();
    expect(normalizeStore('04')).toBeNull();
    expect(normalizeStore('Loja 14')).toBeNull();
    expect(normalizeStore('Filial Centro')).toBeNull();
    expect(normalizeStore('')).toBeNull();
    expect(normalizeStore(undefined)).toBeNull();
  });

  it('F. na planilha, loja desconhecida vira erro informando o valor recebido', async () => {
    const buf = buildXlsx([
      HEADER,
      ['3001', '10/01/2025', '', '', 'Arroz', '1', '10', 'store-04', '1'],
      ['3002', '10/01/2025', '', '', 'Arroz', '1', '10', 'Astral Centro', '1']
    ]);
    const { purchases, errors } = (await parsePDVExcelFile(buf)).extractAllPurchases();
    expect(purchases.map(p => [p.couponReceiptNumber, p.storeId])).toEqual([['3002', 'store-02']]);
    expect(errors).toHaveLength(1);
    expect(errors[0].receiptNo).toBe('3001');
    expect(errors[0].reason).toContain('store-04');
    expect(purchases.some(p => p.storeId === 'store-01')).toBe(false);
  });
});

// ===================================================================
// BUG 4 - WhatsApp fictício
// ===================================================================
describe('Cadastro manual - WhatsApp', () => {
  it('G. WhatsApp vazio não cria número fictício', () => {
    expect(normalizeWhatsappInput('')).toBe('');
    expect(normalizeWhatsappInput('   ')).toBe('');
    expect(normalizeWhatsappInput(' (41) 98765-4321 ')).toBe('(41) 98765-4321');
    const src = readFileSync('src/components/Customers/CustomerModal.tsx', 'utf8');
    expect(src).not.toMatch(/whatsapp:[^\n]*\|\|\s*'\(\d{2}\)/);
  });

  it('H. WhatsApp vazio + consent=true continua inelegível', async () => {
    const { isCustomerEligibleForWhatsAppCampaign } = await import('../src/services/firestoreService');
    const c: any = { id: 'x', name: 'X', whatsapp: normalizeWhatsappInput(''), consent: { whatsappMarketing: true } };
    expect(isCustomerEligibleForWhatsAppCampaign(c)).toBe(false);
  });
});

// ===================================================================
// BUG 5 - CPF em linha posterior do cupom
// ===================================================================
describe('PDV - CPF nas linhas do cupom', () => {
  it('I. CPF válido em linha posterior é validado e formatado', async () => {
    const buf = buildXlsx([
      HEADER,
      ['4001', '10/01/2025', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1'],
      ['4001', '10/01/2025', '52998224725', 'Cliente', 'Feijão', '1', '10', 'Astral Rodovia dos Minérios', '1']
    ]);
    const { purchases } = (await parsePDVExcelFile(buf)).extractAllPurchases();
    expect(purchases[0].customerCpf).toBe('529.982.247-25');
  });

  it('J. CPF inválido em linha posterior não é aceito', async () => {
    const buf = buildXlsx([
      HEADER,
      ['4002', '10/01/2025', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1'],
      ['4002', '10/01/2025', '12345678900', 'Cliente', 'Feijão', '1', '10', 'Astral Rodovia dos Minérios', '1'],
      ['4002', '10/01/2025', 'abc', 'Cliente', 'Leite', '1', '10', 'Astral Rodovia dos Minérios', '1']
    ]);
    const { purchases } = (await parsePDVExcelFile(buf)).extractAllPurchases();
    expect(purchases[0].customerCpf).toBe('');
  });

  it('J. compra com CPF inválido não é associada a cliente', async () => {
    (mem.store as MemStore).clear();
    vi.resetModules();
    const svc = await import('../src/services/firestoreService');
    const buf = buildXlsx([
      HEADER,
      ['4003', '10/01/2025', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', '1'],
      ['4003', '10/01/2025', '12345678900', 'Cliente', 'Feijão', '1', '10', 'Astral Rodovia dos Minérios', '1']
    ]);
    const { purchases } = (await parsePDVExcelFile(buf)).extractAllPurchases();
    const r = await svc.importPurchasesBatch(purchases, { id: 'u', name: 'T', email: 't@x', role: 'admin' } as any, true);
    expect(r.persistedCount).toBe(1);
    expect(r.newCustomersCount).toBe(0);
    expect(Array.from((mem.store as MemStore).get('purchases')!.values())[0].customerId).toBe('');
  });
});

// ===================================================================
// BUG 6 - cupom sem número
// ===================================================================
describe('PDV - cupom sem número', () => {
  const rowsA = [
    ['', '10/01/2025 09:15:00', '52998224725', 'Cliente', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', 'PDV 03'],
    ['', '10/01/2025 09:15:00', '52998224725', 'Cliente', 'Feijão', '1', '5', 'Astral Rodovia dos Minérios', 'PDV 03'],
    ['', '11/01/2025 17:40:00', '', '', 'Leite', '2', '8', 'Astral Centro', 'PDV 01']
  ];
  const other = ['5001', '12/01/2025', '', '', 'Pão', '1', '3', 'Astral Rodovia dos Minérios', '1'];

  it('K. ID não depende da posição da linha', async () => {
    const a = (await parsePDVExcelFile(buildXlsx([HEADER, ...rowsA, other]))).extractAllPurchases();
    const b = (await parsePDVExcelFile(buildXlsx([HEADER, other, rowsA[2], rowsA[1], rowsA[0]]))).extractAllPurchases();
    expect(a.errors).toEqual([]);
    const ids = (r: any) => r.purchases.map((p: any) => p.id).sort();
    expect(ids(a)).toEqual(ids(b));
    expect(a.purchases).toHaveLength(3);
    // Itens da mesma transação (mesma loja, data/hora, PDV e CPF) formam um único cupom
    const withCpf = a.purchases.find((p: any) => p.customerCpf === '529.982.247-25')!;
    expect(withCpf.items).toHaveLength(2);
    expect(withCpf.totalAmount).toBe(15);
    a.purchases.forEach((p: any) => {
      expect(p.id).not.toMatch(/_CF-\d+_|_R\d+_/);
      expect(p.couponReceiptNumber).not.toMatch(/^CF-/);
    });
  });

  it('K. sem dados suficientes (sem horário, ou sem PDV e sem CPF) vira erro, não ID inventado', async () => {
    const { purchases, errors } = (await parsePDVExcelFile(buildXlsx([
      HEADER,
      ['', '10/01/2025', '52998224725', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', 'PDV 03'],
      ['', '10/01/2025 09:15', '', '', 'Arroz', '1', '10', 'Astral Rodovia dos Minérios', ''],
      ['', '10/01/2025 09:15', '', '', 'Arroz', '1', '10', 'Loja 99', 'PDV 1']
    ]))).extractAllPurchases();
    expect(purchases).toEqual([]);
    expect(errors.map(e => e.rowNumber)).toEqual([2, 3, 4]);
    errors.forEach(e => expect(e.reason).toMatch(/sem número/i));
  });

  it('L. reimportação de cupons sem número continua idempotente', async () => {
    (mem.store as MemStore).clear();
    vi.resetModules();
    const user = { id: 'u', name: 'T', email: 't@x', role: 'admin' } as any;
    const svc1 = await import('../src/services/firestoreService');
    const r1 = await svc1.importPurchasesBatch((await parsePDVExcelFile(buildXlsx([HEADER, ...rowsA, other]))).extractAllPurchases().purchases, user, true);
    expect(r1.persistedCount).toBe(3);
    vi.resetModules();
    const svc2 = await import('../src/services/firestoreService');
    const r2 = await svc2.importPurchasesBatch((await parsePDVExcelFile(buildXlsx([HEADER, other, rowsA[2], rowsA[1], rowsA[0]]))).extractAllPurchases().purchases, user, true);
    expect(r2.persistedCount).toBe(0);
    expect(r2.duplicatesCount).toBe(3);
    expect((mem.store as MemStore).get('purchases')!.size).toBe(3);
  });

  it('importPurchasesBatch não usa índice como ID para compra sem id e sem número de cupom', async () => {
    (mem.store as MemStore).clear();
    vi.resetModules();
    const svc = await import('../src/services/firestoreService');
    const r = await svc.importPurchasesBatch([
      { id: '', couponReceiptNumber: '', storeId: 'store-01', purchaseDate: '2025-01-10T12:00:00.000Z', totalAmount: 10, netAmount: 10, items: [] } as any
    ], { id: 'u', name: 'T', email: 't@x', role: 'admin' } as any, true);
    expect(r.persistedCount).toBe(0);
    expect(r.errorsList.some(e => /cupom/i.test(e.reason))).toBe(true);
    expect((mem.store as MemStore).get('purchases')?.size ?? 0).toBe(0);
  });
});

// ===================================================================
// BUG 7 - Flex: duplicidade no mesmo arquivo
// ===================================================================
describe('Flex - CPF duplicado no mesmo arquivo', () => {
  const FLEX_HEADER = ['Código', 'Nome Do Cliente', 'CNPJ / CPF', 'Fone Residencial', 'Fone Celular', 'E-mail', 'Data de Nascimento', 'Bairro End. Resid.'];
  const flex = (rows: any[][]) => buildXlsx([...Array.from({ length: 12 }, (_, i) => [`Relatório ${i + 1}`]), FLEX_HEADER, ...rows]);

  it('M. valor vazio da linha posterior não apaga valor válido', async () => {
    const r = parseFlexExcelFile(flex([
      ['C1', 'Maria Teste', '52998224725', '4136571234', '41999999999', 'maria@exemplo.test', '15/03/1985', 'Centro'],
      ['C1', 'Maria Teste', '52998224725', '', '', '', '', '']
    ]));
    const { customers, duplicateCount } = await r.extractAllCustomers([]);
    expect(duplicateCount).toBe(1);
    expect(customers).toHaveLength(1);
    const c = customers[0];
    expect(c.whatsapp).toBe('(41) 99999-9999');
    expect(c.phone).toBe('(41) 3657-1234');
    expect(c.email).toBe('maria@exemplo.test');
    expect(c.birthDate).toBe('1985-03-15');
    expect(c.neighborhood).toBe('Centro');
  });

  it('M. valor não vazio da linha posterior continua prevalecendo (comportamento atual)', async () => {
    const r = parseFlexExcelFile(flex([
      ['C1', 'Maria Teste', '52998224725', '', '', 'antigo@exemplo.test', '', 'Centro'],
      ['C1', 'Maria Teste', '52998224725', '', '', 'novo@exemplo.test', '', 'Jardim']
    ]));
    const { customers } = await r.extractAllCustomers([]);
    expect(customers[0].email).toBe('novo@exemplo.test');
    expect(customers[0].neighborhood).toBe('Jardim');
  });
});

describe('PDV - datas: Date sem horário', () => {
  it('Date à meia-noite local segue a regra de 12:00 local', () => {
    expect(parsePDVDate(new Date(2025, 0, 15))).toEqual({ ok: true, iso: localNoon(2025, 1, 15), hasTime: false });
  });
});
