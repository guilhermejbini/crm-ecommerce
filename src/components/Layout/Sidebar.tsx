import React from 'react';
import { 
  LayoutDashboard, 
  Users, 
  MapPin,
  ShoppingCart, 
  Filter, 
  Award, 
  Megaphone, 
  Ticket, 
  Headphones, 
  Sparkles, 
  ShieldCheck, 
  Settings,
  Store as StoreIcon,
  Bot,
  UploadCloud,
  Database,
  FileSpreadsheet,
  RefreshCw
} from 'lucide-react';
import { useCRM, AppView } from '../../context/CRMContext';
import { canAccessView, canImport } from '../../utils/permissions';

interface NavItem {
  id: AppView;
  label: string;
  icon: React.ElementType;
  badge?: number | string;
  allowedRoles?: string[];
}

export const Sidebar: React.FC = () => {
  const { 
    currentView, 
    setCurrentView, 
    currentUser, 
    customers,
    tasks,
    setIsAIChatOpen, 
    setIsPDVImportModalOpen,
    setIsCustomerImportModalOpen,
    isLoading,
    refreshData,
    isSyncing
  } = useCRM();

  const openTasksCount = tasks.filter(t => t.status === 'Pendente').length;

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'customers', label: 'Clientes', icon: Users, badge: customers.length },
    { id: 'map', label: 'Mapa de Clientes', icon: MapPin },
    { id: 'purchases', label: 'Compras & PDV', icon: ShoppingCart },
    { id: 'segments', label: 'Segmentação', icon: Filter },
    { id: 'loyalty', label: 'Fidelidade Clube', icon: Award },
    { id: 'campaigns', label: 'Campanhas', icon: Megaphone },
    { id: 'coupons', label: 'Cupons', icon: Ticket },
    { id: 'support', label: 'Atendimento & SAC', icon: Headphones, badge: openTasksCount > 0 ? openTasksCount : undefined },
    { id: 'opportunities', label: 'Oportunidades NBA', icon: Sparkles },
    { id: 'lgpd', label: 'Auditoria & LGPD', icon: ShieldCheck },
    { id: 'settings', label: 'Configurações', icon: Settings }
  ];

  return (
    <aside className="w-64 bg-astral-navy text-slate-100 flex flex-col h-screen shrink-0 select-none border-r border-white/5">
      {/* Brand Header */}
      <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
        <img
          src="/A-logo-Super-Astral.png"
          alt="Super Astral Logo"
          className="w-10 h-10 object-contain"
          referrerPolicy="no-referrer"
        />
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="font-bold text-base tracking-tight text-white">Super Astral</h1>
            <span className="text-[10px] uppercase font-extrabold tracking-wider px-1.5 py-0.5 rounded bg-astral-yellow text-astral-navy">
              CRM
            </span>
          </div>
          <p className="text-xs text-slate-300/80">Relacionamento com clientes</p>
        </div>
      </div>

      {/* Quick AI Trigger Card */}
      <div className="px-3 pt-3">
        <button
          onClick={() => setIsAIChatOpen(true)}
          className="w-full group flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white transition-all"
        >
          <div className="w-7 h-7 rounded-lg bg-astral-yellow/15 flex items-center justify-center text-astral-yellow">
            <Bot className="w-4 h-4" />
          </div>
          <div className="text-left flex-1 min-w-0">
            <div className="text-xs font-bold text-white">Assistente comercial</div>
            <div className="text-[11px] text-slate-300/70 truncate">Perguntas sobre a base (IA)</div>
          </div>
        </button>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 custom-scrollbar">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400/70 px-3 pb-1.5">
          Menu
        </div>
        {navItems.filter(item => canAccessView(currentUser.role, item.id)).map(item => {
          const isActive = currentView === item.id || (item.id === 'customers' && currentView === 'customer360');
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`relative w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
                isActive
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-astral-yellow'
                  : 'text-slate-300/80 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 ${isActive ? 'text-astral-yellow' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    isActive
                      ? 'bg-astral-yellow text-astral-navy border border-transparent'
                      : typeof item.badge === 'string' && item.badge.includes('risco')
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-white/10 text-slate-200 border border-transparent'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer Utilities */}
      <div className="p-3 border-t border-white/10 space-y-2">
        {canImport(currentUser.role) && (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setIsCustomerImportModalOpen(true)}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-100 text-[11px] font-semibold transition-colors border border-white/10"
            title="Importar Clientes via Excel/Flex"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-astral-yellow" />
            Importar Excel
          </button>
          <button
            onClick={() => setIsPDVImportModalOpen(true)}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-100 text-[11px] font-semibold transition-colors border border-white/10"
            title="Importar Vendas do PDV"
          >
            <UploadCloud className="w-3.5 h-3.5 text-astral-yellow" />
            Importar PDV
          </button>
        </div>
        )}

        {/* Database Status Indicator & Sincronizar */}
        <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/5 text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-amber-400 animate-ping' : 'bg-astral-green'}`}></span>
            <span className="font-medium">{isSyncing ? 'Sincronizando...' : 'Base Super Astral'}</span>
          </span>
          <button
            onClick={() => refreshData({ forceRefresh: true })}
            disabled={isSyncing}
            className="text-[10px] text-astral-yellow hover:text-white font-bold flex items-center gap-1 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
            title="Clique para sincronizar com o Firestore"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Sync...' : customers.length > 0 ? `${customers.length} Clientes` : 'Sincronizar'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
