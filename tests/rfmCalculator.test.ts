import { describe, it, expect } from 'vitest';
import {
  RFM_WINDOW_DAYS,
  RFM_THRESHOLDS_PENDING_CALIBRATION,
  DEFAULT_RFM_CONFIG,
  getRFMWindowDays,
  computeRFMWindowMetrics,
  calculateCustomerRFM,
  determineRFMSegment
} from '../src/services/rfmCalculator';

const REF = new Date('2026-06-30T12:00:00.000Z');
const DAY = 86400000;
const daysAgo = (n: number) => new Date(REF.getTime() - n * DAY).toISOString();

describe('rfmCalculator - configuração atual', () => {
  it('janela padrão é 90 dias e thresholds seguem pendentes de calibração', () => {
    expect(RFM_WINDOW_DAYS).toBe(90);
    expect(getRFMWindowDays()).toBe(90);
    expect(getRFMWindowDays(DEFAULT_RFM_CONFIG)).toBe(90);
    expect(RFM_THRESHOLDS_PENDING_CALIBRATION).toBe(true);
  });

  it('thresholds atuais não foram alterados', () => {
    expect(DEFAULT_RFM_CONFIG.recencyDaysThresholds).toEqual([15, 30, 60, 90]);
    expect(DEFAULT_RFM_CONFIG.frequencyThresholds).toEqual([2, 5, 10, 20]);
    expect(DEFAULT_RFM_CONFIG.monetaryThresholds).toEqual([200, 600, 1500, 3500]);
  });
});

describe('rfmCalculator - computeRFMWindowMetrics', () => {
  it('cliente sem compras', () => {
    const m = computeRFMWindowMetrics([], 90, REF);
    expect(m).toEqual({ rfmFrequency: 0, rfmMonetary: 0, daysSinceLastPurchase: -1, totalPurchases: 0, totalSpent: 0 });
  });

  it('compras fora da janela não entram em F/M, mas entram nos totais históricos', () => {
    const m = computeRFMWindowMetrics(
      [
        { purchaseDate: daysAgo(10), netAmount: 100 },
        { purchaseDate: daysAgo(89), netAmount: 50 },
        { purchaseDate: daysAgo(91), netAmount: 1000 },
        { purchaseDate: daysAgo(400), netAmount: 2000 }
      ],
      90,
      REF
    );
    expect(m.rfmFrequency).toBe(2);
    expect(m.rfmMonetary).toBe(150);
    expect(m.totalPurchases).toBe(4);
    expect(m.totalSpent).toBe(3150);
    expect(m.lastPurchaseDate).toBe(daysAgo(10));
    expect(m.daysSinceLastPurchase).toBe(10);
  });

  it('lastPurchaseDate é a última compra histórica mesmo fora da janela', () => {
    const m = computeRFMWindowMetrics(
      [
        { purchaseDate: daysAgo(200), netAmount: 10 },
        { purchaseDate: daysAgo(120), netAmount: 20 }
      ],
      90,
      REF
    );
    expect(m.rfmFrequency).toBe(0);
    expect(m.rfmMonetary).toBe(0);
    expect(m.totalPurchases).toBe(2);
    expect(m.totalSpent).toBe(30);
    expect(m.lastPurchaseDate).toBe(daysAgo(120));
    expect(m.daysSinceLastPurchase).toBe(120);
  });

  it('compra com data futura (> 24h) é ignorada; data inválida também', () => {
    const m = computeRFMWindowMetrics(
      [
        { purchaseDate: new Date(REF.getTime() + 3 * DAY).toISOString(), netAmount: 999 },
        { purchaseDate: 'data-invalida', netAmount: 999 },
        { netAmount: 999 },
        { purchaseDate: daysAgo(5), netAmount: 40 }
      ],
      90,
      REF
    );
    expect(m.totalPurchases).toBe(1);
    expect(m.totalSpent).toBe(40);
    expect(m.rfmFrequency).toBe(1);
    expect(m.rfmMonetary).toBe(40);
  });

  it('usa netAmount, com fallback para totalAmount, e ignora valores negativos', () => {
    const m = computeRFMWindowMetrics(
      [
        { purchaseDate: daysAgo(1), totalAmount: 30 },
        { purchaseDate: daysAgo(2), netAmount: -10, totalAmount: 50 }
      ],
      90,
      REF
    );
    expect(m.totalSpent).toBe(30);
    expect(m.rfmMonetary).toBe(30);
  });
});

describe('rfmCalculator - calculateCustomerRFM', () => {
  it('cliente sem compras -> UNCLASSIFIED', () => {
    const r = calculateCustomerRFM({ totalPurchases: 0, totalSpent: 0 });
    expect(r.rfmSegment).toBe('UNCLASSIFIED');
    expect(r.rfmScoreCode).toBe('000');
    expect(r.rfmWindowDays).toBe(90);
  });

  it('data de última compra inválida ou futura -> UNCLASSIFIED', () => {
    expect(calculateCustomerRFM({ totalPurchases: 3, totalSpent: 100, lastPurchaseDate: 'xx' }).rfmSegment).toBe('UNCLASSIFIED');
    const future = new Date(Date.now() + 5 * DAY).toISOString();
    expect(calculateCustomerRFM({ totalPurchases: 3, totalSpent: 100, lastPurchaseDate: future }).rfmSegment).toBe('UNCLASSIFIED');
  });

  it('cliente com histórico mas sem compra recente não vira UNCLASSIFIED', () => {
    const r = calculateCustomerRFM({
      totalPurchases: 12,
      totalSpent: 3000,
      daysSinceLastPurchase: 120,
      rfmFrequency: 0,
      rfmMonetary: 0
    });
    expect(r.rfmSegment).toBe('PERDIDOS');
    expect(r.recencyScore).toBe(1);
    expect(r.frequencyScore).toBe(0);
    expect(r.monetaryScore).toBe(0);
  });

  it('F e M usam a janela (rfmFrequency/rfmMonetary), não os totais históricos', () => {
    const r = calculateCustomerRFM({
      totalPurchases: 50,
      totalSpent: 10000,
      daysSinceLastPurchase: 5,
      rfmFrequency: 1,
      rfmMonetary: 100
    });
    expect(r.frequencyScore).toBe(1);
    expect(r.monetaryScore).toBe(1);
    expect(r.rfmFrequency).toBe(1);
    expect(r.rfmMonetary).toBe(100);
    expect(r.rfmSegment).toBe('NOVOS');
  });

  it('sem F/M de janela informados: usa totais apenas se a última compra está dentro da janela', () => {
    const inside = calculateCustomerRFM({ totalPurchases: 5, totalSpent: 600, daysSinceLastPurchase: 45 });
    expect(inside.rfmFrequency).toBe(5);
    expect(inside.rfmMonetary).toBe(600);
    const outside = calculateCustomerRFM({ totalPurchases: 5, totalSpent: 600, daysSinceLastPurchase: 91 });
    expect(outside.rfmFrequency).toBe(0);
    expect(outside.rfmMonetary).toBe(0);
    expect(outside.rfmSegment).toBe('PERDIDOS');
  });

  it('integração: compras históricas -> métricas de janela -> segmento', () => {
    const w = computeRFMWindowMetrics(
      [
        { purchaseDate: daysAgo(3), netAmount: 100 },
        { purchaseDate: daysAgo(300), netAmount: 5000 }
      ],
      90,
      REF
    );
    const r = calculateCustomerRFM({ ...w });
    expect(r.rfmFrequency).toBe(1);
    expect(r.rfmMonetary).toBe(100);
    expect(r.rfmSegment).toBe('NOVOS');
    expect(w.totalSpent).toBe(5100);
  });
});

describe('rfmCalculator - segmentação atual preservada', () => {
  const cases: Array<[number, number, number, string]> = [
    [5, 5, 5, 'CAMPEÕES'],
    [4, 4, 4, 'CAMPEÕES'],
    [3, 3, 3, 'LEAIS'],
    [2, 3, 1, 'EM RISCO'],
    [2, 1, 3, 'EM RISCO'],
    [5, 1, 1, 'NOVOS'],
    [4, 1, 1, 'PROMISSORES'],
    [5, 2, 1, 'POTENCIAIS LEAIS'],
    [3, 2, 1, 'PRECISAM DE ATENÇÃO'],
    [2, 2, 1, 'PRESTES A DORMIR'],
    [2, 1, 1, 'HIBERNANDO'],
    [3, 1, 1, 'HIBERNANDO'],
    [3, 0, 0, 'HIBERNANDO'],
    [1, 5, 5, 'PERDIDOS'],
    [1, 0, 0, 'PERDIDOS'],
    [0, 5, 5, 'UNCLASSIFIED']
  ];

  it.each(cases)('R=%i F=%i M=%i -> %s', (r, f, m, expected) => {
    expect(determineRFMSegment(r, f, m)).toBe(expected);
  });

  it('sem histórico -> UNCLASSIFIED', () => {
    expect(determineRFMSegment(5, 5, 5, false)).toBe('UNCLASSIFIED');
  });
});
