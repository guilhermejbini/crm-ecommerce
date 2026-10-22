import { describe, it, expect } from 'vitest';
import {
  REAL_SUPER_ASTRAL_STORES,
  resolveStoreId,
  getRecordStoreId,
  recordBelongsToStore,
  alignStoresWithPhysicalIdentity,
  getStoreCoords,
  getStoreLabel,
  SITE_FORM_STORE_CODES
} from '../src/services/storeAndLocationData';
import { getPDVImportBlockReason } from '../src/services/pdvParser';
// @ts-ignore - script Node em JS puro
import { physicalStoreFromText } from '../scripts/fix-store-ids.mjs';

describe('Identificação das lojas', () => {
  it('store-01 = Astral Rodovia dos Minérios (Paulo Bini, 250); store-02 = Astral Centro (Emílio Johnson, 675); store-03 = Astral Bertolina (endereço mantido)', () => {
    const byId = Object.fromEntries(REAL_SUPER_ASTRAL_STORES.map(s => [s.id, s]));
    expect(byId['store-01']).toMatchObject({ code: 'LJ01', name: 'Astral Rodovia dos Minérios', address: 'Travessa Paulo Bini, 250' });
    expect(byId['store-02']).toMatchObject({ code: 'LJ02', name: 'Astral Centro', address: 'Avenida Emílio Johnson, 675' });
    expect(byId['store-03']).toMatchObject({ code: 'LJ03', name: 'Astral Bertolina', address: 'Rua Bertolina Kendrick de Oliveira', cep: '83501-150', latitude: -25.3111413 });
    // coordenadas acompanham a loja física
    expect(getStoreCoords(byId['store-01'])).toEqual([-25.3163582, -49.3008606]);
    expect(getStoreCoords(byId['store-02'])).toEqual([-25.3115083, -49.298475]);
    expect(getStoreCoords({ id: 'store-02', code: 'LJ02' })).toEqual([-25.3115083, -49.298475]);
  });

  it('matriz é a Loja 01 (Travessa Paulo Bini); códigos do formulário do site seguem a ordem do site', () => {
    expect(resolveStoreId('matriz')).toBe('store-01');
    expect(resolveStoreId('Matriz - Almirante Tamandaré')).toBe('store-01');
    expect(resolveStoreId('bertolina')).toBe('store-03');
    // o código do formulário "paulo-bini" não é lido como endereço (ele é a Loja 02 no site)
    expect(resolveStoreId('paulo-bini')).toBeNull();
    expect(SITE_FORM_STORE_CODES).toEqual({ matriz: 'store-01', 'paulo-bini': 'store-02', bertolina: 'store-03' });
  });

  it('código numérico só é usado quando explicitamente permitido', () => {
    expect(resolveStoreId('LJ01')).toBeNull();
    expect(resolveStoreId('LJ01', { allowNumericCodes: true })).toBe('store-01');
    expect(resolveStoreId('Loja 02', { allowNumericCodes: true })).toBe('store-02');
    expect(resolveStoreId('Loja 04', { allowNumericCodes: true })).toBeNull();
  });

  it('registros antigos (ID invertido, nome da loja física) são atribuídos à loja física', () => {
    // compra gravada antes da correção: store-01 com nome da Emílio Johnson
    expect(getRecordStoreId('store-01', 'Super Astral - Av. Emílio Johnson, 675')).toBe('store-02');
    expect(getRecordStoreId('store-02', 'Super Astral - Travessa Paulo Bini, 250')).toBe('store-01');
    // registros novos
    expect(getRecordStoreId('store-01', getStoreLabel('store-01'))).toBe('store-01');
    // sem nome físico: mantém o ID gravado; nome só numérico não é confiável
    expect(getRecordStoreId('store-03', undefined)).toBe('store-03');
    expect(getRecordStoreId('store-01', 'Super Astral Loja 01')).toBe('store-01');
    expect(getRecordStoreId(undefined, undefined)).toBeNull();

    expect(recordBelongsToStore('store-02', 'store-01', 'Super Astral - Av. Emílio Johnson')).toBe(true);
    expect(recordBelongsToStore('store-01', 'store-01', 'Super Astral - Av. Emílio Johnson')).toBe(false);
    expect(recordBelongsToStore('all', undefined, undefined)).toBe(true);
  });

  it('cadastro de lojas ainda não migrado é exibido sob a loja física (sem gravar)', () => {
    const oldDocs = [
      { ...REAL_SUPER_ASTRAL_STORES[1], id: 'store-01', code: 'LJ01', name: 'Super Astral - Av. Emílio Johnson', address: 'Av. Emílio Johnson, 675' },
      { ...REAL_SUPER_ASTRAL_STORES[0], id: 'store-02', code: 'LJ02', name: 'Super Astral - Travessa Paulo Bini', address: 'Travessa Paulo Bini, 250' },
      { ...REAL_SUPER_ASTRAL_STORES[2], name: 'Super Astral Bertolina' }
    ];
    const aligned = alignStoresWithPhysicalIdentity(oldDocs);
    expect(aligned.map(s => [s.id, s.code, s.name])).toEqual([
      ['store-01', 'LJ01', 'Astral Rodovia dos Minérios'],
      ['store-02', 'LJ02', 'Astral Centro'],
      ['store-03', 'LJ03', 'Astral Bertolina']
    ]);
    // dados físicos (coordenadas) seguem a loja
    expect(aligned[0].latitude).toBe(-25.3163582);
    // Bertolina: nome atualizado, endereço mantido
    expect(aligned[2].address).toBe('Rua Bertolina Kendrick de Oliveira');
    // cadastro já correto não muda
    expect(alignStoresWithPhysicalIdentity(REAL_SUPER_ASTRAL_STORES)).toEqual(REAL_SUPER_ASTRAL_STORES);
  });

  it('regras do front e da migração identificam as mesmas lojas', () => {
    const samples = [
      'Travessa Paulo Bini, 250', 'paulo-bini', 'Astral Rodovia dos Minérios', 'Super Astral - Travessa Paulo Bini',
      'Av. Emílio Johnson, 675', 'Avenida Emilio Johnson', 'Astral Centro', 'matriz', 'Super Astral - Av. Emílio Johnson, 675',
      'Super Astral Bertolina', 'Astral Bertolina', 'Rua Bertolina Kendrick de Oliveira, 1025', 'bertolina',
      'Super Astral Loja 01', 'Paulo Bini / Emílio', '', 'Filial Centro', 'Centro'
    ];
    for (const s of samples) {
      expect(physicalStoreFromText(s)).toBe(resolveStoreId(s, { allowNumericCodes: false }) ?? null);
    }
  });
});

describe('Importação PDV - lojas não reconhecidas', () => {
  const sr = (values: string[], count = values.length || 1) =>
    ({ storeResolution: { storeColumnFound: true, unresolvedReceiptsCount: count, unrecognizedValues: values } });

  it('uma loja não reconhecida pode ser escolhida manualmente', () => {
    expect(getPDVImportBlockReason(sr(['Loja 01']), null)).toContain('Loja 01');
    expect(getPDVImportBlockReason(sr(['Loja 01']), { id: 'store-01', name: 'x' })).toBeNull();
  });

  it('mais de uma loja não reconhecida bloqueia mesmo com escolha manual (um arquivo por loja)', () => {
    const reason = getPDVImportBlockReason(sr(['Loja 01', 'Loja 02']), { id: 'store-01', name: 'x' });
    expect(reason).toMatch(/mais de uma loja/i);
  });
});
