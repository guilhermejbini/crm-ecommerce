import React, { useState, useMemo } from 'react';
import { 
  Headphones, 
  Search, 
  Plus, 
  MessageSquare, 
  Phone, 
  Mail, 
  Store, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Eye,
  User
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { getRecordStoreId, getStoreLabel } from '../../services/storeAndLocationData';
import { Interaction, InteractionStatus, InteractionType, InteractionChannel } from '../../types/crm';

export const SupportTicketsView: React.FC = () => {
  const { interactions, customers, openCustomer360, handleSaveInteraction, currentUser, showToast } = useCRM();

  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New ticket state
  const [customerId, setCustomerId] = useState('');
  const [subject, setSubject] = useState('');
  const [channel, setChannel] = useState<InteractionChannel>('WhatsApp');
  const [type, setType] = useState<InteractionType>('dúvida');
  const [description, setDescription] = useState('');
  const [resolution, setResolution] = useState('');
  const [status, setStatus] = useState<InteractionStatus>('Aberto');

  const filteredInteractions = useMemo(() => {
    return interactions.filter(i => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchSubject = i.subject.toLowerCase().includes(q);
        const matchCustomer = i.customerName.toLowerCase().includes(q);
        const matchDesc = i.description.toLowerCase().includes(q);
        if (!matchSubject && !matchCustomer && !matchDesc) return false;
      }

      if (selectedStatus !== 'all' && i.status !== selectedStatus) return false;
      if (selectedChannel !== 'all' && i.channel !== selectedChannel) return false;

      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [interactions, search, selectedStatus, selectedChannel]);

  const stats = useMemo(() => {
    return {
      total: interactions.length,
      open: interactions.filter(i => i.status === 'Aberto').length,
      inAnalysis: interactions.filter(i => i.status === 'Em Análise').length,
      completed: interactions.filter(i => i.status === 'Concluído').length
    };
  }, [interactions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !customerId) {
      showToast('Selecione um cliente e informe o assunto.', 'error');
      return;
    }

    const selectedCust = customers.find(c => c.id === customerId);
    const newInt: Interaction = {
      id: `int-${Date.now()}`,
      customerId,
      customerName: selectedCust?.name || 'Cliente Super Astral',
      date: new Date().toISOString(),
      employeeName: currentUser.name,
      employeeEmail: currentUser.email,
      channel,
      type,
      subject: subject.trim(),
      description: description.trim() || 'Chamado registrado no SAC',
      resolution: resolution.trim() || undefined,
      status,
      storeName: (() => {
        const sid = getRecordStoreId(selectedCust?.favoriteStoreId, selectedCust?.favoriteStoreName);
        return (sid && getStoreLabel(sid)) || selectedCust?.favoriteStoreName || undefined;
      })(),
      createdAt: new Date().toISOString()
    };

    await handleSaveInteraction(newInt);
    setIsModalOpen(false);
    setSubject('');
    setDescription('');
    setResolution('');
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Headphones className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Central de Atendimento & SAC
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Registro de interações, resolução de chamados de clientes e histórico omnichannel.
          </p>
        </div>

        <button
          onClick={() => {
            if (customers.length > 0) setCustomerId(customers[0].id);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm shadow-emerald-600/20"
        >
          <Plus className="w-4 h-4" />
          Registrar Atendimento
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total de Chamados</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-rose-500 font-medium">Abertos / Pendentes</div>
          <div className="text-2xl font-bold text-rose-600 mt-1">{stats.open}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-amber-500 font-medium">Em Análise</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{stats.inAnalysis}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-emerald-600 font-medium">Concluídos com Sucesso</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.completed}</div>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por cliente, assunto ou descrição..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
          />
        </div>

        <div>
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium outline-none cursor-pointer"
          >
            <option value="all">Todos os Status</option>
            <option value="Aberto">Aberto</option>
            <option value="Em Análise">Em Análise</option>
            <option value="Concluído">Concluído</option>
          </select>
        </div>

        <div>
          <select
            value={selectedChannel}
            onChange={e => setSelectedChannel(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium outline-none cursor-pointer"
          >
            <option value="all">Todos os Canais</option>
            <option value="WhatsApp">WhatsApp</option>
            <option value="Balcão Loja">Balcão Loja</option>
            <option value="Telefone">Telefone</option>
            <option value="E-mail">E-mail</option>
          </select>
        </div>
      </div>

      {/* Interactions Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Assunto & Tipo</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Atendente</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInteractions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    Nenhum registro de atendimento encontrado.
                  </td>
                </tr>
              ) : (
                filteredInteractions.map(inter => (
                  <tr key={inter.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div 
                        onClick={() => openCustomer360(inter.customerId)}
                        className="font-bold text-slate-900 hover:text-emerald-600 cursor-pointer"
                      >
                        {inter.customerName}
                      </div>
                      <div className="text-[11px] text-slate-400">{inter.storeName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{inter.subject}</div>
                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 uppercase">
                        {inter.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-600 font-medium">
                        {inter.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {inter.employeeName}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(inter.date).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        inter.status === 'Concluído' ? 'bg-emerald-100 text-emerald-800' :
                        inter.status === 'Em Análise' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {inter.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openCustomer360(inter.customerId)}
                        className="p-1.5 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-slate-100"
                        title="Ver Cliente 360"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-800">
              Registrar Novo Atendimento de SAC
            </h3>
            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cliente *</label>
                <select
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded-lg outline-none bg-white"
                >
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.cpf})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Canal</label>
                  <select
                    value={channel}
                    onChange={e => setChannel(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg outline-none bg-white"
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Balcão Loja">Balcão Loja</option>
                    <option value="Telefone">Telefone</option>
                    <option value="E-mail">E-mail</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tipo</label>
                  <select
                    value={type}
                    onChange={e => setType(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg outline-none bg-white"
                  >
                    <option value="dúvida">Dúvida</option>
                    <option value="reclamação">Reclamação</option>
                    <option value="elogio">Elogio</option>
                    <option value="solicitação">Solicitação</option>
                    <option value="troca">Troca / Devolução</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assunto *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Consulta de saldo de pontos Astral Clube"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Relato / Descrição</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Resolução Fornecida</label>
                <input
                  type="text"
                  placeholder="Ex: Explicado resgate no caixa e concedido bônus de 50 pontos."
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white font-bold rounded-lg"
                >
                  Salvar Chamado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
