import { RFMSegmentType, RFMConfig, Customer } from '../types/crm';

export const RFM_WINDOW_DAYS = 90;
export const RFM_THRESHOLDS_PENDING_CALIBRATION = true;

export const DEFAULT_RFM_CONFIG: RFMConfig = {
  recencyDaysThresholds: [15, 30, 60, 90], // <=15: 5, <=30: 4, <=60: 3, <=90: 2, >90: 1
  frequencyThresholds: [2, 5, 10, 20],     // <2: 1, 2-4: 2, 5-9: 3, 10-19: 4, >=20: 5
  monetaryThresholds: [200, 600, 1500, 3500], // <200: 1, 200-599: 2, 600-1499: 3, 1500-3499: 4, >=3500: 5
  periodMonths: 3, // 3 meses = 90 dias
  windowDays: 90
};

export function getRFMWindowDays(config?: RFMConfig): number {
  if (config?.windowDays && config.windowDays > 0) return config.windowDays;
  if (config?.periodMonths && config.periodMonths > 0) return config.periodMonths * 30;
  return RFM_WINDOW_DAYS;
}

export const RFM_SEGMENTS_INFO: Record<RFMSegmentType, {
  name: string;
  badgeColor: string;
  dotColor: string;
  description: string;
  recommendedAction: string;
}> = {
  'CAMPEÕES': {
    name: 'Campeões',
    badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotColor: 'bg-emerald-500',
    description: 'Compram frequentemente, gastam muito e visitaram a loja nos últimos 15 dias.',
    recommendedAction: 'Tratamento VIP, convites exclusivos para degustações e benefícios do Astral Clube.'
  },
  'LEAIS': {
    name: 'Leais',
    badgeColor: 'bg-blue-50 text-blue-800 border-blue-200',
    dotColor: 'bg-blue-500',
    description: 'Clientes assíduos com bom gasto acumulado e visitas consistentes.',
    recommendedAction: 'Cross-sell de novas categorias de maior margem e incentivo ao acúmulo de pontos.'
  },
  'POTENCIAIS LEAIS': {
    name: 'Potenciais Leais',
    badgeColor: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    dotColor: 'bg-cyan-500',
    description: 'Novos clientes de bom ticket ou frequência que podem virar leais.',
    recommendedAction: 'Campanhas de fidelização, pontos em dobro no setor de Hortifruti e Açougue.'
  },
  'PROMISSORES': {
    name: 'Promissores',
    badgeColor: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    dotColor: 'bg-indigo-500',
    description: 'Compradores recentes que demonstram interesse e bom potencial de gasto.',
    recommendedAction: 'Ofertas personalizadas nas categorias que já compraram.'
  },
  'NOVOS': {
    name: 'Novos',
    badgeColor: 'bg-teal-50 text-teal-800 border-teal-200',
    dotColor: 'bg-teal-500',
    description: 'Clientes com primeira compra identificada nos últimos 30 dias.',
    recommendedAction: 'Boas-vindas e incentivo para a 2ª compra com cupom de desconto nos próximos 15 dias.'
  },
  'PRECISAM DE ATENÇÃO': {
    name: 'Precisam de Atenção',
    badgeColor: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    dotColor: 'bg-yellow-500',
    description: 'Frequência e valor acima da média, mas estão começando a espaçar as compras.',
    recommendedAction: 'Notificação com ofertas sazonais e lembretes de reposição de despensa.'
  },
  'EM RISCO': {
    name: 'Em Risco',
    badgeColor: 'bg-amber-50 text-amber-800 border-amber-200',
    dotColor: 'bg-amber-500',
    description: 'Bons compradores que não visitam o supermercado há 31 a 60 dias.',
    recommendedAction: 'Campanha de reconquista no WhatsApp com cupom agressivo no setor favorito.'
  },
  'PRESTES A DORMIR': {
    name: 'Prestes a Dormir',
    badgeColor: 'bg-orange-50 text-orange-800 border-orange-200',
    dotColor: 'bg-orange-500',
    description: 'Recência e frequência baixas. Podem ser perdidos se nada for feito.',
    recommendedAction: 'Oferta de retorno e pesquisa rápida sobre a experiência na loja.'
  },
  'HIBERNANDO': {
    name: 'Hibernando',
    badgeColor: 'bg-purple-50 text-purple-800 border-purple-200',
    dotColor: 'bg-purple-500',
    description: 'Última compra há mais de 60 dias com baixa frequência histórica.',
    recommendedAction: 'Oferta imperdível nos itens de curva A.'
  },
  'PERDIDOS': {
    name: 'Perdidos',
    badgeColor: 'bg-rose-50 text-rose-800 border-rose-200',
    dotColor: 'bg-rose-500',
    description: 'Sem compras há mais de 90 dias.',
    recommendedAction: 'Campanha de reativação com grande benefício ou foco em novos clientes.'
  },
  'UNCLASSIFIED': {
    name: 'Não Classificado',
    badgeColor: 'bg-slate-100 text-slate-700 border-slate-200',
    dotColor: 'bg-slate-400',
    description: 'Clientes sem compras realizadas ou com dados transacionais insuficientes.',
    recommendedAction: 'Incentivar primeira compra através de oferta de boas-vindas no cadastro.'
  }
};

export function calculateRecencyScore(days: number | null | undefined, config: RFMConfig = DEFAULT_RFM_CONFIG): number {
  if (days === null || days === undefined || isNaN(days) || days < 0) {
    return 0; // 0 indica ausência ou invalidade de dados de recência
  }
  const [t1, t2, t3, t4] = config.recencyDaysThresholds;
  if (days <= t1) return 5;
  if (days <= t2) return 4;
  if (days <= t3) return 3;
  if (days <= t4) return 2;
  return 1;
}

export function calculateFrequencyScore(frequency: number | null | undefined, config: RFMConfig = DEFAULT_RFM_CONFIG): number {
  if (frequency === null || frequency === undefined || isNaN(frequency) || frequency <= 0) {
    return 0; // 0 indica ausência de compras (sem frequência)
  }
  const [t1, t2, t3, t4] = config.frequencyThresholds;
  if (frequency >= t4) return 5;
  if (frequency >= t3) return 4;
  if (frequency >= t2) return 3;
  if (frequency >= t1) return 2;
  return 1;
}

export function calculateMonetaryScore(spent: number | null | undefined, config: RFMConfig = DEFAULT_RFM_CONFIG): number {
  if (spent === null || spent === undefined || isNaN(spent) || spent <= 0) {
    return 0; // 0 indica ausência de valor monetário
  }
  const [t1, t2, t3, t4] = config.monetaryThresholds;
  if (spent >= t4) return 5;
  if (spent >= t3) return 4;
  if (spent >= t2) return 3;
  if (spent >= t1) return 2;
  return 1;
}

export function determineRFMSegment(
  r: number, 
  f: number, 
  m: number, 
  hasHistory: boolean = true
): RFMSegmentType {
  // Cliente sem histórico ou com recência corrompida/ausente
  if (!hasHistory || r <= 0 || isNaN(r)) {
    return 'UNCLASSIFIED';
  }

  // Se o cliente tem histórico válido mas recência > 90 dias (R = 1),
  // ele é um cliente inativo/perdido (mesmo com 0 compras na janela recente de 90 dias)
  if (r === 1) {
    return 'PERDIDOS';
  }

  // Se possui histórico válido mas nenhuma compra dentro da janela (F=0 ou M=0)
  if (f <= 0 || m <= 0) {
    return 'HIBERNANDO';
  }

  // 1. Campeões: alta recência, alta frequência e alto valor
  if (r >= 4 && f >= 4 && m >= 4) {
    return 'CAMPEÕES';
  }

  // 3. Em Risco: compravam bastante/regularmente, mas recência baixa (31-90 dias)
  if (r <= 2 && (f >= 3 || m >= 3)) {
    return 'EM RISCO';
  }

  // 4. Leais: compras regulares e bom relacionamento
  if (r >= 3 && f >= 3 && m >= 3) {
    return 'LEAIS';
  }

  // 5. Novos Clientes: compraram muito recentemente pela primeira vez (1 compra até 15 dias)
  if (r === 5 && f === 1) {
    return 'NOVOS';
  }

  // 6. Promissores: recência boa, frequência baixa (1 compra entre 16 e 30 dias)
  if (r === 4 && f === 1) {
    return 'PROMISSORES';
  }

  // 7. Potenciais Leais: recentes com bom potencial de repetição
  if (r >= 4 && f >= 2) {
    return 'POTENCIAIS LEAIS';
  }

  // 8. Precisam de Atenção: frequência razoável mas começam a espaçar
  if (r === 3 && (f >= 2 || m >= 2)) {
    return 'PRECISAM DE ATENÇÃO';
  }

  // 9. Prestes a dormir: baixa recência e frequência moderada
  if (r === 2 && f === 2) {
    return 'PRESTES A DORMIR';
  }

  // 10. Hibernando: recência baixa a moderada e frequência/valor também baixos
  if (r <= 2 || (r === 3 && f === 1 && m === 1)) {
    return 'HIBERNANDO';
  }

  // Caso alguma combinação fora do padrão ocorra, nunca retornar segmento comercial por fallback
  return 'UNCLASSIFIED';
}

/**
 * Agrega compras históricas e compras na janela móvel (ex: últimos 90 dias)
 * de forma consistente, idempotente e segura contra anomalias/datas futuras.
 */
export function computeRFMWindowMetrics(
  purchases: Array<{ purchaseDate?: string; netAmount?: number; totalAmount?: number }>,
  windowDays: number = RFM_WINDOW_DAYS,
  referenceDate: Date = new Date()
): {
  rfmFrequency: number;
  rfmMonetary: number;
  lastPurchaseDate?: string;
  daysSinceLastPurchase: number;
  totalPurchases: number;
  totalSpent: number;
} {
  const validPurchases = purchases.filter(p => {
    if (!p.purchaseDate) return false;
    const d = new Date(p.purchaseDate);
    if (isNaN(d.getTime())) return false;
    // Compras com data futura (> 24h de tolerância para fuso horário) são anomalias e ignoradas
    if (d.getTime() > referenceDate.getTime() + 86400000) return false;
    return true;
  });

  const totalPurchases = validPurchases.length;
  const totalSpent = parseFloat(validPurchases.reduce((sum, p) => {
    const val = Number(p.netAmount ?? p.totalAmount ?? 0);
    return sum + (isNaN(val) || val < 0 ? 0 : val);
  }, 0).toFixed(2));

  if (totalPurchases === 0) {
    return {
      rfmFrequency: 0,
      rfmMonetary: 0,
      daysSinceLastPurchase: -1,
      totalPurchases: 0,
      totalSpent: 0
    };
  }

  // Ordenar por data para encontrar a última compra histórica
  const sorted = [...validPurchases].sort((a, b) => new Date(a.purchaseDate!).getTime() - new Date(b.purchaseDate!).getTime());
  const lastPurchaseDate = sorted[sorted.length - 1].purchaseDate;
  const lastDateObj = new Date(lastPurchaseDate!);
  const daysSinceLastPurchase = Math.max(0, Math.floor((referenceDate.getTime() - lastDateObj.getTime()) / (1000 * 60 * 60 * 24)));

  // Filtro de janela móvel (últimos X dias a partir de referenceDate)
  const windowCutoffTime = referenceDate.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const windowPurchases = validPurchases.filter(p => {
    const d = new Date(p.purchaseDate!);
    return d.getTime() >= windowCutoffTime && d.getTime() <= referenceDate.getTime() + 86400000;
  });

  const rfmFrequency = windowPurchases.length;
  const rfmMonetary = parseFloat(windowPurchases.reduce((sum, p) => {
    const val = Number(p.netAmount ?? p.totalAmount ?? 0);
    return sum + (isNaN(val) || val < 0 ? 0 : val);
  }, 0).toFixed(2));

  return {
    rfmFrequency,
    rfmMonetary,
    lastPurchaseDate,
    daysSinceLastPurchase,
    totalPurchases,
    totalSpent
  };
}

/**
 * Motor central de cálculo RFM de um cliente com suporte a Janela Móvel configurável.
 * - Recência: preserva a última compra histórica válida do cliente.
 * - Frequência & Monetary: calculados sobre as compras dentro da janela móvel configurada.
 */
export function calculateCustomerRFM(
  metrics: {
    totalPurchases?: number | null;
    totalSpent?: number | null;
    daysSinceLastPurchase?: number | null;
    lastPurchaseDate?: string | null;
    rfmFrequency?: number | null;
    rfmMonetary?: number | null;
  },
  config: RFMConfig = DEFAULT_RFM_CONFIG
): {
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  rfmScoreCode: string;
  rfmSegment: RFMSegmentType;
  rfmFrequency: number;
  rfmMonetary: number;
  rfmWindowDays: number;
} {
  const windowDays = getRFMWindowDays(config);
  const totalPurchases = metrics.totalPurchases ?? 0;
  const totalSpent = metrics.totalSpent ?? 0;

  // Cliente sem compras ou com dados insuficientes em toda a vida (nunca comprou)
  if (totalPurchases <= 0 || totalSpent <= 0) {
    return {
      recencyScore: 0,
      frequencyScore: 0,
      monetaryScore: 0,
      rfmScoreCode: '000',
      rfmSegment: 'UNCLASSIFIED',
      rfmFrequency: 0,
      rfmMonetary: 0,
      rfmWindowDays: windowDays
    };
  }

  // Validação de Recência histórica
  let days = metrics.daysSinceLastPurchase;
  if (days === undefined || days === null || isNaN(days)) {
    if (metrics.lastPurchaseDate) {
      const dateObj = new Date(metrics.lastPurchaseDate);
      if (isNaN(dateObj.getTime())) {
        days = -1; // Data inválida
      } else {
        const now = new Date();
        // Margem de 1 dia para tolerar pequenas discrepâncias de fuso horário
        if (dateObj.getTime() > now.getTime() + 86400000) {
          days = -1; // Data no futuro (anomalia)
        } else {
          days = Math.max(0, Math.floor((now.getTime() - dateObj.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }
    } else {
      days = -1;
    }
  } else if (days < 0) {
    days = -1;
  }

  // Se days for inválido (-1), não é possível determinar recência
  if (days < 0) {
    return {
      recencyScore: 0,
      frequencyScore: 0,
      monetaryScore: 0,
      rfmScoreCode: '000',
      rfmSegment: 'UNCLASSIFIED',
      rfmFrequency: 0,
      rfmMonetary: 0,
      rfmWindowDays: windowDays
    };
  }

  // Frequência e Valor Monetário da Janela Móvel
  let rfmFreq = metrics.rfmFrequency;
  if (rfmFreq === undefined || rfmFreq === null || isNaN(rfmFreq)) {
    // Se a última compra histórica foi dentro da janela, utiliza totalPurchases, caso contrário 0
    rfmFreq = days <= windowDays ? totalPurchases : 0;
  }
  rfmFreq = Math.max(0, rfmFreq);

  let rfmMon = metrics.rfmMonetary;
  if (rfmMon === undefined || rfmMon === null || isNaN(rfmMon)) {
    rfmMon = days <= windowDays ? totalSpent : 0;
  }
  rfmMon = Math.max(0, rfmMon);

  const r = calculateRecencyScore(days, config);
  const f = calculateFrequencyScore(rfmFreq, config);
  const m = calculateMonetaryScore(rfmMon, config);
  const segment = determineRFMSegment(r, f, m, true);

  return {
    recencyScore: r,
    frequencyScore: f,
    monetaryScore: m,
    rfmScoreCode: `${r}${f}${m}`,
    rfmSegment: segment,
    rfmFrequency: rfmFreq,
    rfmMonetary: rfmMon,
    rfmWindowDays: windowDays
  };
}

export function getRFMSegmentDetails(segment: RFMSegmentType | string) {
  if (segment && RFM_SEGMENTS_INFO[segment as RFMSegmentType]) {
    return RFM_SEGMENTS_INFO[segment as RFMSegmentType];
  }

  return RFM_SEGMENTS_INFO['UNCLASSIFIED'];
}

/** Campos derivados do RFM que a recalculação grava (nada além disso é tocado). */
export const RFM_DERIVED_FIELDS = [
  'totalPurchases', 'totalSpent', 'averageTicket', 'daysSinceLastPurchase', 'lastPurchaseDate',
  'rfmFrequency', 'rfmMonetary', 'rfmWindowDays',
  'recencyScore', 'frequencyScore', 'monetaryScore', 'rfmScoreCode', 'rfmSegment'
] as const;

export type RFMDerivedPatch = Partial<Pick<Customer, typeof RFM_DERIVED_FIELDS[number]>>;

/**
 * Recalcula recência, janela móvel e segmento de todos os clientes para a data de referência.
 * A recência envelhece com o tempo mesmo sem compra nova, por isso precisa rodar todo dia.
 * Retorna só os clientes cujos campos RFM mudaram, com o patch mínimo de cada um.
 * Clientes anonimizados continuam com os valores agregados, mas também envelhecem.
 */
export function recalculateCustomersRFM(
  customers: Customer[],
  purchases: Array<{ customerId?: string; purchaseDate?: string; netAmount?: number; totalAmount?: number }>,
  config: RFMConfig = DEFAULT_RFM_CONFIG,
  now: Date = new Date()
): { updated: Customer[]; changes: { id: string; patch: RFMDerivedPatch }[] } {
  const windowDays = getRFMWindowDays(config);
  const byCustomer = new Map<string, typeof purchases>();
  for (const p of purchases) {
    if (!p.customerId) continue;
    const list = byCustomer.get(p.customerId) || [];
    list.push(p);
    byCustomer.set(p.customerId, list);
  }

  const changes: { id: string; patch: RFMDerivedPatch }[] = [];
  const updated = customers.map(c => {
    const own = byCustomer.get(c.id);
    let totalPurchases = c.totalPurchases ?? 0;
    let totalSpent = c.totalSpent ?? 0;
    let lastPurchaseDate = c.lastPurchaseDate;
    let rfmFrequency = c.rfmFrequency;
    let rfmMonetary = c.rfmMonetary;
    let daysSince: number | undefined;

    if (own && own.length > 0) {
      const wm = computeRFMWindowMetrics(own, windowDays, now);
      totalPurchases = wm.totalPurchases;
      totalSpent = wm.totalSpent;
      lastPurchaseDate = wm.lastPurchaseDate || lastPurchaseDate;
      rfmFrequency = wm.rfmFrequency;
      rfmMonetary = wm.rfmMonetary;
      daysSince = wm.daysSinceLastPurchase;
    } else if (lastPurchaseDate && !isNaN(new Date(lastPurchaseDate).getTime())) {
      // Sem compras carregadas: envelhece a recência a partir da última compra conhecida
      daysSince = Math.max(0, Math.floor((now.getTime() - new Date(lastPurchaseDate).getTime()) / 86400000));
    } else {
      daysSince = c.daysSinceLastPurchase;
    }

    const rfm = calculateCustomerRFM({
      totalPurchases, totalSpent, daysSinceLastPurchase: daysSince, lastPurchaseDate, rfmFrequency, rfmMonetary
    }, config);

    const next: RFMDerivedPatch = {
      totalPurchases,
      totalSpent,
      averageTicket: totalPurchases > 0 ? parseFloat((totalSpent / totalPurchases).toFixed(2)) : 0,
      daysSinceLastPurchase: daysSince,
      lastPurchaseDate,
      rfmFrequency: rfm.rfmFrequency,
      rfmMonetary: rfm.rfmMonetary,
      rfmWindowDays: rfm.rfmWindowDays,
      recencyScore: rfm.recencyScore,
      frequencyScore: rfm.frequencyScore,
      monetaryScore: rfm.monetaryScore,
      rfmScoreCode: rfm.rfmScoreCode,
      rfmSegment: rfm.rfmSegment
    };

    const patch: RFMDerivedPatch = {};
    for (const k of RFM_DERIVED_FIELDS) {
      const v = (next as any)[k];
      if (v !== undefined && v !== (c as any)[k]) (patch as any)[k] = v;
    }
    if (Object.keys(patch).length === 0) return c;
    changes.push({ id: c.id, patch });
    return { ...c, ...patch };
  });

  return { updated, changes };
}
