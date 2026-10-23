import React, { useMemo, useState } from 'react';
import { 
  Users, 
  TrendingUp, 
  ShoppingBag, 
  CreditCard, 
  Phone, 
  MessageSquare, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles, 
  Crown, 
  Flame, 
  UserMinus, 
  Cake, 
  ArrowUpRight, 
  ArrowDownRight, 
  ChevronRight,
  Send,
  Zap,
  Calendar,
  Building2,
  Trophy,
  HeartHandshake,
  TrendingDown
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { useCRM } from '../../context/CRMContext';
import { generateNextBestActions } from '../../services/nbaEngine';
import { getRFMSegmentDetails } from '../../services/rfmCalculator';
import { DEMO_STORES, recordBelongsToStore } from '../../services/storeAndLocationData';
import { hasIdentifiedDocument, isActiveCustomer } from '../../utils/customerMetrics';

export const DashboardView: React.FC = () => {
  const { 
    customers, 
    purchases, 
    coupons,
    stores,
    metrics, 
    openCustomer360, 
    setCurrentView,
    setIsAICampaignModalOpen,
    setIsAIChatOpen 
  } = useCRM();

  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const storeList = stores && stores.length > 0 ? stores : DEMO_STORES;

  // Filter customers based on selected store
  const filteredCustomers = useMemo(() => {
    if (selectedStoreId === 'all') return customers;
    return customers.filter(c => recordBelongsToStore(selectedStoreId, c.favoriteStoreId, c.favoriteStoreName));
  }, [customers, selectedStoreId]);

  // Filter purchases based on selected store
  const filteredPurchases = useMemo(() => {
    if (selectedStoreId === 'all') return purchases;
    return purchases.filter(p => recordBelongsToStore(selectedStoreId, p.storeId, p.storeName));
  }, [purchases, selectedStoreId]);

  // Dynamic metrics based on store filter
  const currentMetrics = useMemo(() => {
    const totalCust = filteredCustomers.length;
    const activeCust = filteredCustomers.filter(c => isActiveCustomer(c)).length;
    const custWithCpf = filteredCustomers.filter(hasIdentifiedDocument).length;
    // Opt-in = consentimento LGPD registrado (mesma regra da tela de LGPD), não apenas ter número
    const custWithWhatsAppOptIn = filteredCustomers.filter(c => !c.isAnonymized && c.consent?.whatsappMarketing === true).length;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const newThisMonth = filteredCustomers.filter(c => {
      const d = new Date(c.registeredAt || c.createdAt || '');
      return !isNaN(d.getTime()) && d >= monthStart;
    }).length;
    const totalRev = filteredPurchases.reduce((acc, p) => acc + (p.netAmount || 0), 0);
    const avgTicket = filteredPurchases.length > 0 ? totalRev / filteredPurchases.length : 0;

    const champions = filteredCustomers.filter(c => c.rfmSegment === 'CAMPEÕES').length;
    const loyal = filteredCustomers.filter(c => c.rfmSegment === 'LEAIS').length;
    const atRisk = filteredCustomers.filter(c => c.rfmSegment === 'EM RISCO').length;
    const lost = filteredCustomers.filter(c => c.rfmSegment === 'PERDIDOS').length;
    const others = Math.max(0, totalCust - (champions + loyal + atRisk + lost));

    return {
      totalCustomers: totalCust,
      activeCustomers: activeCust,
      atRiskCustomers: atRisk,
      totalIdentifiedRevenue: totalRev,
      totalIdentifiedPurchases: filteredPurchases.length,
      averageIdentifiedTicket: avgTicket,
      captureRatePercent: totalCust > 0 ? Math.round((custWithCpf / totalCust) * 100) : 0,
      customersWithCpf: custWithCpf,
      customersWithWhatsAppOptIn: custWithWhatsAppOptIn,
      newCustomersMonth: newThisMonth,
      rfmCounts: { champions, loyal, atRisk, lost, others }
    };
  }, [filteredCustomers, filteredPurchases]);

  const nextBestActions = useMemo(() => {
    if (filteredCustomers.length === 0) return [];
    return generateNextBestActions(filteredCustomers, filteredPurchases, coupons).slice(0, 6);
  }, [filteredCustomers, filteredPurchases, coupons]);

  // Últimos 6 meses-calendário (rótulos reais, ex.: "Mai/26")
  const lastSixMonths = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${label.charAt(0).toUpperCase()}${label.slice(1)}/${String(d.getFullYear()).slice(2)}`,
        end: new Date(d.getFullYear(), d.getMonth() + 1, 1)
      };
    });
  }, []);

  const monthKeyOf = (iso?: string) => {
    const d = new Date(iso || '');
    return isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // Chart 1: faturamento e ticket médio reais por mês (compras identificadas)
  const revenueChartData = useMemo(() => {
    const byMonth = new Map<string, { revenue: number; count: number }>();
    filteredPurchases.forEach(p => {
      const k = monthKeyOf(p.purchaseDate);
      if (!k) return;
      const cur = byMonth.get(k) || { revenue: 0, count: 0 };
      cur.revenue += p.netAmount || 0;
      cur.count += 1;
      byMonth.set(k, cur);
    });
    return lastSixMonths.map(m => {
      const v = byMonth.get(m.key);
      return {
        month: m.label,
        faturamento: v ? Math.round(v.revenue) : 0,
        ticketMedio: v && v.count > 0 ? Math.round(v.revenue / v.count) : 0
      };
    });
  }, [filteredPurchases, lastSixMonths]);

  // Chart 2: base acumulada e novos cadastros por mês (data de cadastro real)
  const customerGrowthData = useMemo(() => {
    const dates = filteredCustomers
      .map(c => new Date(c.registeredAt || c.createdAt || ''))
      .filter(d => !isNaN(d.getTime()));
    return lastSixMonths.map(m => {
      const total = dates.filter(d => d < m.end).length;
      const novos = dates.filter(d => monthKeyOf(d.toISOString()) === m.key).length;
      return { mes: m.label, total, novos };
    });
  }, [filteredCustomers, lastSixMonths]);

  // Chart 3: RFM Distribution
  const rfmPieData = useMemo(() => {
    const { champions, loyal, atRisk, lost, others } = currentMetrics.rfmCounts;
    return [
      { name: 'Campeões', value: champions, color: '#12a957' },
      { name: 'Leais', value: loyal, color: '#2e58bc' },
      { name: 'Em Risco', value: atRisk, color: '#f59e0b' },
      { name: 'Perdidos', value: lost, color: '#ef4444' },
      { name: 'Outros', value: others, color: '#94a3b8' }
    ].filter(item => item.value > 0);
  }, [currentMetrics.rfmCounts]);

  const atRiskCustomers = useMemo(() => {
    return filteredCustomers
      .filter(c => c.rfmSegment === 'EM RISCO' || c.daysSinceLastPurchase >= 31)
      .slice(0, 4);
  }, [filteredCustomers]);

  const birthdayCustomers = useMemo(() => {
    const currentMonth = new Date().getMonth() + 1;
    return filteredCustomers
      .filter(c => c.birthDate && parseInt(c.birthDate.split('-')[1], 10) === currentMonth)
      .slice(0, 4);
  }, [filteredCustomers]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Bento Header Banner */}
      <div className="bento-card bg-astral-navy text-white p-6 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4 border-astral-navy">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-astral-yellow pointer-events-none"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-astral-yellow text-xs font-bold uppercase tracking-wider mb-1">
            Painel executivo · Super Astral
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">
            Visão geral dos clientes
          </h2>
          <p className="text-slate-300 text-xs mt-1 max-w-xl">
            Relacionamento, segmentação RFM e oportunidades comerciais das três lojas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 relative z-10">
          {/* Store / Unit Filter Selector */}
          <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 rounded-xl transition-all shadow-sm">
            <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="bg-transparent text-white text-xs font-bold border-none focus:outline-none cursor-pointer pr-2"
            >
              <option value="all" className="bg-slate-900 text-white">Todas as 3 Unidades (Rede Total)</option>
              {storeList.map(st => (
                <option key={st.id} value={st.id} className="bg-slate-900 text-white">
                  {st.name} - {st.neighborhood}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsAICampaignModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-astral-yellow hover:bg-[#ffe05b] text-astral-navy font-bold rounded-xl text-xs transition-all"
          >
            <Sparkles className="w-4 h-4" />
            Gerar Campanha com IA
          </button>
          <button
            onClick={() => setIsAIChatOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800/90 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold rounded-xl text-xs transition-all"
          >
            Chat CRM
          </button>
        </div>
      </div>

      {/* Bento Grid: 6 Primary Executive Metrics */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Métricas Chave de Desempenho {selectedStoreId !== 'all' ? `• ${storeList.find(s => s.id === selectedStoreId)?.name || 'Unidade Filtrada'}` : '• Rede Super Astral'}
          </div>
          {selectedStoreId !== 'all' && (
            <button
              onClick={() => setSelectedStoreId('all')}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Limpar filtro de unidade
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {/* 1. Total Clientes */}
          <div className="bento-card flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="metric-label">Total Clientes</span>
              <Users className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-end justify-between">
              <span className="metric-value">{currentMetrics.totalCustomers}</span>
              <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-0.5">
                +{currentMetrics.newCustomersMonth} ↑
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-medium">
              {selectedStoreId === 'all' ? 'Cadastrados na rede' : 'Clientes desta loja'}
            </div>
          </div>

          {/* 2. Clientes Ativos */}
          <div className="bento-card flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="metric-label">Ativos (30d)</span>
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-end justify-between">
              <span className="metric-value">{currentMetrics.activeCustomers}</span>
              <span className="text-[11px] font-bold text-emerald-600">
                {((currentMetrics.activeCustomers / Math.max(1, currentMetrics.totalCustomers)) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-medium">Compraram no mês</div>
          </div>

          {/* 3. Taxa de Captura CPF */}
          <div className="bento-card flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="metric-label">Captura CPF</span>
              <CreditCard className="w-4 h-4 text-blue-500" />
            </div>
            <div className="flex items-end justify-between">
              <span className="metric-value">{currentMetrics.captureRatePercent}%</span>
              <span className="text-[11px] font-bold text-blue-600">Ident.</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-medium">{currentMetrics.customersWithCpf} clientes com CPF</div>
          </div>

          {/* 4. WhatsApp & Opt-in */}
          <div className="bento-card flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="metric-label">Opt-in WhatsApp</span>
              <MessageSquare className="w-4 h-4 text-teal-500" />
            </div>
            <div className="flex items-end justify-between">
              <span className="metric-value">{currentMetrics.customersWithWhatsAppOptIn}</span>
              <span className="text-[11px] font-bold text-teal-600">
                {((currentMetrics.customersWithWhatsAppOptIn / Math.max(1, currentMetrics.totalCustomers)) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-medium">Consentimento LGPD</div>
          </div>

          {/* 5. Ticket Médio */}
          <div className="bento-card flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="metric-label">Ticket Médio</span>
              <ShoppingBag className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="flex items-end justify-between">
              <span className="text-xl font-extrabold text-slate-900">
                R$ {currentMetrics.averageIdentifiedTicket.toFixed(0)}
              </span>
              <span className="text-[11px] font-medium text-slate-400" title="Ticket médio do mês atual">
                {revenueChartData[revenueChartData.length - 1]?.ticketMedio
                  ? `Mês: R$ ${revenueChartData[revenueChartData.length - 1].ticketMedio}`
                  : '—'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-medium">Por compra no PDV</div>
          </div>

          {/* 6. Faturamento Identificado */}
          <div className="bento-card flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="metric-label">Faturamento</span>
              <Flame className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex items-end justify-between">
              <span className="text-xl font-extrabold text-slate-900">
                {currentMetrics.totalIdentifiedRevenue === 0 
                  ? 'R$ 0,00' 
                  : currentMetrics.totalIdentifiedRevenue >= 1000 
                  ? `R$ ${(currentMetrics.totalIdentifiedRevenue / 1000).toFixed(1)}k` 
                  : `R$ ${currentMetrics.totalIdentifiedRevenue.toFixed(2)}`}
              </span>
              {(() => {
                // Variação real: mês atual x mês anterior (só quando há base de comparação)
                const cur = revenueChartData[revenueChartData.length - 1]?.faturamento || 0;
                const prev = revenueChartData[revenueChartData.length - 2]?.faturamento || 0;
                if (prev <= 0) return <span className="text-[11px] font-medium text-slate-400">—</span>;
                const pct = Math.round(((cur - prev) / prev) * 100);
                return (
                  <span className={`text-[11px] font-bold ${pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} title="Mês atual x mês anterior">
                    {pct >= 0 ? `+${pct}% ↑` : `${pct}% ↓`}
                  </span>
                );
              })()}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-medium">{currentMetrics.totalIdentifiedPurchases} cupons fiscais</div>
          </div>
        </div>
      </div>

      {/* Bento Grid: RFM 4 Main Quadrant Cards */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">Distribuição de Segmentos RFM</h3>
            <p className="text-[11px] text-slate-400">Classificação comportamental por Recência, Frequência e Valor</p>
          </div>
          <button 
            onClick={() => setCurrentView('rfm')}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-bold uppercase tracking-wider flex items-center gap-1"
          >
            Configurar Critérios <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Campeões */}
          <div 
            onClick={() => setCurrentView('rfm')}
            className="p-4 bg-emerald-50/70 hover:bg-emerald-50 rounded-xl border border-emerald-200/80 transition-all cursor-pointer group text-center"
          >
            <Trophy className="w-6 h-6 mx-auto mb-1.5 text-green-700" />
            <p className="text-xs font-bold text-emerald-800">Campeões</p>
            <p className="text-2xl font-black text-emerald-950 my-0.5">{currentMetrics.rfmCounts.champions}</p>
            <p className="text-[10px] text-emerald-600 font-medium">
              {((currentMetrics.rfmCounts.champions / Math.max(1, currentMetrics.totalCustomers)) * 100).toFixed(0)}% da base
            </p>
          </div>

          {/* Leais */}
          <div 
            onClick={() => setCurrentView('rfm')}
            className="p-4 bg-blue-50/70 hover:bg-blue-50 rounded-xl border border-blue-200/80 transition-all cursor-pointer group text-center"
          >
            <HeartHandshake className="w-6 h-6 mx-auto mb-1.5 text-emerald-700" />
            <p className="text-xs font-bold text-blue-800">Leais</p>
            <p className="text-2xl font-black text-blue-950 my-0.5">{currentMetrics.rfmCounts.loyal}</p>
            <p className="text-[10px] text-blue-600 font-medium">
              {((currentMetrics.rfmCounts.loyal / Math.max(1, currentMetrics.totalCustomers)) * 100).toFixed(0)}% da base
            </p>
          </div>

          {/* Em Risco */}
          <div 
            onClick={() => setCurrentView('rfm')}
            className="p-4 bg-amber-50/70 hover:bg-amber-50 rounded-xl border border-amber-200/80 transition-all cursor-pointer group text-center"
          >
            <AlertTriangle className="w-6 h-6 mx-auto mb-1.5 text-amber-600" />
            <p className="text-xs font-bold text-amber-800">Em Risco</p>
            <p className="text-2xl font-black text-amber-950 my-0.5">{currentMetrics.rfmCounts.atRisk}</p>
            <p className="text-[10px] text-amber-600 font-medium">
              {((currentMetrics.rfmCounts.atRisk / Math.max(1, currentMetrics.totalCustomers)) * 100).toFixed(0)}% da base
            </p>
          </div>

          {/* Perdidos */}
          <div 
            onClick={() => setCurrentView('rfm')}
            className="p-4 bg-rose-50/70 hover:bg-rose-50 rounded-xl border border-rose-200/80 transition-all cursor-pointer group text-center"
          >
            <TrendingDown className="w-6 h-6 mx-auto mb-1.5 text-rose-600" />
            <p className="text-xs font-bold text-rose-800">Perdidos</p>
            <p className="text-2xl font-black text-rose-950 my-0.5">{currentMetrics.rfmCounts.lost}</p>
            <p className="text-[10px] text-rose-600 font-medium">
              {((currentMetrics.rfmCounts.lost / Math.max(1, currentMetrics.totalCustomers)) * 100).toFixed(0)}% da base
            </p>
          </div>
        </div>
      </div>

      {/* Bento Grid: 3 Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart 1: Faturamento Identificado */}
        <div className="bento-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                Faturamento Identificado
              </h3>
              <p className="text-[11px] text-slate-400">Cupons com CPF identificado</p>
            </div>
            <span className="status-chip bg-campeao">
              +14.2% YoY
            </span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueChartData}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#153f9d" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#153f9d" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(val) => `R$${val/1000}k`} />
                <Tooltip 
                  formatter={(val: any) => [`R$ ${Number(val).toLocaleString('pt-BR')}`, 'Faturamento']}
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '10px', color: '#fff', fontSize: '11px', border: 'none' }}
                />
                <Area type="monotone" dataKey="faturamento" stroke="#153f9d" strokeWidth={2.5} fillOpacity={1} fill="url(#revenueGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Clientes Cadastrados */}
        <div className="bento-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                Evolução da Base
              </h3>
              <p className="text-[11px] text-slate-400">Total acumulado e novas adesões</p>
            </div>
            <span className="status-chip bg-leal">
              Astral Clube
            </span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={customerGrowthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '10px', color: '#fff', fontSize: '11px', border: 'none' }}
                />
                <Bar dataKey="total" name="Total Acumulado" fill="#153f9d" radius={[4, 4, 0, 0]} />
                <Bar dataKey="novos" name="Novos no Mês" fill="#12a957" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Distribuição RFM */}
        <div className="bento-card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                Distribuição RFM
              </h3>
              <p className="text-[11px] text-slate-400">Composição da base ativa</p>
            </div>
          </div>
          <div className="h-44">
            {rfmPieData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400">
                <p className="text-xs font-semibold text-slate-600">Nenhum cliente cadastrado</p>
                <p className="text-[11px] text-slate-400 mt-1">Os segmentos RFM serão gerados automaticamente conforme clientes reais comprarem.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={rfmPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={68}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {rfmPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(val: any, name: any) => [`${val} clientes`, name]}
                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '10px', color: '#fff', fontSize: '11px', border: 'none' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {rfmPieData.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-slate-600">
              {rfmPieData.map(item => (
                <span key={item.name} className="inline-flex items-center gap-1 font-semibold">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }}></span>
                  {item.name}: {item.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Oportunidades de Hoje Bento Card (Próxima Melhor Ação - NBA) */}
      <div className="bento-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h3 className="font-bold text-slate-800 text-sm">
                Oportunidades de Hoje (Próxima Melhor Ação - NBA)
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Recomendações comerciais inteligentes para recuperação, aniversário, boas-vindas e retenção VIP.
            </p>
          </div>

          <button
            onClick={() => setCurrentView('opportunities')}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 self-start"
          >
            Ver Todas as Oportunidades ({customers.length}) <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {nextBestActions.length === 0 ? (
            <div className="col-span-full py-8 text-center text-xs text-slate-400 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
              Aguardando clientes reais serem cadastrados ou importados via PDV para gerar oportunidades inteligentes de ação.
            </div>
          ) : (
            nextBestActions.map((nba) => {
              const urgencyBadge = nba.urgency === 'Alta' 
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : nba.urgency === 'Média'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-slate-50 text-slate-600 border-slate-200';

              return (
                <div 
                  key={nba.id}
                  className="bg-slate-50/80 hover:bg-white p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all flex flex-col justify-between shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                        {nba.category}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${urgencyBadge}`}>
                        {nba.urgency}
                      </span>
                    </div>

                    <div 
                      onClick={() => openCustomer360(nba.customerId)}
                      className="font-bold text-sm text-slate-800 hover:text-indigo-600 cursor-pointer flex items-center gap-1.5"
                    >
                      {nba.customerName}
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                    </div>

                    <div className="text-[11px] font-semibold text-slate-700 mt-1">
                      {nba.reason}
                    </div>

                    <div className="text-[11px] text-slate-500 mt-1 line-clamp-2 bg-white p-2 rounded-lg border border-slate-200/70">
                      <span className="font-medium text-slate-700">Evidência:</span> {nba.evidence}
                    </div>

                    <div className="text-xs text-indigo-900 bg-indigo-50/80 p-2 rounded-lg border border-indigo-100 mt-2.5 font-medium">
                      ✦ {nba.recommendedAction}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-200/60">
                    {nba.suggestedCouponCode && (
                      <span className="text-[10px] font-mono font-bold bg-slate-200/80 px-2 py-0.5 rounded text-slate-700 border border-slate-300/50">
                        {nba.suggestedCouponCode}
                      </span>
                    )}
                    <button
                      onClick={() => openCustomer360(nba.customerId)}
                      className="text-xs text-slate-700 hover:text-indigo-700 font-bold flex items-center gap-1 ml-auto"
                    >
                      Abrir 360 <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Bento Grid Split Section: Inactive >30 Days & Birthday Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Clientes > 30 dias sem comprar */}
        <div className="bento-card">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-slate-800 text-sm">
                Clientes há mais de 30 dias sem comprar
              </h3>
            </div>
            <span className="status-chip bg-em-risco">
              {customers.filter(c => c.daysSinceLastPurchase > 30).length} clientes
            </span>
          </div>

          <div className="space-y-2">
            {atRiskCustomers.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                Nenhum cliente em risco na base.
              </div>
            ) : (
              atRiskCustomers.map(c => {
                const rfmInfo = getRFMSegmentDetails(c.rfmSegment);
                return (
                  <div 
                    key={c.id}
                    onClick={() => openCustomer360(c.id)}
                    className="p-3 rounded-xl bg-slate-50/80 hover:bg-slate-100/70 border border-slate-200/70 transition-all flex items-center justify-between cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center justify-center">
                        {c.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800 group-hover:text-indigo-700">
                          {c.name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Última compra há <span className="font-semibold text-amber-600">{c.daysSinceLastPurchase} dias</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${rfmInfo.badgeColor}`}>
                        {c.rfmSegment}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-0.5 font-medium">
                        Gasto Total: R$ {c.totalSpent.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Clientes Aniversariantes */}
        <div className="bento-card">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Cake className="w-4 h-4 text-pink-500" />
              <h3 className="font-bold text-slate-800 text-sm">
                Aniversariantes do Mês
              </h3>
            </div>
            <span className="text-xs font-bold text-pink-600 bg-pink-50 px-2 py-0.5 rounded-full border border-pink-200">
              Presente Astral
            </span>
          </div>

          <div className="space-y-2">
            {birthdayCustomers.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">
                Nenhum aniversariante encontrado neste mês.
              </div>
            ) : (
              birthdayCustomers.map(c => (
                <div 
                  key={c.id}
                  onClick={() => openCustomer360(c.id)}
                  className="p-3 rounded-xl bg-slate-50/80 hover:bg-pink-50/50 border border-slate-200/70 hover:border-pink-200 transition-all flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-700 font-bold text-xs flex items-center justify-center">
                      🎂
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800 group-hover:text-pink-700">
                        {c.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Data: {c.birthDate?.split('-').reverse().join('/')} • {c.whatsapp}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-pink-100 text-pink-700 border border-pink-200">
                      Cupom Niver
                    </span>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-medium">
                      {c.consent?.whatsappMarketing ? 'WhatsApp Ativo' : 'Sem Opt-in'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
