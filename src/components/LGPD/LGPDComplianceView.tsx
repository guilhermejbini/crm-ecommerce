import React, { useState, useMemo } from 'react';
import { 
  Shield, 
  Lock, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  FileText, 
  Users, 
  Eye, 
  Trash2,
  Clock,
  ShieldAlert,
  Search
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';

export const LGPDComplianceView: React.FC = () => {
  const { customers, auditLogs, handleAnonymizeCustomer, openCustomer360, showToast, currentUser } = useCRM();

  const [search, setSearch] = useState('');
  const [selectedOptInFilter, setSelectedOptInFilter] = useState('all');

  // Stats calculation
  const lgpdStats = useMemo(() => {
    const total = customers.length;
    const waOptIn = customers.filter(c => c.consent?.whatsappMarketing).length;
    const emailOptIn = customers.filter(c => c.consent?.emailMarketing).length;
    const smsOptIn = customers.filter(c => c.consent?.smsMarketing).length;
    const anonymized = customers.filter(c => c.isAnonymized).length;

    return {
      total,
      waOptIn,
      waPct: total > 0 ? Math.round((waOptIn / total) * 100) : 0,
      emailOptIn,
      emailPct: total > 0 ? Math.round((emailOptIn / total) * 100) : 0,
      smsOptIn,
      smsPct: total > 0 ? Math.round((smsOptIn / total) * 100) : 0,
      anonymized
    };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchCpf = c.cpf ? c.cpf.includes(q) : false;
        if (!matchName && !matchCpf) return false;
      }

      if (selectedOptInFilter === 'wa_yes' && !c.consent?.whatsappMarketing) return false;
      if (selectedOptInFilter === 'wa_no' && c.consent?.whatsappMarketing) return false;
      if (selectedOptInFilter === 'anonymized' && !c.isAnonymized) return false;

      return true;
    });
  }, [customers, search, selectedOptInFilter]);

  const handleExportLGPDReport = () => {
    const headers = ['ID', 'Nome', 'CPF', 'WhatsApp', 'Opt-in WhatsApp', 'Data Consentimento WhatsApp', 'Opt-in Email', 'Finalidade', 'Anonimizado'];
    const rows = customers.map(c => [
      c.id,
      `"${c.name}"`,
      c.cpf || '',
      c.whatsapp || '',
      c.consent?.whatsappMarketing ? 'SIM' : 'NÃO',
      c.consent?.whatsappConsentDate || '',
      c.consent?.emailMarketing ? 'SIM' : 'NÃO',
      `"${c.consent?.purpose || ''}"`,
      c.isAnonymized ? 'SIM' : 'NÃO'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `relatorio_lgpd_super_astral_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Relatório de conformidade LGPD exportado!', 'success');
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Governança, Privacidade e Conformidade LGPD
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestão de consentimentos, controle do direito ao esquecimento e trilha de auditoria do Super Astral.
          </p>
        </div>

        <button
          onClick={handleExportLGPDReport}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-xs"
        >
          <Download className="w-4 h-4 text-slate-500" />
          Exportar Relatório LGPD
        </button>
      </div>

      {/* Compliance Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Opt-in WhatsApp Ativo</div>
          <div className="text-2xl font-bold text-teal-600 mt-1">
            {lgpdStats.waPct}% ({lgpdStats.waOptIn} clientes)
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Autorizados para envio de encartes</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Opt-in E-mail Ativo</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {lgpdStats.emailPct}% ({lgpdStats.emailOptIn} clientes)
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Comunicação e benefícios</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Cadastros Anonimizados</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">
            {lgpdStats.anonymized} titulares
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Direito ao esquecimento exercido</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Logs de Auditoria Registrados</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {auditLogs.length} eventos
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">Rastreamento 100% ativo</div>
        </div>
      </div>

      {/* LGPD Principles Info Card */}
      <div className="bg-emerald-50/70 border border-emerald-200 p-4 rounded-2xl text-xs text-emerald-950 space-y-1.5">
        <div className="font-bold flex items-center gap-1.5 text-emerald-900">
          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          Conformidade e Princípios Aplicados no Super Astral
        </div>
        <p className="leading-relaxed">
          • <strong>Finalidade Específica:</strong> O CPF fornecido no caixa do PDV para desconto fiscal é estritamente separado da permissão de envio de mensagens promocionais.<br />
          • <strong>Consentimento Claro:</strong> O cliente pode a qualquer momento revogar o consentimento ou solicitar o apagamento dos seus dados pessoais mantendo os dados fiscais anônimos.
        </p>
      </div>

      {/* Customer Consent Management Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Consentimentos por Cliente
            </h3>
            <p className="text-xs text-slate-400">
              Controle individual de autorizações e direitos dos titulares
            </p>
          </div>

          <div className="flex gap-2">
            <div className="relative w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar cliente..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
              />
            </div>

            <select
              value={selectedOptInFilter}
              onChange={e => setSelectedOptInFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
            >
              <option value="all">Todos</option>
              <option value="wa_yes">WhatsApp Autorizado</option>
              <option value="wa_no">WhatsApp Sem Opt-in</option>
              <option value="anonymized">Apenas Anonimizados</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Titular dos Dados</th>
                <th className="px-4 py-2.5">CPF & Contato</th>
                <th className="px-4 py-2.5 text-center">WhatsApp Marketing</th>
                <th className="px-4 py-2.5 text-center">E-mail Marketing</th>
                <th className="px-4 py-2.5">Data do Consentimento</th>
                <th className="px-4 py-2.5 text-right">Ação LGPD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.slice(0, 12).map(c => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <span className="font-bold text-slate-900">{c.name}</span>
                    {c.isAnonymized && (
                      <span className="ml-2 text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono font-bold">
                        ANONIMIZADO
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-500">{c.cpf}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      c.consent?.whatsappMarketing ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {c.consent?.whatsappMarketing ? 'SIM' : 'NÃO'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      c.consent?.emailMarketing ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {c.consent?.emailMarketing ? 'SIM' : 'NÃO'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {c.consent?.lastUpdated ? new Date(c.consent.lastUpdated).toLocaleDateString('pt-BR') : 'N/A'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openCustomer360(c.id)}
                        className="p-1 text-slate-400 hover:text-emerald-600"
                        title="Ver Perfil Completo"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {currentUser.role === 'admin' && !c.isAnonymized && (
                        <button
                          onClick={() => {
                            if (confirm(`Executar Direito ao Esquecimento para ${c.name}?`)) {
                              handleAnonymizeCustomer(c.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600"
                          title="Anonimizar Dados Pessoais"
                        >
                          <Lock className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-600" />
          Trilha de Auditoria e Acessos Recentes
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-2">Data e Hora</th>
                <th className="px-4 py-2">Usuário</th>
                <th className="px-4 py-2">Ação</th>
                <th className="px-4 py-2">Entidade / Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.slice(0, 10).map(log => (
                <tr key={log.id}>
                  <td className="px-4 py-2 text-slate-500">{new Date(log.timestamp).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-2 font-semibold text-slate-800">{log.userName} ({log.userRole})</td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
