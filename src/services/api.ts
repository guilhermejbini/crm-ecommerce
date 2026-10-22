import { getIdToken } from 'firebase/auth';
import { auth } from './firebase';

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  let user = auth.currentUser;

  // Se o Firebase Auth ainda estiver inicializando na primeira renderização, aguarda brevemente
  if (!user) {
    user = await new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged((u) => {
        unsubscribe();
        resolve(u);
      });
      setTimeout(() => resolve(null), 2500);
    });
  }

  if (!user) {
    throw new Error('Sessão expirada ou usuário não autenticado no Firebase. Faça login novamente.');
  }

  const token = await getIdToken(user, false);
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, { ...init, headers });
  return response;
}

