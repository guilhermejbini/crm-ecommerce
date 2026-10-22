import React from 'react';
import { ShieldAlert, LogOut } from 'lucide-react';

interface UnauthorizedViewProps {
  email: string;
  onLogout: () => Promise<void>;
}

export const UnauthorizedView: React.FC<UnauthorizedViewProps> = ({ email, onLogout }) => {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 select-none">
      <div className="w-full max-w-md">
        {/* Card de Bloqueio Seguro */}
        <div className="bg-white rounded-3xl p-8 shadow-2xl border border-slate-200 text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600 shadow-inner">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              Acesso não autorizado
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
              Sua conta Google não possui autorização para acessar o CRM Super Astral.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              Conta
            </span>
            <p className="text-xs font-mono font-bold text-slate-800 break-all">
              {email || 'Conta não identificada'}
            </p>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Caso necessite de acesso, solicite previamente ao administrador do sistema para autorizar seu e-mail corporativo.
          </p>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </div>
  );
};
