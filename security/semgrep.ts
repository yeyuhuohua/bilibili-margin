// These intentionally unsafe examples are scanner tests, never extension inputs.
declare const element: HTMLElement;
declare const remoteHtml: string;
declare const input: string;
declare const APP_AUTH_KEY: string;
declare const auth: unknown;

// ruleid: margin-no-dynamic-html
element.innerHTML = remoteHtml;
// ok: margin-no-dynamic-html
element.textContent = remoteHtml;

// ruleid: margin-no-code-evaluation
eval(input);

// ruleid: margin-no-persistent-app-auth
chrome.storage.local.get(APP_AUTH_KEY);
// ruleid: margin-no-persistent-app-auth
chrome.storage.local.set({ [APP_AUTH_KEY]: auth });
// ok: margin-no-persistent-app-auth
chrome.storage.session.set({ [APP_AUTH_KEY]: auth });

// ruleid: margin-no-sensitive-logs
console.log(document.cookie);

// ruleid: margin-optional-network-gate
fetch('https://ipwho.is/');
