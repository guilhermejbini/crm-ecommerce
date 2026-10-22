import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, RefreshCw, Search, Truck, Store as StoreIcon, ExternalLink, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { canImport } from '../../utils/permissions';
import { getStoreLabel } from '../../services/storeAndLocationData';
import {
  getOnlineOrders,
  planOnlineOrdersSync,
  syncOnlineOrders,
  ONLINE_STATUS_LABEL,
  OnlineSyncResult,
  ShopOrder,
  ShopOrderStatus
} from '../../services/onlineOrders';

const STATUS_STYLE: Record<ShopOrderStatus, string> = {
  recebido: 'bg-blue-50 text-blue-700 border-blue-200',
  separando: 'bg-amber-50 text-amber-800 border-amber-200',
  pronto_retirada: 'bg-teal-50 text-teal-800 border-teal-200',
  saiu_entrega: 'bg-teal-50 text-teal-800 border-teal-200',
  concluido: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelado: 'bg-rose-50 text-rose-700 border-rose-200'
};

const money = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const OnlineOrdersView: React.FC = () => {
  const { customers, currentUser, openCustomer360, refreshData, showToast } = useCRM();
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<OnlineSyncResult | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ShopOrderStatus>('all');
  const allowSync = canImport(currentUser.role);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setOrders(await getOnlineOrders());
    } catch (err: any) {
      const denied = err?.code === 'permission-denied';
      setLoadError(denied
        ? 'Sem permissão para ler os pedidos da loja. Publique as regras atualizadas do Firestore (coleção shop_orders) e entre como gestor ou administrador.'
        : 'Não foi possível carregar os pedidos da loja online.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pedido -> cliente do CRM e o que ainda falta sincronizar (cálculo local, sem gravar nada)
  const plan = useMemo(() => planOnlineOrdersSync(orders, customers), [orders, customers]);
  const customerIds = useMemo(() => new Set(customers.map(c => c.id)), [customers]);
  const pendingCustomers = plan.newCustomersCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return orders
      .filter(o => status === 'all' || o.status === status)
      .filter(o => {
        if (!q) return true;
        return (o.code || '').toLowerCase().includes(q)
          || (o.customer?.name || '').toLowerCase().includes(q)
          || (!!qDigits && ((o.customer?.phone || '').includes(qDigits) || (o.customer?.cpf || '').includes(qDigits)));
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [orders, search, status]);

  const stats = useMemo(() => {
    const done = orders.filter(o => o.status === 'concluido');
    const open = orders.filter(o => o.status !== 'concluido' && o.status !== 'cancelado');
    const revenue = done.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    return { done: done.length, open: open.length, revenue, ticket: done.length ? revenue / done.length : 0 };
  }, [orders]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncOnlineOrders(currentUser, orders);
      setLastSync(result);
      await refreshData({ forceRefresh: true });
      showToast(
        `Loja online: ${result.newCustomersCount} clientes novos, ${result.updatedCustomersCount} cadastros completados e ${result.purchasesImported} compras gravadas.`,
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || 'Falha ao sincronizar os pedidos da loja online.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">Pedidos da Loja Online</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Pedidos feitos em loja.superastral.com.br. Quem compra vira cliente do CRM e cada pedido concluído entra como compra (RFM e Cliente 360).
            A separação e o status dos pedidos continuam no painel da loja.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar lista
          </button>
          {allowSync && (
            <button
              onClick={handleSync}
              disabled={syncing || loading || !!loadError}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-emerald-600/20 transition-all disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Levar pedidos para o CRM
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bento-card-compact">
          <div className="metric-label">Em andamento</div>
          <div className="metric-value">{stats.open}</div>
        </div>
        <div className="bento-card-compact">
          <div className="metric-label">Concluídos</div>
          <div className="metric-value">{stats.done}</div>
        </div>
        <div className="bento-card-compact">
          <div className="metric-label">Faturamento concluído</div>
          <div className="metric-value">{money(stats.revenue)}</div>
        </div>
        <div className="bento-card-compact">
          <div className="metric-label">Ticket médio</div>
          <div className="metric-value">{money(stats.ticket)}</div>
        </div>
      </div>

      {!loading && !loadError && allowSync && pendingCustomers > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{pendingCustomers} cliente(s) da loja online ainda não estão no CRM. Clique em "Levar pedidos para o CRM".</span>
        </div>
      )}

      {lastSync && (
        <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs space-y-1">
          <div className="font-bold">Última sincronização</div>
          <div>
            {lastSync.ordersRead} pedidos lidos · {lastSync.newCustomersCount} clientes novos · {lastSync.updatedCustomersCount} cadastros completados ·{' '}
            {lastSync.purchasesImported} compras gravadas · {lastSync.purchasesAlreadyInCRM} já estavam no CRM
          </div>
          {lastSync.skippedOrders.length > 0 && (
            <div className="text-amber-800">
              Não identificados: {lastSync.skippedOrders.map(s => `${s.code} (${s.reason})`).join('; ')}
            </div>
          )}
        </div>
      )}

      <div className="bento-card space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por código, nome, celular ou CPF"
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as any)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
          >
            <option value="all">Todos os status</option>
            {(Object.keys(ONLINE_STATUS_LABEL) as ShopOrderStatus[]).map(s => (
              <option key={s} value={s}>{ONLINE_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : loadError ? (
          <div className="py-10 text-center text-sm text-rose-700">{loadError}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            {orders.length === 0 ? 'Nenhum pedido online ainda.' : 'Nenhum pedido com esses filtros.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-bold">Pedido</th>
                  <th className="py-2 pr-3 font-bold">Data</th>
                  <th className="py-2 pr-3 font-bold">Cliente</th>
                  <th className="py-2 pr-3 font-bold">Recebimento</th>
                  <th className="py-2 pr-3 font-bold">Status</th>
                  <th className="py-2 pr-3 font-bold text-right">Total</th>
                  <th className="py-2 font-bold text-right">CRM</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const custId = plan.customerIdByOrder.get(o.code);
                  const inCrm = !!custId && customerIds.has(custId);
                  return (
                    <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                      <td className="py-2.5 pr-3 font-mono font-bold text-slate-800">{o.code}</td>
                      <td className="py-2.5 pr-3 text-slate-600 whitespace-nowrap">{dateTime(o.createdAt)}</td>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-800">{o.customer?.name || '-'}</div>
                        <div className="text-[11px] text-slate-500">{o.customer?.cpf ? 'Com CPF' : 'Sem CPF'} · {o.items?.length || 0} itens</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          {o.mode === 'entrega' ? <Truck className="w-3.5 h-3.5" /> : <StoreIcon className="w-3.5 h-3.5" />}
                          {o.mode === 'entrega' ? 'Entrega' : 'Retirada'} · {getStoreLabel(o.storeId) || o.storeId}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`status-chip border ${STATUS_STYLE[o.status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                          {ONLINE_STATUS_LABEL[o.status] || o.status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-bold text-slate-800 whitespace-nowrap">
                        {money(o.total)}{o.hasEstimates ? <span className="text-[10px] text-slate-400 font-normal"> (estimado)</span> : null}
                      </td>
                      <td className="py-2.5 text-right">
                        {inCrm ? (
                          <button
                            onClick={() => openCustomer360(custId!)}
                            className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold"
                          >
                            Cliente 360 <ExternalLink className="w-3 h-3" />
                          </button>
                        ) : (
                          <span className="text-slate-400">Ainda não</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
