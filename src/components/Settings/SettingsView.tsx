import React from 'react';
import { 
  Settings, 
  Store, 
  Users, 
  Database, 
  CheckCircle2, 
  Cpu
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { UserManagementSection } from './UserManagementSection';

export const SettingsView: React.FC = () => {
  const { stores, customers, purchases, currentUser } = useCRM();

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Configurações do Sistema & Estrutura
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestão de unidades de supermercado, perfis de acesso, sincronização Firebase e inteligência artificial.
          </p>
        </div>
      </div>

      {/* Lojas do Super Astral */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">
              Unidades do Super Astral Supermercados
            </h3>
          </div>
          <span className="text-xs text-slate-400">{stores.length} lojas ativas</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {stores.map(st => (
            <div key={st.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">{st.name}</span>
                <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">
                  {st.code}
                </span>
              </div>
              <p className="text-xs text-slate-600">
                {st.address}, {st.city} - {st.state}
              </p>
              <div className="text-[11px] text-slate-400">
                {st.posCount} Caixas PDV Integrados
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Perfil autenticado */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Usuário autenticado e permissões</h3>
          </div>
          <span className="text-xs text-emerald-700 font-semibold">Firebase Authentication</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400">Usuário</div>
            <div className="text-sm font-bold text-slate-900 mt-1">{currentUser.name}</div>
            <div className="text-[11px] text-slate-500 mt-1 break-all">{currentUser.email}</div>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400">Perfil</div>
            <div className="text-sm font-bold text-emerald-700 mt-1">{currentUser.roleTitle}</div>
            <div className="text-[11px] text-slate-500 mt-1">RBAC aplicado também nas regras do Firestore.</div>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400">Lojas autorizadas</div>
            <div className="text-sm font-bold text-slate-900 mt-1">{currentUser.storeAccess.includes('todas') ? 'Todas as lojas' : currentUser.storeAccess.join(', ')}</div>
            <div className="text-[11px] text-slate-500 mt-1">O perfil não pode ser trocado pela interface.</div>
          </div>
        </div>
      </div>

      {/* Usuários e Permissões (Exclusivo para ADMIN) */}
      <UserManagementSection />

      {/* Database & Firebase Status */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-800">
            Banco de Dados Firestore & Infraestrutura
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="font-bold text-slate-800">Status da Conexão Firestore</div>
            <div className="flex items-center gap-2 text-emerald-600 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Sincronização Ativa & Persistente
            </div>
            <p className="text-[11px] text-slate-500">
              Coleções: `customers`, `purchases`, `campaigns`, `interactions`, `coupons`, `settings`, `audit_logs`.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="font-bold text-slate-800">Motor de IA Gemini</div>
            <div className="flex items-center gap-2 text-teal-600 font-semibold">
              <Cpu className="w-4 h-4" />
              Modelos gemini-2.5-flash Conectados
            </div>
            <p className="text-[11px] text-slate-500">
              Ativo para diagnóstico de clientes 360, criação de campanhas e chat de inteligência comercial.
            </p>
          </div>
        </div>

        {/* Database Status & Volume Stats */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <div className="text-xs font-bold text-slate-800 mb-2">Volume Atual de Dados no CRM</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <div className="text-lg font-black text-slate-900">{customers.length}</div>
              <div className="text-[11px] text-slate-500 font-medium">Clientes Cadastrados</div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <div className="text-lg font-black text-slate-900">{purchases.length}</div>
              <div className="text-[11px] text-slate-500 font-medium">Cupons Fiscais / Compras</div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <div className="text-lg font-black text-emerald-600">3</div>
              <div className="text-[11px] text-slate-500 font-medium">Unidades Super Astral</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
