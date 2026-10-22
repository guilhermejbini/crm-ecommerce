import React, { useState, useMemo } from 'react';
import { 
  Crown, 
  Settings2, 
  RefreshCw, 
  Users, 
  TrendingUp, 
  DollarSign, 
  AlertTriangle, 
  Eye, 
  ArrowRight,
  Sparkles,
  ChevronRight,
  Layers
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { useCRM } from '../../context/CRMContext';
import { RFMSegmentType, RFMConfig } from '../../types/crm';
import { RFM_SEGMENTS_INFO, getRFMSegmentDetails, RFM_THRESHOLDS_PENDING_CALIBRATION, RFM_WINDOW_DAYS, getRFMWindowDays } from '../../services/rfmCalculator';

export const RFMSegmentationView: React.FC = () => {
  const { 
    customers, 
    rfmConfig, 
    handleUpdateRFMConfig, 
    handleRecalculateRFM, 
    openCustomer360, 
    setCurrentView,
    showToast 
  } = useCRM();

  const [selectedSegmentKey, setSelectedSegmentKey] = useState<RFMSegmentType | 'all'>('CAMPEÕES');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Local config form state with fallback
  const [tempConfig, setTempConfig] = useState<RFMConfig>(rfmConfig || {
    recencyDaysThresholds: [15, 30, 60, 90],
    frequencyThresholds: [2, 5, 10, 20],
    monetaryThresholds: [200, 600, 1500, 3500],
    periodMonths: 3,
    windowDays: 90
  });

  // Calculate stats for all segments
  const segmentStats = useMemo(() => {
    const map = new Map<RFMSegmentType, { count: number; totalRevenue: number; totalPurchases: number }>();
    
    Object.keys(RFM_SEGMENTS_INFO).forEach(seg => {
      map.set(seg as RFMSegmentType, { count: 0, totalRevenue: 0, totalPurchases: 0 });
    });

    let totalRev = 0;
    customers.forEach(c => {
      totalRev += c.totalSpent || 0;
      const cur = map.get(c.rfmSegment) || { count: 0, totalRevenue: 0, totalPurchases: 0 };
      cur.count += 1;
      cur.totalRevenue += c.totalSpent || 0;
      cur.totalPurchases += c.totalPurchases || 0;
      map.set(c.rfmSegment, cur);
    });

    return Object.entries(RFM_SEGMENTS_INFO).map(([key, info]) => {
      const data = map.get(key as RFMSegmentType) || { count: 0, totalRevenue: 0, totalPurchases: 0 };
      const avgTicket = data.totalPurchases > 0 ? data.totalRevenue / data.totalPurchases : 0;
      const pctCustomers = customers.length > 0 ? (data.count / customers.length) * 100 : 0;
      const pctRevenue = totalRev > 0 ? (data.totalRevenue / totalRev) * 100 : 0;

      return {
        key: key as RFMSegmentType,
        ...info,
        count: data.count,
        totalRevenue: data.totalRevenue,
        avgTicket,
        pctCustomers: parseFloat(pctCustomers.toFixed(1)),
        pctRevenue: parseFloat(pctRevenue.toFixed(1))
      };
    });
  }, [customers]);

  const chartData = useMemo(() => {
    return segmentStats.map(s => ({
      name: s.name,
      clientes: s.count,
      faturamento: parseFloat(s.totalRevenue.toFixed(0)),
      color: s.dotColor.replace('bg-', '')
    }));
  }, [segmentStats]);

  const selectedCustomers = useMemo(() => {
    if (selectedSegmentKey === 'all') return customers;
    return customers.filter(c => c.rfmSegment === selectedSegmentKey);
  }, [customers, selectedSegmentKey]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleUpdateRFMConfig(tempConfig);
    setIsConfigOpen(false);
  };

  const handleRecalculate = async () => {
    setIsRecalculating(true);
    await handleRecalculateRFM();
    setIsRecalculating(false);
  };

  const segmentColors = ['#12a957', '#2e58bc', '#0d944b', '#5b80d6', '#f59e0b', '#f97316', '#ef4444', '#8eaae6', '#64748b', '#e11d48'];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Segmentação RFM (Recência, Frequência e Valor)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Classificação inteligente da base de clientes do Super Astral para automação de ofertas e retenção.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsConfigOpen(!isConfigOpen)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-xs transition-colors"
          >
            <Settings2 className="w-4 h-4 text-slate-500" />
            Ajustar Parâmetros RFM
          </button>
          <button
            onClick={handleRecalculate}
            disabled={isRecalculating}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-emerald-600/20 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${isRecalculating ? 'animate-spin' : ''}`} />
            Recalcular Base
          </button>
        </div>
      </div>

      {/* RFM Parameter Config Drawer / Modal */}
      {isConfigOpen && (
        <form onSubmit={handleSaveConfig} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-lg space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-emerald-600" />
              Configuração de Faixas e Pesos da Matriz RFM
            </h3>
            <button
              type="button"
              onClick={() => setIsConfigOpen(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Fechar
            </button>
          </div>

          {RFM_THRESHOLDS_PENDING_CALIBRATION && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold">Aviso de Calibração:</span> Os thresholds atuais de Frequência e Valor Monetário foram estruturados para histórico acumulado e estão marcados para calibração comercial com base na janela móvel.
              </div>
            </div>
          )}

          {/* Janela Móvel Config */}
          <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Janela Móvel RFM (Frequência & Monetário)
              </div>
              <div className="text-[11px] text-emerald-800 mt-0.5">
                Compras realizadas dentro desta janela definem a frequência e o valor recente do cliente. Compras anteriores são preservadas no histórico vitalício.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-[11px] font-semibold text-emerald-900">Janela (Dias):</label>
              <input
                type="number"
                min={30}
                max={365}
                value={tempConfig.windowDays || (tempConfig.periodMonths ? tempConfig.periodMonths * 30 : RFM_WINDOW_DAYS)}
                onChange={e => {
                  const val = Math.max(30, +e.target.value || RFM_WINDOW_DAYS);
                  setTempConfig({ ...tempConfig, windowDays: val, periodMonths: Math.round(val / 30) });
                }}
                className="w-24 p-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-center text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            {/* Recency Thresholds */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-2">
              <div className="font-bold text-slate-800">Recência (Faixas em Dias)</div>
              <div>
                <label className="text-[11px] text-slate-500">Score 5 (Excelente): até dias</label>
                <input
                  type="number"
                  value={tempConfig.recencyDaysThresholds[0]}
                  onChange={e => {
                    const next = [...tempConfig.recencyDaysThresholds] as [number, number, number, number];
                    next[0] = +e.target.value;
                    setTempConfig({ ...tempConfig, recencyDaysThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 4: até dias</label>
                <input
                  type="number"
                  value={tempConfig.recencyDaysThresholds[1]}
                  onChange={e => {
                    const next = [...tempConfig.recencyDaysThresholds] as [number, number, number, number];
                    next[1] = +e.target.value;
                    setTempConfig({ ...tempConfig, recencyDaysThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 3: até dias</label>
                <input
                  type="number"
                  value={tempConfig.recencyDaysThresholds[2]}
                  onChange={e => {
                    const next = [...tempConfig.recencyDaysThresholds] as [number, number, number, number];
                    next[2] = +e.target.value;
                    setTempConfig({ ...tempConfig, recencyDaysThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 2: até dias</label>
                <input
                  type="number"
                  value={tempConfig.recencyDaysThresholds[3]}
                  onChange={e => {
                    const next = [...tempConfig.recencyDaysThresholds] as [number, number, number, number];
                    next[3] = +e.target.value;
                    setTempConfig({ ...tempConfig, recencyDaysThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
            </div>

            {/* Frequency Thresholds */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-2">
              <div className="font-bold text-slate-800">Frequência (Faixas de Compras)</div>
              <div>
                <label className="text-[11px] text-slate-500">Score 2: a partir de</label>
                <input
                  type="number"
                  value={tempConfig.frequencyThresholds[0]}
                  onChange={e => {
                    const next = [...tempConfig.frequencyThresholds] as [number, number, number, number];
                    next[0] = +e.target.value;
                    setTempConfig({ ...tempConfig, frequencyThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 3: a partir de</label>
                <input
                  type="number"
                  value={tempConfig.frequencyThresholds[1]}
                  onChange={e => {
                    const next = [...tempConfig.frequencyThresholds] as [number, number, number, number];
                    next[1] = +e.target.value;
                    setTempConfig({ ...tempConfig, frequencyThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 4: a partir de</label>
                <input
                  type="number"
                  value={tempConfig.frequencyThresholds[2]}
                  onChange={e => {
                    const next = [...tempConfig.frequencyThresholds] as [number, number, number, number];
                    next[2] = +e.target.value;
                    setTempConfig({ ...tempConfig, frequencyThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 5: a partir de</label>
                <input
                  type="number"
                  value={tempConfig.frequencyThresholds[3]}
                  onChange={e => {
                    const next = [...tempConfig.frequencyThresholds] as [number, number, number, number];
                    next[3] = +e.target.value;
                    setTempConfig({ ...tempConfig, frequencyThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
            </div>

            {/* Monetary Thresholds */}
            <div className="p-3 bg-slate-50 rounded-xl space-y-2">
              <div className="font-bold text-slate-800">Monetário (Faixas de Valor R$)</div>
              <div>
                <label className="text-[11px] text-slate-500">Score 2: a partir de R$</label>
                <input
                  type="number"
                  value={tempConfig.monetaryThresholds[0]}
                  onChange={e => {
                    const next = [...tempConfig.monetaryThresholds] as [number, number, number, number];
                    next[0] = +e.target.value;
                    setTempConfig({ ...tempConfig, monetaryThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 3: a partir de R$</label>
                <input
                  type="number"
                  value={tempConfig.monetaryThresholds[1]}
                  onChange={e => {
                    const next = [...tempConfig.monetaryThresholds] as [number, number, number, number];
                    next[1] = +e.target.value;
                    setTempConfig({ ...tempConfig, monetaryThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 4: a partir de R$</label>
                <input
                  type="number"
                  value={tempConfig.monetaryThresholds[2]}
                  onChange={e => {
                    const next = [...tempConfig.monetaryThresholds] as [number, number, number, number];
                    next[2] = +e.target.value;
                    setTempConfig({ ...tempConfig, monetaryThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Score 5: a partir de R$</label>
                <input
                  type="number"
                  value={tempConfig.monetaryThresholds[3]}
                  onChange={e => {
                    const next = [...tempConfig.monetaryThresholds] as [number, number, number, number];
                    next[3] = +e.target.value;
                    setTempConfig({ ...tempConfig, monetaryThresholds: next });
                  }}
                  className="w-full p-1.5 bg-white border border-slate-200 rounded mt-0.5"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsConfigOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl"
            >
              Salvar & Recalcular Base
            </button>
          </div>
        </form>
      )}

      {/* Visual Charts: Distribution of customers & Revenue by Segment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bento-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-sm">
              Distribuição de Clientes por Segmento RFM
            </h3>
            <span className="status-chip bg-campeao">Base Total</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '10px', color: '#fff', fontSize: '11px', border: 'none' }}
                />
                <Bar dataKey="clientes" fill="#153f9d" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={segmentColors[index % segmentColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bento-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-sm">
              Faturamento Total por Segmento (R$)
            </h3>
            <span className="status-chip bg-leal">Receita PDV</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `R$${v}`} />
                <Tooltip 
                  formatter={(v: any) => [`R$ ${Number(v).toLocaleString('pt-BR')}`, 'Faturamento']} 
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '10px', color: '#fff', fontSize: '11px', border: 'none' }}
                />
                <Bar dataKey="faturamento" fill="#0f172a" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-f-${index}`} fill={segmentColors[index % segmentColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Segment Cards Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
        {segmentStats.map(s => {
          const isSelected = selectedSegmentKey === s.key;
          return (
            <div
              key={s.key}
              onClick={() => setSelectedSegmentKey(s.key)}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? 'bg-indigo-50/70 border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
                  : 'bento-card hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${s.badgeColor}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dotColor}`}></span>
                  {s.name}
                </span>
                <span className="text-xs font-bold text-slate-800">
                  {s.count} clientes
                </span>
              </div>

              <p className="text-[11px] text-slate-600 mt-2 line-clamp-2">
                {s.description}
              </p>

              <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Faturamento</span>
                  <span className="font-bold text-slate-900 text-sm">R$ {s.totalRevenue.toFixed(0)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Ticket Médio</span>
                  <span className="font-bold text-indigo-600 text-sm">R$ {s.avgTicket.toFixed(2)}</span>
                </div>
              </div>

              <div className="mt-2.5 text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
                <span className="font-semibold text-slate-800">Ação:</span> {s.recommendedAction}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Segment Customer Table */}
      <div className="bento-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Clientes no Segmento: <span className="text-indigo-700">{selectedSegmentKey}</span>
            </h3>
            <p className="text-xs text-slate-400">
              {selectedCustomers.length} clientes identificados no critério de compra
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50/80 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Nome do Cliente</th>
                <th className="px-4 py-2.5">CPF & WhatsApp</th>
                <th className="px-4 py-2.5 text-center">Score R-F-M</th>
                <th className="px-4 py-2.5 text-right">Gasto Total</th>
                <th className="px-4 py-2.5 text-center">Compras</th>
                <th className="px-4 py-2.5 text-center">Última Compra</th>
                <th className="px-4 py-2.5 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selectedCustomers.slice(0, 15).map(c => (
                <tr
                  key={c.id}
                  onClick={() => openCustomer360(c.id)}
                  className="hover:bg-indigo-50/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 font-bold text-slate-900">{c.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">{c.cpf} • {c.whatsapp}</td>
                  <td className="px-4 py-2.5 text-center font-mono font-bold text-indigo-700">
                    R:{c.recencyScore} F:{c.frequencyScore} M:{c.monetaryScore}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900">R$ {c.totalSpent.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{c.totalPurchases}</td>
                  <td className="px-4 py-2.5 text-center text-slate-600">
                    {c.daysSinceLastPurchase === 0 ? 'Hoje' : `há ${c.daysSinceLastPurchase} dias`}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openCustomer360(c.id);
                      }}
                      className="p-1 text-slate-400 hover:text-indigo-600"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
