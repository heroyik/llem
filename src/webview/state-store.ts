// ---------------------------------------------------------------------------
// Lightweight reactive state store
// ---------------------------------------------------------------------------

export type Listener<T> = (value: T, oldValue: T) => void;

export interface StateStore<T extends Record<string, any>> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  subscribe<K extends keyof T>(key: K, fn: Listener<T[K]>): () => void;
}

export function createStateStore<T extends Record<string, any>>(initial: T): StateStore<T> {
  const state = { ...initial };
  const listeners = new Map<string | number | symbol, Set<Listener<any>>>();

  function getListeners(key: string | number | symbol): Set<Listener<any>> {
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    return set;
  }

  const store: StateStore<T> = {
    get<K extends keyof T>(key: K): T[K] {
      return (state as T)[key];
    },

    set<K extends keyof T>(key: K, value: T[K]): void {
      const k = key as string;
      const old = (state as any)[k];
      (state as any)[k] = value;
      const subs = listeners.get(k);
      if (subs) {
        subs.forEach(function(fn) { fn(value, old); });
      }
    },

    subscribe<K extends keyof T>(key: K, fn: Listener<T[K]>): () => void {
      const k = key as string;
      getListeners(k).add(fn as Listener<any>);
      return function() {
        const set = listeners.get(k);
        if (set) set.delete(fn as Listener<any>);
      };
    }
  };

  return store;
}
