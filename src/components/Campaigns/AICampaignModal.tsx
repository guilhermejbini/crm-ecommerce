import React, { useState, useMemo } from 'react';
import { 
  X, 
  Sparkles, 
  Send, 
  RefreshCw, 
  Users, 
  Ticket, 
  MessageSquare, 
  Mail, 
  Smartphone, 
  Check, 
  ArrowRight,
  Bot
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { apiFetch } from '../../services/api';
import { Campaign, CampaignChannel, RFMSegmentType } from '../../types/crm';
import { isCustomerEligibleForCampaign } from '../../services/firestoreService';

interface AICampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AICampaignModal: React.FC<AICampaignModalProps> = ({ isOpen, onClose }) => {
  const { customers, currentUser, handleSaveCampaign, showToast } = useCRM();

  const [objective, setObjective] = useState('');
  const [targetSegment, setTargetSegment] = useState<string>('CAMPEÕES');
  const [channel, setChannel] = useState<CampaignChannel>('WhatsApp');
  const [onlyOptIn, setOnlyOptIn] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [generatedCoupon, setGeneratedCoupon] = useState('');
  const [generatedOffer, setGeneratedOffer] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');

  // Calculate estimated reach
  const audienceCount = useMemo(() => {
    return customers.filter(c => 
      isCustomerEligibleForCampaign(c, channel, onlyOptIn, targetSegment)
    ).length;
  }, [customers, targetSegment, channel, onlyOptIn]);

  if (!isOpen) return null;

  const handleGenerateAI = async () => {
    if (!objective.trim()) {
      showToast('Descreva o objetivo da campanha para a IA.', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await apiFetch('/api/ai/generate-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: objective.trim(),
          targetSegment: targetSegment,
          channel: channel,
          store: 'Todas as lojas',
          categoryFocus: 'Geral',
          metrics: {
            audienceCount,
            totalCustomers: customers.length
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

      setGeneratedTitle(data.campaignName);

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
      setGeneratedMessage(templateMsg);

      if (data.suggestedCoupon?.code) {
        setGeneratedCoupon(data.suggestedCoupon.code);
      }
      if (data.suggestedCoupon) {
        const disc = `${data.suggestedCoupon.discountValue}${data.suggestedCoupon.discountType === 'percent' ? '%' : ' R$'}`;
        setGeneratedOffer(data.suggestedCoupon.minPurchaseValue ? `${disc} (Mín. R$ ${data.suggestedCoupon.minPurchaseValue})` : disc);
      }

      showToast('Campanha e texto criados com sucesso pela IA!', 'success');
    } catch (err: any) {
      console.error('[Campanha IA] Erro ao gerar campanha:', err);
      showToast(err?.message || 'Não foi possível obter resposta da IA. Tente novamente.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAndLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generatedTitle.trim() || !generatedMessage.trim()) {
      showToast('Gere ou digite o título e a mensagem da campanha.', 'error');
      return;
    }

    const newCampaign: Campaign = {
      id: `camp-${Date.now()}`,
      name: generatedTitle.trim(),
      channel,
      status: scheduledDate ? 'Agendada' : 'Ativa',
      targetSegment: targetSegment as any,
      onlyOptIn,
      message: generatedMessage.trim(),
      couponCode: generatedCoupon.trim() || undefined,
      discountValue: generatedOffer.trim() || undefined,
      scheduledDate: scheduledDate || undefined,
      // Público estimado no momento da criação. Envio e resultados só com disparo/integração real
      // (nunca estimados por fórmula).
      targetAudienceCount: audienceCount,
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
    onClose();
    // Reset state
    setObjective('');
    setGeneratedTitle('');
    setGeneratedMessage('');
    setGeneratedCoupon('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 my-8 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-900">
                Gerador de Campanhas com IA Gemini
              </h3>
              <p className="text-xs text-slate-500">
                Crie campanhas segmentadas e personalizadas para WhatsApp, E-mail ou SMS.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input Parameters */}
        <div className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-800 mb-1">
              Objetivo Comercial da Campanha *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ex: Queima de vinhos e queijos para o fim de semana com cupom de 15%"
                value={objective}
                onChange={e => setObjective(e.target.value)}
                className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                type="button"
                onClick={handleGenerateAI}
                disabled={isGenerating || !objective.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? 'Criando...' : 'Gerar com IA'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Segmento Alvo RFM</label>
              <select
                value={targetSegment}
                onChange={e => setTargetSegment(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              >
                <option value="all">Todos os Clientes</option>
                <option value="CAMPEÕES">Campeões</option>
                <option value="LEAIS">Clientes Leais</option>
                <option value="POTENCIAIS LEAIS">Potenciais Leais</option>
                <option value="PROMISSORES">Promissores</option>
                <option value="NOVOS">Novos Clientes</option>
                <option value="PRECISAM DE ATENÇÃO">Precisam de Atenção</option>
                <option value="EM RISCO">Em Risco</option>
                <option value="PRESTES A DORMIR">Prestes a Dormir</option>
                <option value="HIBERNANDO">Hibernando</option>
                <option value="PERDIDOS">Perdidos / Inativos</option>
                <option value="UNCLASSIFIED">Não Classificados</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Canal de Disparo</label>
              <select
                value={channel}
                onChange={e => setChannel(e.target.value as CampaignChannel)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              >
                <option value="WhatsApp">WhatsApp Marketing</option>
                <option value="E-mail">E-mail Marketing</option>
                <option value="SMS">SMS Promocional</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Público Estimado</label>
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl font-bold text-emerald-800 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  {audienceCount} destinatários
                </span>
                <span className="text-[10px] bg-emerald-200 px-1.5 py-0.2 rounded">Opt-in</span>
              </div>
            </div>
          </div>
        </div>

        {/* Generated Preview & Customization */}
        <form onSubmit={handleSaveAndLaunch} className="space-y-3.5 text-xs pt-3 border-t border-slate-100">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Conteúdo da Campanha Gerada
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Título da Campanha</label>
            <input
              type="text"
              required
              placeholder="Ex: Sexta Astral - Festival de Queijos e Vinhos"
              value={generatedTitle}
              onChange={e => setGeneratedTitle(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Mensagem (Suporta variáveis &#123;nome&#125; e &#123;cupom&#125;)
            </label>
            <textarea
              rows={3}
              required
              value={generatedMessage}
              onChange={e => setGeneratedMessage(e.target.value)}
              placeholder="Digite ou gere a mensagem com a IA..."
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white font-sans text-xs leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Código do Cupom Astral</label>
              <input
                type="text"
                placeholder="Ex: ASTRAL15"
                value={generatedCoupon}
                onChange={e => setGeneratedCoupon(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-mono font-bold"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Agendamento (Opcional)</label>
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none text-slate-700"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer text-slate-600 text-[11px]">
              <input
                type="checkbox"
                checked={onlyOptIn}
                onChange={e => setOnlyOptIn(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              Respeitar Opt-in LGPD obrigatório
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold transition-colors"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={!generatedTitle.trim() || !generatedMessage.trim()}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-colors"
              >
                <Send className="w-4 h-4" />
                {scheduledDate ? 'Agendar Campanha' : 'Lançar Campanha'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
