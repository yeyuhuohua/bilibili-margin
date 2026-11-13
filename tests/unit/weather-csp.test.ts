import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'));
const policy = new Map<string, string[]>(manifest.content_security_policy.extension_pages.split(';').map((part: string) => { const [name, ...values] = part.trim().split(/\s+/); return [name, values]; }));
describe('weather CSP recovery', () => {
  it('allows the three existing optional weather endpoints without wildcard sources', () => {
    expect(new Set(policy.get('connect-src'))).toEqual(new Set(["'self'", 'https://app.bilibili.com', 'https://bsbsb.top', 'https://api.github.com', 'https://ipwho.is', 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com']));
  });
  it('keeps script restrictions and avoids geolocation or new host permissions', () => {
    expect(policy.get('script-src')).toEqual(["'self'"]); expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(manifest.permissions).toEqual(['storage']); expect(manifest.host_permissions).toEqual(['https://app.bilibili.com/*', 'https://bsbsb.top/*']);
  });
});
