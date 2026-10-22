// Permissões por perfil usadas pela interface.
// As regras do Firestore (firestore.rules) continuam sendo a proteção real das gravações;
// aqui só se evita mostrar telas e ações que o perfil não pode usar.

export type CRMRole = 'admin' | 'manager' | 'viewer';

/** Telas que o perfil Consulta (viewer) não acessa. */
const VIEWER_BLOCKED_VIEWS = new Set(['lgpd', 'settings', 'onlineOrders']);

export function canAccessView(role: string | undefined, view: string): boolean {
  if (role === 'viewer') return !VIEWER_BLOCKED_VIEWS.has(view);
  return true;
}

/** Importar clientes (Flex) ou vendas (PDV): gestor e administrador. */
export function canImport(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'gestor';
}

/** Direito ao esquecimento (anonimização LGPD), irreversível: só administrador. */
export function canAnonymize(role: string | undefined): boolean {
  return role === 'admin';
}

/** Criar/editar cliente: as regras do Firestore só aceitam gestor e administrador. */
export function canWriteCustomers(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'gestor';
}

/** Editar um cadastro: perfil com escrita e cliente não anonimizado (anonimização é irreversível). */
export function canEditCustomer(role: string | undefined, customer: { isAnonymized?: boolean } | null | undefined): boolean {
  return canWriteCustomers(role) && !!customer && !customer.isAnonymized;
}
