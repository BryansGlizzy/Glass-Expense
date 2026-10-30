// Minimal browser environment so the real client modules (src/e2ee/*) can run under Node.
import { BASE } from './helpers.ts';

const store = () => { const m = new Map<string, string>(); return {
  getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)),
  removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; },
}; };
const g = globalThis as any;
g.window = g;
g.localStorage = store();
g.sessionStorage = store();
g.location = { origin: BASE };
// Relative URLs ("/api/...") work in a browser; give Node's fetch the same behaviour.
const nodeFetch = g.fetch.bind(g);
g.fetch = (input: any, init?: any) => nodeFetch(typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init);
