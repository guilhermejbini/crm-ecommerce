import { Coupon, Customer, NextBestAction, Purchase } from '../types/crm';
import { findUsableCoupon } from '../utils/couponUtils';

/**
 * Gera as próximas melhores ações. O código de cupom de cada regra é só uma sugestão:
 * ele só vai para a ação (e para a mensagem) se existir um cupom ativo e válido com esse código
 * em Cupons. Caso contrário fica em missingCouponCode, para a tela avisar que falta cadastrar.
 */
export function generateNextBestActions(customers: Customer[], purchases: Purchase[] = [], coupons: Coupon[] = []): NextBestAction[] {
  const actions = buildRawNextBestActions(customers, purchases);
  return actions.map(a => {
    if (!a.suggestedCouponCode) return a;
    const coupon = findUsableCoupon(a.suggestedCouponCode, coupons);
    if (coupon) return { ...a, suggestedCouponCode: coupon.code };
    const { suggestedCouponCode, ...rest } = a;
    return { ...rest, missingCouponCode: suggestedCouponCode };
  });
}

/** Mensagem de WhatsApp da ação; só cita cupom quando ele existe e está válido. */
export function buildNBAWhatsAppMessage(action: NextBestAction, long = false): string {
  const firstName = String(action.customerName || '').trim().split(' ')[0];
  const greeting = firstName ? `Olá ${firstName}!` : 'Olá!';
  const coupon = action.suggestedCouponCode
    ? (long ? ` Utilize o cupom ${action.suggestedCouponCode} na sua próxima compra em qualquer uma de nossas lojas!` : ` Use o cupom ${action.suggestedCouponCode}!`)
    : '';
  if (long) {
    return `${greeting} Tudo bem? Aqui é do Super Astral Supermercados. Notamos sua preferência e preparamos um benefício exclusivo para você: ${action.suggestedOffer}.${coupon} Esperamos por você!`;
  }
  return `${greeting} Aqui é do Super Astral. Preparamos uma condição especial: ${action.suggestedOffer}.${coupon}`;
}

function buildRawNextBestActions(customers: Customer[], purchases: Purchase[] = []): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const today = new Date();
  const currentMonth = today.getMonth() + 1;

  for (const customer of customers) {
    if (customer.isAnonymized) continue;

    // 1. Aniversariantes do Mês
    if (customer.birthDate) {
      const birthMonth = parseInt(customer.birthDate.split('-')[1], 10);
      if (birthMonth === currentMonth) {
        actions.push({
          id: `nba-birth-${customer.id}`,
          customerId: customer.id,
          customerName: customer.name,
          customerCpf: customer.cpf,
          customerPhone: customer.phone,
          customerWhatsApp: customer.whatsapp,
          consentWhatsApp: customer.consent?.whatsappMarketing || false,
          whatsappMarketing: customer.consent?.whatsappMarketing || false,
          rfmSegment: customer.rfmSegment,
          category: 'Aniversário',
          reason: 'Aniversariante do Mês Super Astral',
          evidence: `Data de Nascimento: ${customer.birthDate}. Cliente com ${customer.totalPurchases} compras acumuladas.`,
          recommendedAction: 'Enviar mensagem de Parabéns no WhatsApp com cupom de R$ 20 OFF em compras acima de R$ 100.',
          suggestedOffer: 'R$ 20 de Desconto de Aniversário',
          suggestedCouponCode: 'NIVER-ASTRAL20',
          urgency: 'Alta'
        });
      }
    }

    // 2. Recuperação de Clientes Em Risco (> 30 a 60 dias sem comprar e ticket > R$ 300)
    if (customer.rfmSegment === 'EM RISCO' || (customer.daysSinceLastPurchase >= 31 && customer.daysSinceLastPurchase <= 75 && customer.totalSpent >= 400)) {
      actions.push({
        id: `nba-risk-${customer.id}`,
        customerId: customer.id,
        customerName: customer.name,
        customerCpf: customer.cpf,
        customerPhone: customer.phone,
        customerWhatsApp: customer.whatsapp,
        consentWhatsApp: customer.consent?.whatsappMarketing || false,
        whatsappMarketing: customer.consent?.whatsappMarketing || false,
        rfmSegment: customer.rfmSegment,
        category: 'Recuperação',
        reason: 'Cliente Valioso em Risco de Churn',
        evidence: `Sem comprar há ${customer.daysSinceLastPurchase} dias. Histórico de R$ ${customer.totalSpent.toFixed(2)} em ${customer.totalPurchases} compras.`,
        recommendedAction: 'Disparar WhatsApp de "Sentimos sua falta" com 10% OFF no Açougue ou Hortifruti.',
        suggestedOffer: '10% de desconto na próxima compra',
        suggestedCouponCode: 'VOLTA-ASTRAL10',
        urgency: 'Alta'
      });
    }

    // 3. Clientes Perdidos com Alto Valor Histórico (> 90 dias e gasto > R$ 1000)
    if (customer.rfmSegment === 'PERDIDOS' && customer.totalSpent >= 1000) {
      actions.push({
        id: `nba-lost-${customer.id}`,
        customerId: customer.id,
        customerName: customer.name,
        customerCpf: customer.cpf,
        customerPhone: customer.phone,
        customerWhatsApp: customer.whatsapp,
        consentWhatsApp: customer.consent?.whatsappMarketing || false,
        whatsappMarketing: customer.consent?.whatsappMarketing || false,
        rfmSegment: customer.rfmSegment,
        category: 'Recuperação',
        reason: 'Reconquista de Ex-Cliente Campeão',
        evidence: `Inativo há ${customer.daysSinceLastPurchase} dias, mas já comprou R$ ${customer.totalSpent.toFixed(2)} no Super Astral.`,
        recommendedAction: 'Oferta agressiva de reconquista (R$ 30 OFF acima de R$ 150) ou contato telefônico humanizado do SAC.',
        suggestedOffer: 'R$ 30 de desconto de boas-vindas de volta',
        suggestedCouponCode: 'RECONQUISTA-30',
        urgency: 'Média'
      });
    }

    // 4. Incentivo à 2ª Compra para Novos Clientes
    if (customer.rfmSegment === 'NOVOS' || (customer.totalPurchases === 1 && customer.daysSinceLastPurchase <= 20)) {
      actions.push({
        id: `nba-new-${customer.id}`,
        customerId: customer.id,
        customerName: customer.name,
        customerCpf: customer.cpf,
        customerPhone: customer.phone,
        customerWhatsApp: customer.whatsapp,
        consentWhatsApp: customer.consent?.whatsappMarketing || false,
        whatsappMarketing: customer.consent?.whatsappMarketing || false,
        rfmSegment: customer.rfmSegment,
        category: 'Boas-Vindas',
        reason: 'Consolidar Fidelização na 2ª Compra',
        evidence: `Primeira compra realizada há ${customer.daysSinceLastPurchase} dias (Ticket: R$ ${customer.averageTicket.toFixed(2)}).`,
        recommendedAction: 'Enviar dicas das ofertas da semana na Padaria/Hortifruti + 50 pontos extras no Astral Clube.',
        suggestedOffer: '50 Pontos Bônus no Astral Clube',
        suggestedCouponCode: 'BEMVINDO-50PTS',
        urgency: 'Média'
      });
    }

    // 5. Clientes Campeões / VIP - Benefício Exclusivo
    if (customer.rfmSegment === 'CAMPEÕES') {
      actions.push({
        id: `nba-vip-${customer.id}`,
        customerId: customer.id,
        customerName: customer.name,
        customerCpf: customer.cpf,
        customerPhone: customer.phone,
        customerWhatsApp: customer.whatsapp,
        consentWhatsApp: customer.consent?.whatsappMarketing || false,
        whatsappMarketing: customer.consent?.whatsappMarketing || false,
        rfmSegment: customer.rfmSegment,
        category: 'VIP/Fidelidade',
        reason: 'Cliente Top 5% Faturamento Super Astral',
        evidence: `Total acumulado: R$ ${customer.totalSpent.toFixed(2)} (${customer.totalPurchases} compras). Recência impecável (${customer.daysSinceLastPurchase} dias).`,
        recommendedAction: 'Convite para degustação de Vinhos e Queijos na Loja + Atendimento caixa preferencial Astral Prime.',
        suggestedOffer: 'Degustação VIP + 15% em Vinhos Selecionados',
        suggestedCouponCode: 'ASTRAL-PRIME15',
        urgency: 'Baixa'
      });
    }

    // 6. Cross-sell de Fim de Semana (Carnes -> Cervejas/Bebidas/Carvão)
    if (customer.totalPurchases >= 3 && customer.daysSinceLastPurchase <= 14) {
      actions.push({
        id: `nba-cross-${customer.id}`,
        customerId: customer.id,
        customerName: customer.name,
        customerCpf: customer.cpf,
        customerPhone: customer.phone,
        customerWhatsApp: customer.whatsapp,
        consentWhatsApp: customer.consent?.whatsappMarketing || false,
        whatsappMarketing: customer.consent?.whatsappMarketing || false,
        rfmSegment: customer.rfmSegment,
        category: 'Cross-sell',
        reason: 'Oportunidade de Cesta Cruzada Fim de Semana',
        evidence: `Comprador ativo semanal (Ticket R$ ${customer.averageTicket.toFixed(2)}). Potencial de expansão para Bebidas e Mercearia Fina.`,
        recommendedAction: 'Sugerir combo de Churrasco do Astral (Picanha + Cerveja Artesanal + Pão de Alho) com desconto no combo.',
        suggestedOffer: 'Combo Churrasco Astral com 12% OFF',
        suggestedCouponCode: 'CHURRAS-ASTRAL',
        urgency: 'Média'
      });
    }
  }

  // Deduplicate by customer or return ordered by urgency
  const urgencyOrder: Record<string, number> = { 'Alta': 1, 'Média': 2, 'Baixa': 3 };
  return actions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
}
