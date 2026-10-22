import React, { useState } from 'react';
import { Sparkles, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { loginWithGoogle } from '../../services/authService';

interface LoginViewProps {
  onAuthenticated: () => Promise<void>;
}

export const LoginView: React.FC<LoginViewProps> = ({ onAuthenticated }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('Entrar com o Google');
  const [errorMessage, setErrorMessage] = useState('');

  const handleGoogleSignIn = async () => {
    setErrorMessage('');
    setIsLoading(true);
    setStatusText('Conectando com o Google...');
    try {
      await loginWithGoogle();
      setStatusText('Verificando autorização...');
      await onAuthenticated();
    } catch (err: any) {
      console.error('Erro na autenticação Google:', err);
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setErrorMessage('A janela de login do Google foi fechada antes da conclusão.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMessage('O navegador bloqueou o pop-up de login. Permita pop-ups para este site.');
      } else if (code === 'auth/cancelled-popup-request') {
        // Ignora requisição duplicada
      } else if (code === 'auth/network-request-failed') {
        setErrorMessage('Falha de conexão com os servidores do Google / Firebase.');
      } else {
        setErrorMessage('Não foi possível autenticar com o Google. Verifique sua conexão e tente novamente.');
      }
      setIsLoading(false);
      setStatusText('Entrar com o Google');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 select-none">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/20 text-slate-950 font-black text-2xl">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-white tracking-tight">Super Astral CRM</h1>
          <p className="mt-1 text-sm text-slate-400">Inteligência de varejo e relacionamento</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl p-7 shadow-2xl border border-slate-200">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center border border-emerald-100">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Acesso Corporativo Seguro</h2>
              <p className="text-[11px] text-slate-500">Entre com sua conta Google autorizada</p>
            </div>
          </div>

          <div className="space-y-4">
            {errorMessage && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-relaxed">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Google Sign In Button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-300 shadow-sm hover:shadow text-slate-700 text-sm font-bold transition-all disabled:opacity-75 disabled:cursor-not-allowed group"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              ) : (
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span className={isLoading ? 'text-emerald-700 font-semibold' : ''}>
                {statusText}
              </span>
            </button>
          </div>
        </div>

        {/* Informational Footer */}
        <p className="mt-5 text-center text-[11px] text-slate-400 leading-relaxed px-4">
          Sistema estritamente privado. A autenticação com conta Google exige autorização prévia concedida por um Administrador do Super Astral.
        </p>
      </div>
    </div>
  );
};
