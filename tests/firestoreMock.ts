/**
 * Mock em memória mínimo de 'firebase/firestore' para testes unitários.
 * Cobre apenas o que os fluxos testados usam; nenhum acesso de rede.
 */
export type MemStore = Map<string, Map<string, any>>;

/** Sentinela equivalente ao deleteField() do SDK. */
export const DELETE_FIELD = { __op: 'deleteField' };

export function createFirestoreMock(store: MemStore) {
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  type Filter = { type: 'where'; field: string; op: string; value: any };
  const matches = (data: any, filters: Filter[] = []) =>
    filters.every(f => (f.op === '==' ? data?.[f.field] === f.value : true));
  const snapOf = (name: string, filters?: Filter[]) => {
    const docs = Array.from(col(name).entries())
      .filter(([, data]) => matches(data, filters))
      .map(([id, data]) => ({ id, ref: { col: name, id }, data: () => data, exists: () => true }));
    return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
  };
  const write = (ref: { col: string; id: string }, data: any, opts?: { merge?: boolean }) => {
    const prev = col(ref.col).get(ref.id);
    const next: any = opts?.merge && prev ? { ...prev, ...data } : { ...data };
    for (const k of Object.keys(next)) if (next[k] === DELETE_FIELD) delete next[k];
    col(ref.col).set(ref.id, next);
  };

  return {
    collection: (_db: any, name: string) => ({ col: name }),
    doc: (_db: any, name: string, id: string) => ({ col: name, id }),
    query: (ref: any, ...constraints: any[]) => ({
      col: ref.col,
      filters: [...(ref.filters || []), ...constraints.filter(c => c?.type === 'where')]
    }),
    where: (field: string, op: string, value: any) => ({ type: 'where', field, op, value }),
    orderBy: () => ({}),
    limit: () => ({}),
    startAfter: () => ({}),
    documentId: () => '__name__',
    serverTimestamp: () => new Date().toISOString(),
    getDocs: async (ref: any) => snapOf(ref.col, ref.filters),
    getDoc: async (ref: any) => {
      const data = col(ref.col).get(ref.id);
      return { id: ref.id, exists: () => data !== undefined, data: () => data };
    },
    getCountFromServer: async (ref: any) => ({ data: () => ({ count: snapOf(ref.col, ref.filters).size }) }),
    setDoc: async (ref: any, data: any, opts?: any) => write(ref, data, opts),
    updateDoc: async (ref: any, data: any) => {
      if (!col(ref.col).has(ref.id)) throw new Error(`not-found: ${ref.col}/${ref.id}`);
      write(ref, data, { merge: true });
    },
    deleteField: () => DELETE_FIELD,
    deleteDoc: async (ref: any) => { col(ref.col).delete(ref.id); },
    writeBatch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: any, opts?: any) => { ops.push(() => write(ref, data, opts)); },
        update: (ref: any, data: any) => { ops.push(() => write(ref, data, { merge: true })); },
        delete: (ref: any) => { ops.push(() => { col(ref.col).delete(ref.id); }); },
        commit: async () => { ops.forEach(op => op()); }
      };
    }
  };
}
