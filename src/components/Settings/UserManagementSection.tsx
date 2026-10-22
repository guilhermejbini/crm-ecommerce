import React, { useState, useEffect } from 'react';
import { 
  UserCheck, 
  Plus, 
  ShieldAlert, 
  ShieldCheck, 
  UserX, 
  Trash2, 
  Clock, 
  Mail, 
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  KeyRound
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { AuthorizedUser } from '../../types/crm';
import { ROOT_ADMIN_EMAILS } from '../../services/authService';

export const UserManagementSection: React.FC = () => {
  const { 
    currentUser, 
    authorizedUsers, 
    loadAuthorizedUsers, 
    handleAuthorizeUser, 
    handleToggleUserStatus, 
    handleUpdateUserRole, 
    handleRemoveAuthorizedUser 
  } = useCRM();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'manager' | 'viewer'>('manager');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AuthorizedUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (currentUser.role === 'admin') {
      loadAuthorizedUsers();
    }
  }, [currentUser.role, loadAuthorizedUsers]);

  if (currentUser.role !== 'admin') {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
        <div className="flex items-center gap-2 text-slate-800">
          <KeyRound className="w-5 h-5 text-amber-500" />
          <h3 className="text-base font-bold">Usuários e Permissões</h3>
        </div>
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Acesso restrito: Apenas administradores do CRM podem gerenciar autorizações de usuários.</span>
        </div>
      </div>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFormError('Informe um e-mail Google válido.');
      return;
    }

    if (!cleanName) {
      setFormError('Informe o nome do colaborador.');
      return;
    }

    setIsSubmitting(true);
    try {
      await handleAuthorizeUser({
        name: cleanName,
        email: cleanEmail,
        role
      });
      setIsAddModalOpen(false);
      setName('');
      setEmail('');
      setRole('manager');
    } catch (err: any) {
      setFormError(err?.message || 'Erro ao autorizar usuário.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      await handleRemoveAuthorizedUser(userToDelete);
      setUserToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatLastAccess = (dateStr?: string) => {
    if (!dateStr) return 'Aguardando 1º login';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900">
              Usuários e Permissões
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Controle de acesso estritamente privado. Apenas contas Google previamente cadastradas nesta lista conseguem entrar no CRM.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError('');
            setIsAddModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-emerald-600/20 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>+ Autorizar usuário</span>
        </button>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4">Nome</th>
              <th className="py-3 px-4">E-mail Google</th>
              <th className="py-3 px-4">Perfil</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Último Acesso</th>
              <th className="py-3 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {authorizedUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Nenhum usuário cadastrado.
                </td>
              </tr>
            ) : (
              authorizedUsers.map((u) => {
                const isRoot = ROOT_ADMIN_EMAILS.includes(u.email.toLowerCase());
                const isSelf = currentUser.email.toLowerCase() === u.email.toLowerCase();

                return (
                  <tr key={u.email} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span>{u.name}</span>
                        {isRoot && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">
                            Bootstrap Root
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                            Você
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{u.email}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      {isRoot ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800">
                          Admin Geral
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) => handleUpdateUserRole(u, e.target.value as 'admin' | 'manager' | 'viewer')}
                          className="bg-slate-100 border border-slate-300 text-slate-800 text-xs rounded-lg px-2 py-1 font-semibold focus:outline-emerald-500"
                        >
                          <option value="admin">Admin</option>
                          <option value="manager">Gestor</option>
                          <option value="viewer">Consulta</option>
                        </select>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {u.active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">
                          <UserX className="w-3 h-3" />
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{formatLastAccess(u.lastLoginAt || u.createdAt)}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isRoot && !isSelf && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleToggleUserStatus(u, !u.active)}
                              title={u.active ? 'Desativar acesso' : 'Ativar acesso'}
                              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-colors ${
                                u.active
                                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {u.active ? 'Desativar' : 'Ativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setUserToDelete(u)}
                              title="Remover autorização permanentemente"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
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

      {/* Modal Adicionar Usuário */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Autorizar Novo Usuário</h4>
                  <p className="text-[11px] text-slate-500">Cadastre a conta Google antes do primeiro login</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nome Completo
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: João da Silva"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  E-mail Google
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@superastral.com.br ou @gmail.com"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  A pessoa usará este e-mail para autenticar no botão "Entrar com Google".
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Perfil de Acesso
                </label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="role"
                      value="admin"
                      checked={role === 'admin'}
                      onChange={() => setRole('admin')}
                      className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-900">Admin</div>
                      <div className="text-[10px] text-slate-500">Acesso irrestrito, gestão de usuários e exclusões.</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="role"
                      value="manager"
                      checked={role === 'manager'}
                      onChange={() => setRole('manager')}
                      className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-900">Gestor</div>
                      <div className="text-[10px] text-slate-500">Operação do CRM (clientes, compras, campanhas, cupons).</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="role"
                      value="viewer"
                      checked={role === 'viewer'}
                      onChange={() => setRole('viewer')}
                      className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-900">Consulta</div>
                      <div className="text-[10px] text-slate-500">Visualização de relatórios e dados comerciais sem edição.</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span>Autorizar acesso</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmar Remoção */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-900">Remover Acesso do Usuário?</h4>
              <p className="text-xs text-slate-600 mt-1">
                A autorização da conta <strong>{userToDelete.email}</strong> será revogada permanentemente no Firestore.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmDelete}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-sm disabled:opacity-50"
              >
                {isDeleting ? 'Removendo...' : 'Sim, Remover Acesso'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
