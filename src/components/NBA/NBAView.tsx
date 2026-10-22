import React, { useState, useMemo } from 'react';
import { 
  Sparkles, 
  Search, 
  Filter, 
  Send, 
  Ticket, 
  Cake, 
  AlertTriangle, 
  Clock, 
  TrendingDown, 
  Award, 
  ArrowRight,
  Eye,
  MessageSquare,
  CheckCircle2,
  PhoneCall
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { NextBestAction } from '../../types/crm';
import { generateNextBestActions, buildNBAWhatsAppMessage } from '../../services/nbaEngine';

export const NBAView: React.FC = () => {
  const { customers, purchases, coupons, openCustomer360, setCurrentView, showToast } = useCRM();

  const [filterType, setFilterType] = useState<string>('all');
  const [filterUrgency, setFilterUrgency] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null);

  // Generate real-time NBA recommendations from current database
  const allActions: NextBestAction[] = useMemo(() => {
    return generateNextBestActions(customers, purchases, coupons);
  }, [customers, purchases, coupons]);

  const filteredActions = useMemo(() => {
    return allActions.filter(a => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = a.customerName.toLowerCase().includes(q);
        const matchReason = a.reason.toLowerCase().includes(q);
        const matchAction = a.recommendedAction.toLowerCase().includes(q);
        if (!matchName && !matchReason && !matchAction) return false;
      }

      if (filterType !== 'all' && a.category !== filterType) {
        return false;
      }

      if (filterUrgency !== 'all' && a.urgency !== filterUrgency) {
        return false;
      }

      return true;
    });
  }, [allActions, search, filterType, filterUrgency]);

  // Group counts for summary chips
  const opportunityStats = useMemo(() => {
    return {
      birthday: allActions.filter(a => a.category === 'Aniversário').length,
      churnRisk: allActions.filter(a => a.category === 'Recuperação').length,
      singlePurchase: allActions.filter(a => a.category === 'Boas-Vindas').length,
      loyaltyExpiring: allActions.filter(a => a.category === 'VIP/Fidelidade').length,
      vipCrossSell: allActions.filter(a => a.category === 'Cross-sell').length
    };
  }, [allActions]);

  const handleCopyScript = (action: NextBestAction) => {
    const script = buildNBAWhatsAppMessage(action, true);
    navigator.clipboard.writeText(script);
    setCopiedActionId(action.id);
    showToast('Script de WhatsApp copiado para a área de transferência!', 'success');
    setTimeout(() => setCopiedActionId(null), 3000);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Motor de Próxima Melhor Ação (Next Best Action - NBA)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Oportunidades comerciais personalizadas geradas com base no comportamento de compras do Super Astral.
          </p>
        </div>

        <button
          onClick={() => setCurrentView('campaigns')}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-emerald-600/20"
        >
          <Send className="w-4 h-4" />
          Disparar Campanhas em Massa
        </button>
      </div>

      {/* Opportunity Category Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div 
          onClick={() => setFilterType(filterType === 'Aniversário' ? 'all' : 'Aniversário')}
          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
            filterType === 'Aniversário' ? 'bg-pink-50 border-pink-400 ring-2 ring-pink-400/20' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <Cake className="w-4 h-4 text-pink-600" />
            <span className="text-base font-black text-slate-900">{opportunityStats.birthday}</span>
          </div>
          <div className="text-xs font-bold text-slate-800 mt-1">Aniversariantes</div>
          <div className="text-[10px] text-slate-400">Cupom de parabéns</div>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'Recuperação' ? 'all' : 'Recuperação')}
          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
            filterType === 'Recuperação' ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400/20' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span className="text-base font-black text-slate-900">{opportunityStats.churnRisk}</span>
          </div>
          <div className="text-xs font-bold text-slate-800 mt-1">Recuperação / Churn</div>
          <div className="text-[10px] text-slate-400">Sem comprar há 31-60d</div>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'Boas-Vindas' ? 'all' : 'Boas-Vindas')}
          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
            filterType === 'Boas-Vindas' ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/20' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-base font-black text-slate-900">{opportunityStats.singlePurchase}</span>
          </div>
          <div className="text-xs font-bold text-slate-800 mt-1">2ª Compra (Novos)</div>
          <div className="text-[10px] text-slate-400">Boas-vindas e retorno</div>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'VIP/Fidelidade' ? 'all' : 'VIP/Fidelidade')}
          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
            filterType === 'VIP/Fidelidade' ? 'bg-purple-50 border-purple-400 ring-2 ring-purple-400/20' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <Award className="w-4 h-4 text-purple-600" />
            <span className="text-base font-black text-slate-900">{opportunityStats.loyaltyExpiring}</span>
          </div>
          <div className="text-xs font-bold text-slate-800 mt-1">VIP & Fidelidade</div>
          <div className="text-[10px] text-slate-400">Pontos e benefícios</div>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'Cross-sell' ? 'all' : 'Cross-sell')}
          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
            filterType === 'Cross-sell' ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400/20' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="text-base font-black text-slate-900">{opportunityStats.vipCrossSell}</span>
          </div>
          <div className="text-xs font-bold text-slate-800 mt-1">Cross-Sell</div>
          <div className="text-[10px] text-slate-400">Venda cruzada</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por cliente, motivo ou ação..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none cursor-pointer"
          >
            <option value="all">Todas as Oportunidades</option>
            <option value="Aniversário">Aniversariantes</option>
            <option value="Recuperação">Recuperação de Churn</option>
            <option value="Boas-Vindas">Boas-Vindas / 2ª Compra</option>
            <option value="VIP/Fidelidade">VIP & Fidelidade</option>
            <option value="Cross-sell">Cross-Sell</option>
          </select>

          <select
            value={filterUrgency}
            onChange={e => setFilterUrgency(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none cursor-pointer"
          >
            <option value="all">Todas as Urgências</option>
            <option value="Alta">Urgência Alta</option>
            <option value="Média">Urgência Média</option>
            <option value="Baixa">Urgência Baixa</option>
          </select>
        </div>
      </div>

      {/* Action Cards List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredActions.length === 0 ? (
          <div className="col-span-full bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="font-semibold text-sm">Nenhuma oportunidade pendente com os filtros selecionados.</p>
          </div>
        ) : (
          filteredActions.map(action => (
            <div
              key={action.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 
                      onClick={() => openCustomer360(action.customerId)}
                      className="font-bold text-sm text-slate-900 hover:text-emerald-600 cursor-pointer"
                    >
                      {action.customerName}
                    </h3>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {action.customerCpf || 'Sem CPF'} • {action.customerWhatsApp || 'Sem WhatsApp'}
                    </span>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                    action.urgency === 'Alta' ? 'bg-rose-100 text-rose-800' :
                    action.urgency === 'Média' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {action.urgency}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-1">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    {action.reason}
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    {action.evidence}
                  </p>
                </div>

                <div className="text-xs text-slate-700">
                  <span className="font-bold text-slate-900 block mb-0.5">Ação Recomendada:</span>
                  <p className="text-slate-600">{action.recommendedAction}</p>
                </div>

                {action.suggestedCouponCode && (
                  <div className="flex items-center gap-2 text-xs bg-emerald-50/50 p-2 rounded-lg border border-emerald-100">
                    <Ticket className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-[11px] text-slate-600 font-medium">Cupom:</span>
                    <span className="font-mono font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded text-[10px]">
                      {action.suggestedCouponCode}
                    </span>
                  </div>
                )}
                {action.missingCouponCode && !action.suggestedCouponCode && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-100">
                    Cupom sugerido {action.missingCouponCode} não está cadastrado/ativo em Cupons; a mensagem vai sem cupom.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                <button
                  onClick={() => openCustomer360(action.customerId)}
                  className="text-slate-500 hover:text-emerald-700 flex items-center gap-1 font-semibold"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Ver 360°
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyScript(action)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
                  >
                    {copiedActionId === action.id ? 'Copiado!' : 'Copiar Script'}
                  </button>

                  {action.customerWhatsApp && (action.whatsappMarketing ?? action.consentWhatsApp) && (
                    <a
                      href={`https://wa.me/55${action.customerWhatsApp.replace(/\D/g, '')}?text=${encodeURIComponent(
                        buildNBAWhatsAppMessage(action)
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Enviar Zap
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
