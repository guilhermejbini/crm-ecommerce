import { describe, it, expect } from 'vitest';
import { parseFlexExcelFile, normalizeDocument, normalizeDate, normalizePhone } from '../src/services/flexCustomerParser';
import { buildXlsx } from './helpers';

// Dados 100% artificiais (CPFs sintéticos válidos gerados para teste)
const HEADER = ['Código', 'Nome Do Cliente', 'CNPJ / CPF', 'F/J', 'Fone Residencial', 'Fone Celular', 'E-mail', 'Data de Nascimento', 'Bairro End. Resid.'];

function flexSheet(dataRows: any[][], extraHeader: string[] = []) {
  const preamble = Array.from({ length: 12 }, (_, i) => [`Relatório de Clientes - linha ${i + 1}`]);
  return buildXlsx([...preamble, [...HEADER, ...extraHeader], ...dataRows]);
}

const ROWS = [
  ['C1', 'Maria Teste', 1234567890, 'F', '4136571234', '41987654321', 'MARIA@EXEMPLO.TEST', 32874, 'Centro'],
  ['C2', 'Joao Teste', '529.982.247-25', 'F', '', '', '', '15/03/1985', 'Centro'],
  ['C3', 'Sem Documento', '', 'F', '41987650000', '', '', '', 'Centro'],
  ['C4', 'Documento Invalido', '529.982.247-24', 'F', '', '41987654321', '', '', 'Centro'],
  ['C5', '', '11144477735', 'F', '', '', '', '', ''],
  ['C6', 'Joao Teste Duplicado', '52998224725', 'F', '', '', '', '15/03/1985', 'Centro']
];

describe('flexCustomerParser - parseFlexExcelFile', () => {
  it('detecta o cabeçalho na linha 13', () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    expect(r.sheetName).toBe('Plan1');
    expect(r.headerRowNumber).toBe(13);
    expect(r.dataStartRowNumber).toBe(14);
    expect(r.mappedFieldSummary['Nome do Cliente']).toBe('Nome Do Cliente');
    expect(r.mappedFieldSummary['CPF / CNPJ']).toBe('CNPJ / CPF');
  });

  it('falha de forma explícita quando não há cabeçalho reconhecível', () => {
    expect(() => parseFlexExcelFile(buildXlsx([['a', 'b'], ['c', 'd']]))).toThrow(/cabeçalho/);
  });

  it('CPF vira string formatada, recuperando zero à esquerda perdido pelo Excel', async () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    const { customers } = await r.extractAllCustomers([]);
    const maria = customers.find(c => c.code === 'C1')!;
    expect(typeof maria.cpf).toBe('string');
    expect(maria.cpf).toBe('012.345.678-90');
    expect(maria.id).toBe('cust-flex-01234567890');
  });

  it('telefone não vira CPF', async () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    const { customers } = await r.extractAllCustomers([]);
    const semDoc = customers.find(c => c.code === 'C3')!;
    expect(semDoc.cpf).toBe('');
    expect(semDoc.phone).toBe('(41) 98765-0000');
    expect(semDoc.id).toBe('cust-flex-cod-C3');
  });

  it('converte data serial do Excel e data BR em texto', async () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    const { customers } = await r.extractAllCustomers([]);
    expect(customers.find(c => c.code === 'C1')!.birthDate).toBe('1990-01-01');
    expect(customers.find(c => c.cpf === '529.982.247-25')!.birthDate).toBe('1985-03-15');
  });

  it('consentimento WhatsApp NÃO é true só porque existe número', async () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    const { customers } = await r.extractAllCustomers([]);
    const maria = customers.find(c => c.code === 'C1')!;
    expect(maria.whatsapp).toBe('(41) 98765-4321');
    expect(maria.consent?.whatsappMarketing).toBe(false);
    expect(maria.consent?.whatsappConsentDate).toBeUndefined();
    customers.forEach(c => expect(c.consent?.whatsappMarketing).toBe(false));
  });

  it('coluna explícita de opt-in controla o consentimento', async () => {
    const r = parseFlexExcelFile(flexSheet(
      [
        ['C1', 'Com Optin', '52998224725', 'F', '', '41987654321', '', '', '', 'Sim'],
        ['C2', 'Sem Optin', '11144477735', 'F', '', '41987654322', '', '', '', 'Não']
      ],
      ['Autoriza WhatsApp']
    ));
    const { customers } = await r.extractAllCustomers([]);
    expect(customers.find(c => c.code === 'C1')!.consent?.whatsappMarketing).toBe(true);
    expect(customers.find(c => c.code === 'C2')!.consent?.whatsappMarketing).toBe(false);
  });

  it('linhas inválidas geram erro com número da linha e não produzem clientes fictícios', async () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    const { customers, errors, duplicateCount } = await r.extractAllCustomers([]);

    expect(errors).toHaveLength(2);
    const invalidDoc = errors.find(e => e.clientName === 'Documento Invalido')!;
    expect(invalidDoc.rowNumber).toBe(17);
    expect(invalidDoc.cpfRaw).toBe('529.982.247-24');
    const noName = errors.find(e => e.reason.includes('sem Nome'))!;
    expect(noName.rowNumber).toBe(18);

    expect(customers.some(c => c.name === 'Documento Invalido')).toBe(false);
    expect(customers.some(c => c.cpf === '111.444.777-35')).toBe(false);
    // Nunca inventa telefone padrão
    customers.forEach(c => {
      expect(c.whatsapp).not.toBe('(41) 99999-9999');
      expect(c.latitude).toBeUndefined();
      expect(c.longitude).toBeUndefined();
    });
    const semDoc = customers.find(c => c.code === 'C3')!;
    expect(semDoc.email).toBe('');
    expect(semDoc.birthDate).toBe('');

    // C2 e C6 têm o mesmo CPF -> 1 cliente, 1 duplicado
    expect(duplicateCount).toBe(1);
    expect(customers.filter(c => c.cpf === '529.982.247-25')).toHaveLength(1);
    expect(customers).toHaveLength(3);
  });

  it('reaproveita o id de cliente existente com o mesmo CPF', async () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    const existing = [{ id: 'cust-existente', cpf: '529.982.247-25', name: 'Antigo' } as any];
    const { customers, updatedCustomers } = await r.extractAllCustomers(existing);
    const joao = customers.find(c => c.cpf === '529.982.247-25')!;
    expect(joao.id).toBe('cust-existente');
    expect(updatedCustomers.some(c => c.id === 'cust-existente')).toBe(true);
  });

  it('#6 reimportar não reativa clube desativado nem transforma recência 0 em 999', async () => {
    const r = parseFlexExcelFile(flexSheet(ROWS));
    const existing = [{ id: 'cust-existente', cpf: '529.982.247-25', name: 'Antigo', isClubMember: false, daysSinceLastPurchase: 0 } as any];
    const { customers } = await r.extractAllCustomers(existing);
    const joao = customers.find(c => c.cpf === '529.982.247-25')!;
    expect(joao.isClubMember).toBe(false);
    expect(joao.clubJoinedAt).toBeUndefined();
    expect(joao.daysSinceLastPurchase).toBe(0);
    const novo = customers.find(c => c.cpf === '012.345.678-90')!;
    expect(novo.isClubMember).toBe(true);
  });
});

describe('flexCustomerParser - normalizadores', () => {
  it('normalizeDocument', () => {
    expect(normalizeDocument('')).toEqual({ digits: '', formatted: '', type: 'INVALIDO' });
    expect(normalizeDocument(1234567890).formatted).toBe('012.345.678-90');
    expect(normalizeDocument('1.234567890e+09').digits).toBe('01234567890');
    expect(normalizeDocument('52998224724').type).toBe('INVALIDO');
    expect(normalizeDocument('11111111111').type).toBe('INVALIDO');
    expect(normalizeDocument('11.222.333/0001-81')).toMatchObject({ type: 'CNPJ', formatted: '11.222.333/0001-81' });
    expect(normalizeDocument('41987654321').type).toBe('INVALIDO');
  });

  it('normalizeDate', () => {
    expect(normalizeDate(32874)).toBe('1990-01-01');
    expect(normalizeDate('1/2/2000')).toBe('2000-02-01');
    expect(normalizeDate('2000-02-01T00:00:00')).toBe('2000-02-01');
    expect(normalizeDate('texto')).toBe('');
    expect(normalizeDate('')).toBe('');
  });

  it('normalizePhone não inventa números', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('-')).toBe('');
    expect(normalizePhone('41987654321')).toBe('(41) 98765-4321');
    expect(normalizePhone('987654321')).toBe('(41) 98765-4321');
  });
});
