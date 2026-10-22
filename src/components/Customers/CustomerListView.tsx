import React, { useState, useMemo } from 'react';
import { 
  Users, 
  Search, 
  Filter, 
  UserPlus, 
  Download, 
  MessageSquare, 
  Shield, 
  Eye, 
  Edit, 
  Trash2, 
  ChevronRight, 
  Crown, 
  CheckCircle2, 
  AlertTriangle, 
  UserMinus,
  Sparkles,
  PhoneCall,
  Lock,
  ArrowUpDown,
  FileSpreadsheet
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { Customer, RFMSegmentType } from '../../types/crm';
import { getRFMSegmentDetails } from '../../services/rfmCalculator';
import { CustomerModal } from './CustomerModal';
import { canImport, canWriteCustomers, canEditCustomer } from '../../utils/permissions';

export const CustomerListView: React.FC = () => {
  const { 
    customers, 
    openCustomer360, 
    handleDeleteCustomer, 
    handleAnonymizeCustomer, 
    setIsNewCustomerModalOpen, 
    isNewCustomerModalOpen,
    setIsCustomerImportModalOpen,
    currentUser,
    showToast 
  } = useCRM();

  const [search, setSearch] = useState('');
  const [selectedSegment, setSelectedSegment] = useState<string>('all');
  const [selectedOptIn, setSelectedOptIn] = useState<string>('all');
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string>('all');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'totalSpent' | 'totalPurchases' | 'daysSinceLastPurchase' | 'name'>('totalSpent');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Extract unique neighborhoods
  const neighborhoods = useMemo(() => {
    const set = new Set<string>();
    customers.forEach(c => {
      if (c.neighborhood) set.add(c.neighborhood);
    });
    return Array.from(set).sort();
  }, [customers]);

  // Reset to page 1 on filter changes
  const handleFilterChange = (setter: React.Dispatch<React.SetStateAction<any>>, value: any) => {
    setter(value);
    setCurrentPage(1);
  };

  // Filter & Search Logic
  const filteredCustomers = useMemo(() => {
    const trimmed = search.trim();
    const hasSearch = trimmed.length > 0;
    const searchLower = hasSearch ? trimmed.toLowerCase() : '';
    const qDigits = hasSearch ? searchLower.replace(/[^a-z0-9]/g, '') : '';

    return customers.filter(c => {
      // Search text
      if (hasSearch) {
        const nameMatch = c.name.toLowerCase().includes(searchLower);
        const cpfMatch = c.cpf ? c.cpf.replace(/[^0-9]/g, '').includes(qDigits) : false;
        const phoneMatch = c.whatsapp ? c.whatsapp.replace(/[^0-9]/g, '').includes(qDigits) : false;
        const emailMatch = c.email ? c.email.toLowerCase().includes(searchLower) : false;
        if (!nameMatch && !cpfMatch && !phoneMatch && !emailMatch) return false;
      }

      // Segment filter
      if (selectedSegment !== 'all' && c.rfmSegment !== selectedSegment) {
        return false;
      }

      // Opt-in filter
      if (selectedOptIn === 'whatsapp_yes' && !c.consent?.whatsappMarketing) return false;
      if (selectedOptIn === 'whatsapp_no' && c.consent?.whatsappMarketing) return false;

      // Neighborhood filter
      if (selectedNeighborhood !== 'all' && c.neighborhood !== selectedNeighborhood) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      let valA: any = a[sortBy] ?? 0;
      let valB: any = b[sortBy] ?? 0;
      if (typeof valA === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });
  }, [customers, search, selectedSegment, selectedOptIn, selectedNeighborhood, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCustomers.slice(start, start + pageSize);
  }, [filteredCustomers, currentPage, pageSize]);

  const handleExportCSV = () => {
    const headers = ['ID', 'Nome', 'CPF', 'WhatsApp', 'Email', 'Bairro', 'Segmento RFM', 'Gasto Total', 'Compras', 'Ticket Médio', 'Última Compra (Dias)', 'Opt-in WhatsApp'];
    const rows = filteredCustomers.map(c => [
      c.id,
      `"${c.name}"`,
      c.cpf || '',
      c.whatsapp || '',
      c.email || '',
      c.neighborhood || '',
      c.rfmSegment,
      c.totalSpent.toFixed(2),
      c.totalPurchases,
      c.averageTicket.toFixed(2),
      c.daysSinceLastPurchase,
      c.consent?.whatsappMarketing ? 'SIM' : 'NÃO'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `clientes_super_astral_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Base de clientes exportada com sucesso!', 'success');
  };

  const handleEdit = (cust: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCustomer(cust);
    setIsEditModalOpen(true);
  };

  const handleDelete = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Tem certeza que deseja excluir o cliente ${name}?`)) {
      await handleDeleteCustomer(id);
    }
  };

  const handleAnonymize = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Executar direito ao esquecimento LGPD para ${name}? Todos os dados pessoais serão anonimizados irreversivelmente mantendo apenas dados estatísticos de compras.`)) {
      await handleAnonymizeCustomer(id);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Gestão da Base de Clientes
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Central de cadastro, segmentação RFM, consentimentos LGPD e visão 360 do Super Astral Supermercados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canImport(currentUser.role) && (
            <button
              onClick={() => setIsCustomerImportModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl shadow-xs transition-colors"
              title="Importar base de clientes via arquivo Excel / Flex"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              Importar Excel (Flex)
            </button>
          )}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-xs transition-colors"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Exportar CSV
          </button>
          {canWriteCustomers(currentUser.role) && (
            <button
              onClick={() => setIsNewCustomerModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-emerald-600/20 transition-all"
            >
              <UserPlus className="w-4 h-4" />
              Cadastrar Cliente
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search Box */}
          <div className="md:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por nome, CPF, WhatsApp, e-mail..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
            />
          </div>

          {/* Segment Filter */}
          <div>
            <select
              value={selectedSegment}
              onChange={e => setSelectedSegment(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none cursor-pointer"
            >
              <option value="all">Todos os Segmentos RFM</option>
              <option value="CAMPEÕES">Campeões</option>
              <option value="LEAIS">⭐ Leais</option>
              <option value="POTENCIAIS LEAIS">Potenciais Leais</option>
              <option value="PROMISSORES">Promissores</option>
              <option value="NOVOS">Novos</option>
              <option value="PRECISAM DE ATENÇÃO">Precisam de Atenção</option>
              <option value="EM RISCO">Em Risco (31-60d)</option>
              <option value="PRESTES A DORMIR">Prestes a Dormir</option>
              <option value="HIBERNANDO">Hibernando</option>
              <option value="PERDIDOS">Perdidos (&gt;90d)</option>
              <option value="UNCLASSIFIED">Não Classificados</option>
            </select>
          </div>

          {/* Opt-in WhatsApp Filter */}
          <div>
            <select
              value={selectedOptIn}
              onChange={e => setSelectedOptIn(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none cursor-pointer"
            >
              <option value="all">Opt-in WhatsApp (Todos)</option>
              <option value="whatsapp_yes">Com Opt-in Autorizado</option>
              <option value="whatsapp_no">Sem Opt-in de Marketing</option>
            </select>
          </div>
        </div>

        {/* Quick Filter Badges & Sort */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <span className="font-medium">Exibindo:</span>
            <span className="font-bold text-slate-800">{filteredCustomers.length}</span>
            <span>de {customers.length} clientes</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-slate-400">Ordenar por:</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-semibold cursor-pointer"
            >
              <option value="totalSpent">Maior Faturamento</option>
              <option value="totalPurchases">Mais Compras</option>
              <option value="daysSinceLastPurchase">Recência (Dias sem compra)</option>
              <option value="name">Nome (A-Z)</option>
            </select>

            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-1 text-slate-500 hover:text-slate-800 rounded bg-slate-100 hover:bg-slate-200"
              title="Inverter ordem"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">CPF & Contato</th>
                <th className="px-4 py-3">Segmento RFM</th>
                <th className="px-4 py-3 text-right">Total Gasto</th>
                <th className="px-4 py-3 text-center">Compras</th>
                <th className="px-4 py-3 text-right">Ticket Médio</th>
                <th className="px-4 py-3 text-center">Última Compra</th>
                <th className="px-4 py-3 text-center">Opt-in LGPD</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-slate-500">
                    <div className="max-w-md mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center mx-auto text-xl">
                        👥
                      </div>
                      <div className="font-bold text-sm text-slate-800">
                        {customers.length === 0 ? 'Base Pronta para Receber Clientes Reais' : 'Nenhum cliente encontrado com os filtros selecionados'}
                      </div>
                      <p className="text-xs text-slate-400">
                        {customers.length === 0 
                          ? 'Os registros fictícios foram removidos com sucesso. As 3 unidades do Super Astral permanecem cadastradas e operacionais.'
                          : 'Tente alterar os termos de busca ou os filtros aplicados acima.'}
                      </p>
                      {customers.length === 0 && (
                        <button
                          onClick={() => setIsNewCustomerModalOpen(true)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                        >
                          <UserPlus className="w-4 h-4" />
                          Cadastrar Primeiro Cliente Real
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedCustomers.map(c => {
                  const rfmDetails = getRFMSegmentDetails(c.rfmSegment);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openCustomer360(c.id)}
                      className="hover:bg-emerald-50/40 cursor-pointer transition-colors group"
                    >
                      {/* Cliente */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 group-hover:bg-emerald-600 group-hover:text-white text-slate-700 font-bold flex items-center justify-center transition-colors">
                            {c.isAnonymized ? '🔒' : c.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 group-hover:text-emerald-700 flex items-center gap-1.5">
                              {c.name}
                              {c.isAnonymized && (
                                <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono">
                                  ANONIMIZADO
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {c.neighborhood || 'Bairro não inf.'} • {c.origin}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* CPF & WhatsApp */}
                      <td className="px-4 py-3">
                        <div className="font-mono text-[11px] text-slate-700">{c.cpf}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MessageSquare className="w-3 h-3 text-teal-600" />
                          {c.whatsapp}
                        </div>
                      </td>

                      {/* RFM */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${rfmDetails.badgeColor}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${rfmDetails.dotColor}`}></span>
                          {c.rfmSegment}
                        </span>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Score: R{c.recencyScore} F{c.frequencyScore} M{c.monetaryScore}
                        </div>
                      </td>

                      {/* Total Gasto */}
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        R$ {c.totalSpent.toFixed(2)}
                      </td>

                      {/* Compras */}
                      <td className="px-4 py-3 text-center font-semibold text-slate-700">
                        {c.totalPurchases}
                      </td>

                      {/* Ticket Médio */}
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">
                        R$ {c.averageTicket.toFixed(2)}
                      </td>

                      {/* Recência */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`text-xs font-semibold ${
                            c.daysSinceLastPurchase <= 15
                              ? 'text-emerald-600 font-bold'
                              : c.daysSinceLastPurchase <= 30
                              ? 'text-blue-600'
                              : c.daysSinceLastPurchase <= 60
                              ? 'text-amber-600 font-bold'
                              : 'text-rose-600 font-bold'
                          }`}
                        >
                          {c.daysSinceLastPurchase === 0 ? 'Hoje' : `há ${c.daysSinceLastPurchase} dias`}
                        </span>
                      </td>

                      {/* Consentimentos LGPD */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span
                            title={c.consent?.whatsappMarketing ? 'WhatsApp Autorizado' : 'WhatsApp Não Autorizado'}
                            className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                              c.consent?.whatsappMarketing ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            WA
                          </span>
                          <span
                            title={c.consent?.emailMarketing ? 'E-mail Autorizado' : 'E-mail Não Autorizado'}
                            className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                              c.consent?.emailMarketing ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            EM
                          </span>
                        </div>
                      </td>

                      {/* Ações */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              openCustomer360(c.id);
                            }}
                            title="Abrir Cliente 360"
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          
                          {canEditCustomer(currentUser.role, c) && (
                            <button
                              onClick={e => handleEdit(c, e)}
                              title="Editar Cadastro"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}

                          {currentUser.role === 'admin' && !c.isAnonymized && (
                            <button
                              onClick={e => handleAnonymize(c.id, c.name, e)}
                              title="Anonimizar LGPD (Direito ao Esquecimento)"
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            >
                              <Lock className="w-4 h-4" />
                            </button>
                          )}

                          {currentUser.role === 'admin' && (
                            <button
                              onClick={e => handleDelete(c.id, c.name, e)}
                              title="Excluir Cliente"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        {filteredCustomers.length > 0 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>Exibindo <strong>{(currentPage - 1) * pageSize + 1}</strong> a <strong>{Math.min(currentPage * pageSize, filteredCustomers.length)}</strong> de <strong>{filteredCustomers.length}</strong> clientes</span>
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

      {/* Modals */}
      <CustomerModal
        customer={editingCustomer}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingCustomer(null);
        }}
      />
    </div>
  );
};
