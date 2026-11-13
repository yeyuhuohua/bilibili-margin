import { APP_AUTH_KEY, type AppAuth } from '../shared/app-feed';

const MAX_AGE = 30 * 86400;
interface SavedAuth { remember: boolean; auth?: AppAuth }

// Extension-origin IndexedDB keeps remembered credentials out of content-script
// storage.local access and settings exports.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('margin-app-auth', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('auth');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function stored(next?: SavedAuth): Promise<SavedAuth> {
  const db = await database();
  try {
    return await new Promise<SavedAuth>((resolve, reject) => {
      const tx = db.transaction('auth', next ? 'readwrite' : 'readonly');
      const store = tx.objectStore('auth');
      const request = next ? store.put(next, 'current') : store.get('current');
      tx.oncomplete = () => resolve(next ?? request.result ?? { remember: false });
      tx.onabort = () => reject(tx.error ?? new Error('授权保存失败'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

async function current(): Promise<{ saved: SavedAuth; auth?: AppAuth }> {
  const saved = await stored();
  const session = (await chrome.storage.session.get(APP_AUTH_KEY))[APP_AUTH_KEY] as AppAuth | undefined;
  const auth = saved.remember ? saved.auth : session;
  if (!auth) return { saved };
  if (!Number.isFinite(auth.exp) || auth.exp * 1000 <= Date.now()) {
    await stored({ remember: saved.remember });
    await chrome.storage.session.remove(APP_AUTH_KEY);
    return { saved: { remember: saved.remember } };
  }
  return { saved, auth };
}

export const readAppAuth = () => serial(async () => (await current()).auth ?? null);
export const appAuthState = () => serial(async () => {
  const { saved, auth } = await current();
  return { ok: true, authed: !!auth, remember: saved.remember, mid: auth?.mid ?? 0, exp: auth?.exp ?? 0 };
});

export const saveAppAuth = (auth: AppAuth) => serial(async () => {
  const saved = await stored();
  if (saved.remember) {
    auth = { ...auth, exp: Math.min(auth.exp, Math.floor(Date.now() / 1000) + MAX_AGE) };
    await stored({ remember: true, auth });
    await chrome.storage.session.remove(APP_AUTH_KEY);
  } else {
    await chrome.storage.session.set({ [APP_AUTH_KEY]: auth });
  }
});

export const rememberAppAuth = (remember: boolean) => serial(async () => {
  const { auth } = await current();
  const limited = auth && { ...auth, exp: Math.min(auth.exp, Math.floor(Date.now() / 1000) + MAX_AGE) };
  if (remember) {
    await stored({ remember: true, auth: limited });
    await chrome.storage.session.remove(APP_AUTH_KEY);
  } else {
    // Keep the current login for this session before deleting the saved copy.
    if (auth) await chrome.storage.session.set({ [APP_AUTH_KEY]: auth });
    await stored({ remember: false });
  }
});

// A failed old request must not revoke a newer login from another tab.
export const revokeAppAuth = (key?: string) => serial(async () => {
  const { saved, auth } = await current();
  if (key && auth?.key !== key) return;
  await stored({ remember: saved.remember });
  await chrome.storage.session.remove(APP_AUTH_KEY);
});
