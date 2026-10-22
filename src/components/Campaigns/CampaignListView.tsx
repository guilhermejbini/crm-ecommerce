import React, { useState, useMemo } from 'react';
import { 
  Send, 
  Plus, 
  Sparkles, 
  MessageSquare, 
  Mail, 
  Smartphone, 
  Users, 
  Ticket, 
  TrendingUp, 
  CheckCircle2, 
  Play, 
  Pause, 
  Bot, 
  DollarSign, 
  Calendar,
  X,
  Copy,
  Clock,
  Trash2
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { apiFetch } from '../../services/api';
import { Campaign, CampaignChannel, CampaignStatus, RFMSegmentType } from '../../types/crm';
import { isCustomerEligibleForCampaign } from '../../services/firestoreService';
import { findUsableCoupon } from '../../utils/couponUtils';

export const CampaignListView: React.FC = () => {
  const { 
    campaigns, 
    customers, 
    coupons,
    handleSaveCampaign, 
    handleToggleCampaignStatus, 
    handleDeleteCampaign,
    currentUser, 
    showToast 
  } = useCRM();

  const [isNewCampaignModalOpen, setIsNewCampaignModalOpen] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // New Campaign Form State
  const [campaignName, setCampaignName] = useState('');
  const [channel, setChannel] = useState<CampaignChannel>('WhatsApp');
  const [targetSegment, setTargetSegment] = useState<string>('CAMPEÕES');
  const [targetNeighborhood, setTargetNeighborhood] = useState<string>('all');
  const [onlyOptIn, setOnlyOptIn] = useState<boolean>(true);
  const [couponCode, setCouponCode] = useState<string>('');
  const [couponDiscount, setCouponDiscount] = useState<string>('15% de desconto');
  const [message, setMessage] = useState<string>(
    'Olá {nome}! Tudo bem? Temos uma oferta especial para você no Super Astral! Apresente o cupom {cupom} no caixa e ganhe desconto na sua compra.'
  );
  const [scheduledDate, setScheduledDate] = useState<string>('');

  // AI Prompt Objective
  const [aiObjective, setAiObjective] = useState('');

  // Calculate estimated audience
  const estimatedAudience = useMemo(() => {
    return customers.filter(c => 
      isCustomerEligibleForCampaign(c, channel, onlyOptIn, targetSegment, targetNeighborhood)
    ).length;
  }, [customers, targetSegment, targetNeighborhood, onlyOptIn, channel]);

  // Aggregate Metrics across all campaigns
  const totalCampaignStats = useMemo(() => {
    let sent = 0;
    let redeemed = 0;
    let revenue = 0;
    let totalRoi = 0;
    let campaignsWithRoi = 0;

    campaigns.forEach(c => {
      const s = c.sentCount || 0;
      const r = c.convertedCount || 0;
      const rev = c.revenueGenerated || c.attributedRevenue || 0;
      sent += s;
      redeemed += r;
      revenue += rev;
      if (typeof c.roi === 'number' && c.roi > 0) {
        totalRoi += c.roi;
        campaignsWithRoi++;
      }
    });

    const conversionRate = sent > 0 ? (redeemed / sent) * 100 : 0;
    // ROI só quando registrado a partir de dados reais (sem estimativa de custo/receita)
    const avgRoi = campaignsWithRoi > 0 ? totalRoi / campaignsWithRoi : 0;

    return {
      totalCampaigns: campaigns.length,
      sent,
      redeemed,
      revenue,
      conversionRate: parseFloat(conversionRate.toFixed(1)),
      avgRoi: parseFloat(avgRoi.toFixed(1))
    };
  }, [campaigns]);

  const handleGenerateCampaignWithAI = async () => {
    if (!aiObjective.trim()) {
      showToast('Digite o objetivo da campanha para a IA (ex: Queima de vinhos para clientes VIP)', 'error');
      return;
    }

    setIsGeneratingAI(true);
    try {
      const res = await apiFetch('/api/ai/generate-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: aiObjective.trim(),
          targetSegment: targetSegment,
          channel: channel,
          store: 'Todas as lojas',
          categoryFocus: 'Geral',
          metrics: {
            totalCampaigns: campaigns.length
          }
        })
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Sessão expirada ou não autenticada. Faça login novamente.');
        }
        if (res.status === 403) {
          throw new Error('Acesso negado: Sua conta não possui autorização ativa para gerar campanhas com IA.');
        }
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Não foi possível obter resposta da IA. Tente novamente.');
      }
      const data = await res.json();

      if (!data || !data.campaignName) {
        throw new Error('Não foi possível obter resposta da IA. Tente novamente.');
      }

      setCampaignName(data.campaignName);

      // Extrai template de mensagem específico para o canal escolhido
      let templateMsg = '';
      if (channel === 'WhatsApp') {
        templateMsg = data.messageTemplates?.whatsapp || '';
      } else if (channel === 'SMS') {
        templateMsg = data.messageTemplates?.sms || '';
      } else if (channel === 'E-mail') {
        if (typeof data.messageTemplates?.email === 'object' && data.messageTemplates?.email !== null) {
          const { subject, body } = data.messageTemplates.email;
          templateMsg = subject ? `Assunto: ${subject}\n\n${body || ''}` : (body || '');
        } else {
          templateMsg = data.messageTemplates?.email || '';
        }
      }
      if (!templateMsg) {
        templateMsg = data.messageTemplates?.whatsapp || data.messageTemplates?.sms || '';
      }
      setMessage(templateMsg);

      if (data.suggestedCoupon?.code) {
        setCouponCode(data.suggestedCoupon.code);
      }
      if (data.suggestedCoupon) {
        const disc = `${data.suggestedCoupon.discountValue}${data.suggestedCoupon.discountType === 'percent' ? '%' : ' R$'}`;
        setCouponDiscount(data.suggestedCoupon.minPurchaseValue ? `${disc} (Mín. R$ ${data.suggestedCoupon.minPurchaseValue})` : disc);
      }

      showToast('Campanha gerada com sucesso pela IA Gemini!', 'success');
    } catch (err: any) {
      console.error('[Campanha IA] Erro ao gerar campanha:', err);
      showToast(err?.message || 'Não foi possível obter resposta da IA. Tente novamente.', 'error');
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleCreateCampaignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignName.trim() || !message.trim()) {
      showToast('Nome e mensagem da campanha são obrigatórios.', 'error');
      return;
    }
    // Cupom citado na campanha precisa existir em Cupons (ativo e válido); a IA pode sugerir códigos inexistentes.
    if (couponCode.trim() && !findUsableCoupon(couponCode, coupons)) {
      showToast(`O cupom ${couponCode.trim().toUpperCase()} não está cadastrado, ativo e válido em Cupons. Cadastre-o antes ou deixe o campo vazio.`, 'error');
      return;
    }
    if (!couponCode.trim() && message.includes('{cupom}')) {
      showToast('A mensagem usa {cupom}, mas nenhum cupom foi informado.', 'error');
      return;
    }

    const newCampaign: Campaign = {
      id: `camp-${Date.now()}`,
      name: campaignName.trim(),
      channel,
      status: scheduledDate ? 'Agendada' : 'Ativa',
      targetSegment: targetSegment as any,
      targetNeighborhood: targetNeighborhood !== 'all' ? targetNeighborhood : undefined,
      onlyOptIn,
      message: message.trim(),
      couponCode: couponCode.trim() || undefined,
      discountValue: couponDiscount.trim() || undefined,
      scheduledDate: scheduledDate || undefined,
      // Público estimado no momento da criação. Envio e resultados só com disparo/integração real
      // (nunca estimados por fórmula).
      targetAudienceCount: estimatedAudience,
      sentCount: 0,
      deliveredCount: 0,
      openedCount: 0,
      clickedCount: 0,
      convertedCount: 0,
      revenueGenerated: 0,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.name
    };

    await handleSaveCampaign(newCampaign);
    setIsNewCampaignModalOpen(false);
    // Reset
    setCampaignName('');
    setMessage('Olá {nome}! Tudo bem? Temos uma oferta especial para você no Super Astral! Apresente o cupom {cupom} no caixa.');
    setAiObjective('');
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Campanhas & Automações de Marketing
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Disparos segmentados via WhatsApp, E-mail e SMS integrados ao Astral Clube do Super Astral.
          </p>
        </div>

        {currentUser.role !== 'viewer' && (
          <button
            onClick={() => setIsNewCampaignModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" />
            Criar Nova Campanha
          </button>
        )}
      </div>

      {/* Aggregate KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total de Disparos Realizados</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {totalCampaignStats.sent.toLocaleString('pt-BR')} msgs
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">{totalCampaignStats.totalCampaigns} campanhas ativas/executadas</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Cupons Resgatados no Caixa</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">
            {totalCampaignStats.redeemed.toLocaleString('pt-BR')} resgates
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
            Taxa Média de Conversão: {totalCampaignStats.conversionRate}%
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Faturamento Direto Gerado</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            R$ {totalCampaignStats.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Atribuído aos cupons de campanhas</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">ROI Médio de Marketing</div>
          <div className="text-2xl font-bold text-teal-600 mt-1">
            {totalCampaignStats.avgRoi > 0 ? `${totalCampaignStats.avgRoi.toFixed(1)}x` : '0.0x'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Retorno sobre investimento de canal</div>
        </div>
      </div>

      {/* Campaigns Grid */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
          Campanhas Cadastradas ({campaigns.length})
        </h3>

        {campaigns.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
            <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto text-teal-600 mb-3">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-800">Nenhuma campanha cadastrada</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              A base de campanhas está limpa. Crie uma nova campanha multicanal (WhatsApp, E-mail ou SMS) com apoio da IA para impulsionar suas vendas.
            </p>
            <button
              onClick={() => setIsNewCampaignModalOpen(true)}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Criar Primeira Campanha
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {campaigns.map(camp => (
              <div key={camp.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">{camp.name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      camp.status === 'Ativa' ? 'bg-emerald-100 text-emerald-800' :
                      camp.status === 'Agendada' ? 'bg-blue-100 text-blue-800' :
                      camp.status === 'Concluída' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {camp.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                    <span className="flex items-center gap-1 font-semibold text-slate-600">
                      {camp.channel === 'WhatsApp' && <MessageSquare className="w-3.5 h-3.5 text-teal-600" />}
                      {camp.channel === 'E-mail' && <Mail className="w-3.5 h-3.5 text-blue-600" />}
                      {camp.channel === 'SMS' && <Smartphone className="w-3.5 h-3.5 text-slate-600" />}
                      {camp.channel}
                    </span>
                    <span>Público: <strong>{camp.targetSegment}</strong></span>
                    {camp.couponCode && (
                      <span className="font-mono text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">
                        {camp.couponCode}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleCampaignStatus(camp.id)}
                    title={camp.status === 'Ativa' ? 'Pausar campanha' : 'Ativar campanha'}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    {camp.status === 'Ativa' ? <Pause className="w-4 h-4 text-amber-600" /> : <Play className="w-4 h-4 text-emerald-600" />}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Deseja realmente excluir a campanha "${camp.name}"?`)) {
                        handleDeleteCampaign(camp.id);
                      }
                    }}
                    title="Excluir campanha"
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Message Bubble Preview */}
              <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100 text-xs text-slate-800 font-medium">
                "{camp.message}"
              </div>

              {/* Performance Stats Bar */}
              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-center text-xs">
                <div>
                  <div className="text-[10px] text-slate-400">{camp.sentCount ? 'Disparados' : 'Público'}</div>
                  <div className="font-bold text-slate-800">{camp.sentCount || camp.targetAudienceCount || 0}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Entregues</div>
                  <div className="font-bold text-blue-600">{camp.deliveredCount || 0}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Convertidos</div>
                  <div className="font-bold text-emerald-600">{camp.convertedCount || 0}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Receita Gerada</div>
                  <div className="font-bold text-slate-900">R$ {(camp.revenueGenerated || camp.attributedRevenue || 0).toFixed(0)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* New Campaign Modal with AI Generator & WhatsApp Preview */}
      {isNewCampaignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 divide-y divide-slate-100 animate-in fade-in duration-150">
            {/* Modal Header */}
            <div className="p-5 flex items-center justify-between bg-slate-50 rounded-t-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  Criar Nova Campanha de Marketing
                </h2>
                <p className="text-xs text-slate-500">
                  Configure segmentação, cupons e utilize a IA Gemini para criar mensagens persuasivas.
                </p>
              </div>
              <button
                onClick={() => setIsNewCampaignModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Form Controls */}
              <form onSubmit={handleCreateCampaignSubmit} className="lg:col-span-2 space-y-4">
                {/* AI Assistant Generator Box */}
                <div className="p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 rounded-xl border border-emerald-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                    <Bot className="w-4 h-4 text-emerald-700" />
                    Gerador Inteligente de Campanhas com Gemini
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ex: Oferta de Carnes para Churrasco no Fim de Semana com 15% OFF"
                      value={aiObjective}
                      onChange={e => setAiObjective(e.target.value)}
                      className="flex-1 px-3 py-2 bg-white border border-emerald-200 rounded-lg text-xs outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleGenerateCampaignWithAI}
                      disabled={isGeneratingAI}
                      className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isGeneratingAI ? 'animate-spin' : ''}`} />
                      {isGeneratingAI ? 'Gerando...' : 'Gerar'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nome da Campanha *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Sexta da Carne Astral"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Canal de Disparo</label>
                    <select
                      value={channel}
                      onChange={e => setChannel(e.target.value as any)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none bg-white"
                    >
                      <option value="WhatsApp">WhatsApp (Recomendado)</option>
                      <option value="E-mail">E-mail Marketing</option>
                      <option value="SMS">SMS</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Público RFM Alvo</label>
                    <select
                      value={targetSegment}
                      onChange={e => setTargetSegment(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none bg-white"
                    >
                      <option value="all">Toda a Base ({customers.length})</option>
                      <option value="CAMPEÕES">👑 Campeões</option>
                      <option value="LEAIS">⭐ Leais</option>
                      <option value="POTENCIAIS LEAIS">💎 Potenciais Leais</option>
                      <option value="PROMISSORES">🚀 Promissores</option>
                      <option value="NOVOS">🌱 Novos</option>
                      <option value="PRECISAM DE ATENÇÃO">⚠️ Precisam de Atenção</option>
                      <option value="EM RISCO">🚨 Em Risco (31-60d)</option>
                      <option value="PRESTES A DORMIR">💤 Prestes a Dormir</option>
                      <option value="HIBERNANDO">❄️ Hibernando</option>
                      <option value="PERDIDOS">❌ Perdidos</option>
                      <option value="UNCLASSIFIED">⚪ Não Classificados</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Código do Cupom</label>
                    <input
                      type="text"
                      placeholder="Ex: ASTRALCARNE"
                      value={couponCode}
                      onChange={e => setCouponCode(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Oferta / Desconto</label>
                    <input
                      type="text"
                      placeholder="Ex: 15% OFF"
                      value={couponDiscount}
                      onChange={e => setCouponDiscount(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      Mensagem do Disparo *
                    </label>
                    <span className="text-[10px] text-slate-400">Tags: &#123;nome&#125;, &#123;cupom&#125;</span>
                  </div>
                  <textarea
                    rows={4}
                    required
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span className="font-bold text-slate-800 block">Público Estimado: {estimatedAudience} clientes</span>
                    <span className="text-[11px] text-slate-500">Respeitando consentimento LGPD para {channel}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsNewCampaignModalOpen(false)}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/20"
                    >
                      Salvar & Disparar
                    </button>
                  </div>
                </div>
              </form>

              {/* Live WhatsApp Preview */}
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Prévia no WhatsApp
                </div>
                <div className="bg-[#e5ddd5] p-4 rounded-2xl border border-slate-300 min-h-[300px] flex flex-col justify-end shadow-inner relative">
                  <div className="bg-[#075e54] text-white p-2 rounded-t-xl absolute top-0 left-0 right-0 flex items-center gap-2 text-xs font-bold">
                    <div className="w-5 h-5 rounded-full bg-emerald-400"></div>
                    Super Astral Supermercados
                  </div>

                  <div className="bg-white p-3 rounded-xl rounded-tl-none shadow-xs text-xs text-slate-800 max-w-[90%] space-y-1 mt-10">
                    <p className="whitespace-pre-line leading-relaxed">
                      {message
                        .replace('{nome}', 'Mariana')
                        .replace('{cupom}', couponCode || '(sem cupom)')}
                    </p>
                    <div className="text-[9px] text-slate-400 text-right">12:34 ✓✓</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
