import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  UserPlus, 
  Bot, 
  Sparkles, 
  ChevronDown, 
  Shield, 
  Check, 
  User, 
  X, 
  Smartphone, 
  CreditCard,
  Bell,
  RefreshCw
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { getRFMSegmentDetails } from '../../services/rfmCalculator';

export const Header: React.FC = () => {
  const { 
    currentUser,
    logout, 
    customers, 
    openCustomer360,
    setIsNewCustomerModalOpen,
    setIsAIChatOpen,
    globalSearchQuery,
    setGlobalSearchQuery,
    tasks,
    refreshData,
    isSyncing
  } = useCRM();

  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Filter customers for global search dropdown
  const searchResults = globalSearchQuery.trim().length > 1
    ? customers.filter(c => {
        const q = globalSearchQuery.toLowerCase().replace(/[^a-z0-9]/g, '');
        const nameMatch = c.name.toLowerCase().includes(globalSearchQuery.toLowerCase());
        const cpfMatch = c.cpf ? c.cpf.replace(/[^0-9]/g, '').includes(q) : false;
        const phoneMatch = c.whatsapp ? c.whatsapp.replace(/[^0-9]/g, '').includes(q) : false;
        const emailMatch = c.email ? c.email.toLowerCase().includes(globalSearchQuery.toLowerCase()) : false;
        return nameMatch || cpfMatch || phoneMatch || emailMatch;
      }).slice(0, 6)
    : [];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const pendingTasksCount = tasks.filter(t => t.status === 'Pendente').length;

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-20 shrink-0">
      {/* Search Bar */}
      <div className="flex-1 max-w-lg relative" ref={searchRef}>
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome, CPF, WhatsApp, e-mail..."
            value={globalSearchQuery}
            onChange={(e) => setGlobalSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            className="w-full pl-9 pr-8 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-xs text-slate-800 placeholder-slate-400 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
          {globalSearchQuery && (
            <button
              onClick={() => setGlobalSearchQuery('')}
              className="absolute right-2.5 p-0.5 text-slate-400 hover:text-slate-600 rounded-full"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {isSearchFocused && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-slate-100">
            <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider flex justify-between">
              <span>Clientes encontrados ({searchResults.length})</span>
              <span>Clique para ver Cliente 360</span>
            </div>
            {searchResults.map(c => {
              const rfmInfo = getRFMSegmentDetails(c.rfmSegment);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    openCustomer360(c.id);
                    setIsSearchFocused(false);
                    setGlobalSearchQuery('');
                  }}
                  className="w-full px-3 py-2.5 text-left hover:bg-emerald-50/50 flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      {c.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-800 group-hover:text-emerald-700">
                        {c.name}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2">
                        <span>CPF: {c.cpf}</span>
                        <span>•</span>
                        <span>{c.whatsapp}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${rfmInfo.badgeColor}`}>
                      {c.rfmSegment}
                    </span>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      R$ {c.totalSpent.toFixed(2)} ({c.totalPurchases} compras)
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Botão Sincronizar */}
        <button
          onClick={() => refreshData({ forceRefresh: true })}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shadow-xs"
          title="Sincronizar dados em tempo real com o Firestore"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${isSyncing ? 'animate-spin text-emerald-600' : ''}`} />
          <span className="hidden sm:inline">{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
        </button>

        {/* Authenticated user */}
        <div className="relative">
          <button
            onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
            className="flex items-center gap-2 pl-2 pr-3 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all"
            title="Conta e sessão"
          >
            <div className="w-7 h-7 rounded-lg bg-slate-800 text-white flex items-center justify-center font-bold text-xs">
              {currentUser.name.charAt(0)}
            </div>
            <div className="text-left hidden lg:block">
              <div className="text-xs font-bold text-slate-800 leading-tight">
                {currentUser.name.split(' ')[0]}
              </div>
              <div className="text-[10px] text-emerald-600 font-semibold uppercase">
                {currentUser.roleTitle}
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
          </button>

          {isRoleDropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1">
              <div className="px-3 py-3 bg-slate-50 border-b border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Sessão atual
                </div>
                <div className="text-xs font-semibold text-slate-800 mt-1 truncate">{currentUser.email}</div>
                <div className="text-[10px] text-emerald-700 font-bold uppercase mt-1">{currentUser.roleTitle}</div>
              </div>
              <button
                onClick={async () => {
                  setIsRoleDropdownOpen(false);
                  await logout();
                }}
                className="w-full px-3 py-2.5 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors"
              >
                Sair do CRM
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
