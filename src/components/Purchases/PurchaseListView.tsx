import React, { useState, useMemo } from 'react';
import { 
  ShoppingCart, 
  Search, 
  Store as StoreIcon, 
  UploadCloud, 
  Download, 
  Eye, 
  Calendar, 
  CreditCard,
  ChevronDown,
  ChevronRight,
  Filter
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { Purchase } from '../../types/crm';
import { PDVImportModal } from './PDVImportModal';
import { recordBelongsToStore } from '../../services/storeAndLocationData';

export const PurchaseListView: React.FC = () => {
  const { 
    purchases, 
    stores, 
    openCustomer360, 
    isPDVImportModalOpen, 
    setIsPDVImportModalOpen,
    currentUser,
    showToast 
  } = useCRM();

  const [search, setSearch] = useState('');
  const [selectedStore, setSelectedStore] = useState('all');
  const [selectedPayment, setSelectedPayment] = useState('all');
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const filteredPurchases = useMemo(() => {
    const trimmed = search.trim();
    const hasSearch = trimmed.length > 0;
    const q = hasSearch ? trimmed.toLowerCase() : '';

    return purchases.filter(p => {
      if (hasSearch) {
        const matchName = p.customerName.toLowerCase().includes(q);
        const matchCpf = p.customerCpf ? p.customerCpf.includes(q) : false;
        const matchCupom = p.couponReceiptNumber.toLowerCase().includes(q);
        if (!matchName && !matchCpf && !matchCupom) return false;
      }

      if (!recordBelongsToStore(selectedStore, p.storeId, p.storeName)) {
        return false;
      }

      if (selectedPayment !== 'all' && p.paymentMethod !== selectedPayment) {
        return false;
      }

      return true;
    }).sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
  }, [purchases, search, selectedStore, selectedPayment]);

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / pageSize));
  const paginatedPurchases = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPurchases.slice(start, start + pageSize);
  }, [filteredPurchases, currentPage, pageSize]);

  const totalRevenue = useMemo(() => {
    return filteredPurchases.reduce((acc, p) => acc + (p.netAmount || 0), 0);
  }, [filteredPurchases]);

  const averageTicket = useMemo(() => {
    return filteredPurchases.length > 0 ? totalRevenue / filteredPurchases.length : 0;
  }, [filteredPurchases, totalRevenue]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Histórico de Vendas & PDV
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Registro consolidado de cupons fiscais identificados nos caixas do Super Astral Supermercados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {currentUser.role !== 'viewer' && (
            <button
              onClick={() => setIsPDVImportModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-emerald-600/20 transition-all"
            >
              <UploadCloud className="w-4 h-4" />
              Importar Vendas do PDV
            </button>
          )}
        </div>
      </div>

      {/* 3 Summary Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Faturamento Total Filtrado</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            R$ {totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">{filteredPurchases.length} cupons fiscais</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Ticket Médio Identificado</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">
            R$ {averageTicket.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Por compra com CPF</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Lojas Ativas</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">
            {stores.length} Unidades
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Centro, Vila Rachel, Bertolina</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por cliente, CPF ou nº cupom..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white outline-none"
            />
          </div>

          <div>
            <select
              value={selectedStore}
              onChange={e => setSelectedStore(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:bg-white outline-none cursor-pointer"
            >
              <option value="all">Todas as Lojas</option>
              {stores.map(st => (
                <option key={st.id} value={st.name}>{st.name}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={selectedPayment}
              onChange={e => setSelectedPayment(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:bg-white outline-none cursor-pointer"
            >
              <option value="all">Todas as Formas de Pagamento</option>
              <option value="PIX">PIX</option>
              <option value="Cartão Crédito">Cartão Crédito</option>
              <option value="Cartão Débito">Cartão Débito</option>
              <option value="Dinheiro">Dinheiro</option>
            </select>
          </div>
        </div>
      </div>

      {/* Purchases List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Cupom Fiscal</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Data e Hora</th>
                <th className="px-4 py-3">Loja & PDV</th>
                <th className="px-4 py-3">Pagamento</th>
                <th className="px-4 py-3 text-center">Itens</th>
                <th className="px-4 py-3 text-right">Valor Total</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    Nenhuma venda encontrada com os filtros informados.
                  </td>
                </tr>
              ) : (
                paginatedPurchases.map(p => {
                  const isExpanded = expandedPurchaseId === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr 
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                        onClick={() => setExpandedPurchaseId(isExpanded ? null : p.id)}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-slate-800">
                          {p.couponReceiptNumber}
                        </td>
                        <td className="px-4 py-3">
                          <div 
                            onClick={(e) => {
                              if (p.customerId) {
                                e.stopPropagation();
                                openCustomer360(p.customerId);
                              }
                            }}
                            className="font-bold text-slate-900 hover:text-emerald-600 flex items-center gap-1 cursor-pointer"
                          >
                            {p.customerName}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {p.customerCpf || 'Sem CPF'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {new Date(p.purchaseDate).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-medium">
                          {p.storeName} <span className="text-slate-400 font-normal">({p.posNumber})</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {p.paymentMethod}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-800">
                          {p.itemsCount}
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-slate-900">
                          R$ {p.netAmount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedPurchaseId(isExpanded ? null : p.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                          >
                            <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Items Drawer */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex justify-between">
                                <span>Produtos do Cupom ({p.items.length} itens)</span>
                                <span>Loja: {p.storeName} • Caixa: {p.posNumber}</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {p.items.map((it, idx) => (
                                   <div key={idx} className="p-2 bg-slate-50 rounded-lg text-xs flex justify-between">
                                    <div>
                                      <span className="font-bold text-slate-800 block">{it.productName}</span>
                                      <span className="text-[10px] text-slate-400">
                                        SKU: {it.sku} • {it.category} ({it.quantity} x R$ {it.unitPrice.toFixed(2)})
                                      </span>
                                    </div>
                                    <span className="font-bold text-slate-900 self-center">
                                      R$ {it.totalPrice.toFixed(2)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        {filteredPurchases.length > 0 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>Exibindo <strong>{(currentPage - 1) * pageSize + 1}</strong> a <strong>{Math.min(currentPage * pageSize, filteredPurchases.length)}</strong> de <strong>{filteredPurchases.length}</strong> cupons</span>
              <span className="text-slate-300">|</span>
              <label className="flex items-center gap-1 text-slate-500">
                Linhas por página:
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs text-slate-700 font-semibold cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-700 font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Primeira
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-700 font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              
              <span className="px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded font-bold">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-700 font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Próxima
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-700 font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Última
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
