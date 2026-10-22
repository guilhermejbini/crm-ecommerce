import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, AuthorizedUser } from '../types/crm';

export const AUTHORIZED_USERS_COL = 'authorized_users';
export const ROOT_ADMIN_EMAILS = [
  'guilhermejbini@gmail.com',
  'admin@superastral.com.br'
];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isRootAdminEmail(email: string): boolean {
  return ROOT_ADMIN_EMAILS.includes(normalizeEmail(email));
}

export interface AuthCheckResult {
  isAuthorized: boolean;
  profile?: UserProfile;
  reason?: 'not_found' | 'inactive' | 'unverified_email' | 'error';
  email: string;
}

/**
 * Consulta autorização do usuário Google no Firestore.
 * NUNCA cria autorização automaticamente para novos usuários.
 * Uma pessoa só entra se tiver sido previamente autorizada por um administrador.
 * Exige e-mail verificado (Google Account).
 */
export async function checkUserAuthorization(user: User): Promise<AuthCheckResult> {
  const email = normalizeEmail(user.email || '');

  if (!email) {
    return { isAuthorized: false, reason: 'not_found', email: '' };
  }

  // Exigência estrita de e-mail verificado para autenticação Google
  if (!user.emailVerified) {
    console.warn(`[Auth Security] Acesso negado: Conta Google ${email} possui e-mail não verificado.`);
    return { isAuthorized: false, reason: 'unverified_email', email };
  }

  // 1. Administrador Raiz Seguro (Bootstrap explícito autorizado somente com e-mail verificado)
  if (isRootAdminEmail(email)) {
    const rootProfile: UserProfile = {
      id: user.uid,
      email,
      name: user.displayName || 'Administrador Geral',
      role: 'admin',
      roleTitle: 'Administrador Geral',
      avatarUrl: user.photoURL || undefined,
      storeAccess: ['todas']
    };

    // Garante que o documento canônico esteja gravado por e-mail com todos os campos íntegros
    try {
      const emailDoc = await getDoc(doc(db, AUTHORIZED_USERS_COL, email));
      if (!emailDoc.exists() || !emailDoc.data()?.role) {
        const rootData: AuthorizedUser = {
          id: email,
          uid: user.uid,
          email,
          name: user.displayName || 'Administrador Geral',
          role: 'admin',
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: 'system_bootstrap',
          updatedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString()
        };
        await setDoc(doc(db, AUTHORIZED_USERS_COL, email), rootData, { merge: true });
      }
    } catch (bootstrapErr) {
      console.warn('[Auth] Aviso ao persistir credencial do admin raiz:', bootstrapErr);
    }

    return { isAuthorized: true, profile: rootProfile, email };
  }

  // 2. Consulta da autorização para usuários corporativos
  // FONTE ÚNICA CANÔNICA: authorized_users/{email}
  try {
    const emailDoc = await getDoc(doc(db, AUTHORIZED_USERS_COL, email));
    let authData: AuthorizedUser | null = emailDoc.exists() ? (emailDoc.data() as AuthorizedUser) : null;

    // Fallback de compatibilidade apenas se não encontrou por e-mail
    if (!authData && user.uid) {
      const uidDoc = await getDoc(doc(db, AUTHORIZED_USERS_COL, user.uid));
      if (uidDoc.exists() && uidDoc.data()?.role) {
        authData = uidDoc.data() as AuthorizedUser;
      }
    }

    // Se NÃO existe autorização prévia cadastrada pelo administrador: BLOQUEIO TOTAL
    if (!authData) {
      console.warn(`[Auth Security] Acesso negado: Conta Google ${email} não possui autorização prévia no CRM.`);
      return { isAuthorized: false, reason: 'not_found', email };
    }

    // Se o usuário estiver inativo/desativado: BLOQUEIO IMEDIATO
    if (authData.active !== true) {
      console.warn(`[Auth Security] Acesso negado: Usuário ${email} está inativo (active=false).`);
      return { isAuthorized: false, reason: 'inactive', email };
    }

    // 3. Usuário autorizado e ativo: Vincular UID no registro canônico se ainda não estiver vinculado
    if (!authData.uid || authData.uid !== user.uid) {
      try {
        const updatedTimestamp = new Date().toISOString();
        const updatedPayload: AuthorizedUser = {
          ...authData,
          id: email,
          email,
          uid: user.uid,
          lastLoginAt: updatedTimestamp,
          updatedAt: updatedTimestamp
        };

        // Grava no registro canônico do e-mail
        await setDoc(doc(db, AUTHORIZED_USERS_COL, email), updatedPayload, { merge: true });

        // Se existia documento duplicado pelo UID, remove para manter uma única fonte de verdade
        if (user.uid && user.uid !== email) {
          try {
            await deleteDoc(doc(db, AUTHORIZED_USERS_COL, user.uid));
          } catch {
            // Silencioso se não existir
          }
        }
      } catch (linkErr) {
        console.warn('[Auth] Aviso ao sincronizar vínculo de UID:', linkErr);
      }
    }

    const role = (authData.role as 'admin' | 'manager' | 'viewer') || 'viewer';
    const roleTitle = role === 'admin' 
      ? 'Administrador Geral' 
      : role === 'manager' 
        ? 'Gestor Operacional' 
        : 'Consulta / Visualizador';

    const profile: UserProfile = {
      id: user.uid,
      email,
      name: user.displayName || authData.name || email.split('@')[0],
      role,
      roleTitle,
      avatarUrl: user.photoURL || undefined,
      storeAccess: ['todas']
    };

    return { isAuthorized: true, profile, email };
  } catch (err) {
    console.error('[Auth Security] Erro ao validar autorização do usuário no Firestore:', err);
    return { isAuthorized: false, reason: 'error', email };
  }
}

/**
 * Lista todos os usuários cadastrados e autorizados no CRM (Exclusivo para ADMIN).
 */
export async function getAuthorizedUsers(): Promise<AuthorizedUser[]> {
  const snapshot = await getDocs(collection(db, AUTHORIZED_USERS_COL));
  const userMap = new Map<string, AuthorizedUser>();

  snapshot.docs.forEach(d => {
    const data = d.data() as AuthorizedUser;
    const emailKey = normalizeEmail(data.email || (d.id.includes('@') ? d.id : ''));
    if (!emailKey) return;
    const existing = userMap.get(emailKey);
    const resolvedUid = data.uid || (!d.id.includes('@') ? d.id : (existing?.uid || ''));
    userMap.set(emailKey, {
      id: emailKey,
      email: emailKey,
      uid: resolvedUid,
      name: data.name || existing?.name || emailKey.split('@')[0],
      role: data.role || existing?.role || 'viewer',
      active: data.active !== undefined ? data.active : (existing?.active !== undefined ? existing.active : true),
      createdAt: data.createdAt || existing?.createdAt || new Date().toISOString(),
      createdBy: data.createdBy || existing?.createdBy || 'administrador',
      updatedAt: data.updatedAt || existing?.updatedAt || new Date().toISOString(),
      lastLoginAt: data.lastLoginAt || existing?.lastLoginAt || undefined
    });
  });

  // Garantir que os administradores raiz apareçam na listagem
  ROOT_ADMIN_EMAILS.forEach(rootEmail => {
    const normalized = normalizeEmail(rootEmail);
    if (!userMap.has(normalized)) {
      userMap.set(normalized, {
        id: normalized,
        email: normalized,
        name: normalized.includes('guilherme') ? 'Guilherme Bini (Super Astral)' : 'Administrador Geral Super Astral',
        role: 'admin',
        active: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        createdBy: 'sistema_bootstrap',
        updatedAt: '2026-09-01T00:00:00.000Z'
      });
    }
  });

  return Array.from(userMap.values()).sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Autoriza previamente um novo usuário por e-mail (Exclusivo para ADMIN).
 */
export async function authorizeNewUser(
  data: {
    name: string;
    email: string;
    role: 'admin' | 'manager' | 'viewer';
  },
  adminUser: UserProfile
): Promise<AuthorizedUser> {
  if (adminUser.role !== 'admin') {
    throw new Error('Permissão negada: Somente administradores podem autorizar novos usuários.');
  }

  const normalized = normalizeEmail(data.email);
  if (!normalized || !normalized.includes('@')) {
    throw new Error('E-mail Google inválido.');
  }

  const now = new Date().toISOString();
  const newAuth: AuthorizedUser = {
    id: normalized,
    email: normalized,
    name: data.name.trim() || normalized.split('@')[0],
    role: data.role,
    active: true,
    createdAt: now,
    createdBy: adminUser.email || 'administrador',
    updatedAt: now
  };

  await setDoc(doc(db, AUTHORIZED_USERS_COL, normalized), newAuth);
  return newAuth;
}

/**
 * Alterna status de ativação (Ativar / Desativar) do usuário (Exclusivo para ADMIN).
 */
export async function toggleUserActiveStatus(
  user: AuthorizedUser,
  active: boolean,
  adminUser: UserProfile
): Promise<void> {
  if (adminUser.role !== 'admin') {
    throw new Error('Permissão negada: Somente administradores podem alterar permissões.');
  }

  const normalized = normalizeEmail(user.email);
  if (isRootAdminEmail(normalized)) {
    throw new Error('Não é permitido alterar o status de ativação do administrador raiz do sistema.');
  }

  if (normalizeEmail(adminUser.email) === normalized) {
    throw new Error('Você não pode desativar seu próprio usuário conectado.');
  }

  const now = new Date().toISOString();
  const docRef = doc(db, AUTHORIZED_USERS_COL, normalized);
  const snap = await getDoc(docRef);
  let existingData: AuthorizedUser | null = snap.exists() ? (snap.data() as AuthorizedUser) : null;

  if (!existingData && user.uid) {
    const legacySnap = await getDoc(doc(db, AUTHORIZED_USERS_COL, user.uid));
    if (legacySnap.exists()) {
      existingData = legacySnap.data() as AuthorizedUser;
    }
  }

  const existing = existingData || user;

  const fullData: AuthorizedUser = {
    id: normalized,
    email: normalized,
    uid: existing.uid || user.uid || '',
    name: existing.name || user.name || normalized.split('@')[0],
    role: existing.role || user.role || 'viewer',
    active,
    createdAt: existing.createdAt || user.createdAt || now,
    createdBy: existing.createdBy || user.createdBy || adminUser.email || 'administrador',
    updatedAt: now,
    lastLoginAt: existing.lastLoginAt || user.lastLoginAt || undefined
  };

  await setDoc(docRef, fullData);

  if (user.uid && user.uid !== normalized) {
    try {
      await deleteDoc(doc(db, AUTHORIZED_USERS_COL, user.uid));
    } catch {
      // Ignora erro se doc legado não existir
    }
  }
}

/**
 * Atualiza o perfil de acesso do usuário (Admin / Gestor / Consulta) (Exclusivo para ADMIN).
 */
export async function updateUserRole(
  user: AuthorizedUser,
  newRole: 'admin' | 'manager' | 'viewer',
  adminUser: UserProfile
): Promise<void> {
  if (adminUser.role !== 'admin') {
    throw new Error('Permissão negada: Somente administradores podem alterar perfis.');
  }

  const normalized = normalizeEmail(user.email);
  if (isRootAdminEmail(normalized) && newRole !== 'admin') {
    throw new Error('O administrador raiz deve manter o perfil de Administrador Geral.');
  }

  const now = new Date().toISOString();
  const docRef = doc(db, AUTHORIZED_USERS_COL, normalized);
  const snap = await getDoc(docRef);
  let existingData: AuthorizedUser | null = snap.exists() ? (snap.data() as AuthorizedUser) : null;

  if (!existingData && user.uid) {
    const legacySnap = await getDoc(doc(db, AUTHORIZED_USERS_COL, user.uid));
    if (legacySnap.exists()) {
      existingData = legacySnap.data() as AuthorizedUser;
    }
  }

  const existing = existingData || user;

  const fullData: AuthorizedUser = {
    id: normalized,
    email: normalized,
    uid: existing.uid || user.uid || '',
    name: existing.name || user.name || normalized.split('@')[0],
    role: newRole,
    active: existing.active !== undefined ? existing.active : (user.active !== undefined ? user.active : true),
    createdAt: existing.createdAt || user.createdAt || now,
    createdBy: existing.createdBy || user.createdBy || adminUser.email || 'administrador',
    updatedAt: now,
    lastLoginAt: existing.lastLoginAt || user.lastLoginAt || undefined
  };

  await setDoc(docRef, fullData);

  if (user.uid && user.uid !== normalized) {
    try {
      await deleteDoc(doc(db, AUTHORIZED_USERS_COL, user.uid));
    } catch {
      // Ignora se não existir
    }
  }
}

/**
 * Remove completamente a autorização de um usuário (Exclusivo para ADMIN).
 */
export async function removeUserAuthorization(
  user: AuthorizedUser,
  adminUser: UserProfile
): Promise<void> {
  if (adminUser.role !== 'admin') {
    throw new Error('Permissão negada: Somente administradores podem remover acessos.');
  }

  const normalized = normalizeEmail(user.email);
  if (isRootAdminEmail(normalized)) {
    throw new Error('Não é permitido excluir o administrador raiz.');
  }

  if (normalizeEmail(adminUser.email) === normalized) {
    throw new Error('Você não pode remover seu próprio acesso enquanto estiver conectado.');
  }

  await deleteDoc(doc(db, AUTHORIZED_USERS_COL, normalized));
  if (user.uid) {
    await deleteDoc(doc(db, AUTHORIZED_USERS_COL, user.uid));
  }
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function loginWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

export async function logout(): Promise<void> {
  await signOut(auth);
}
