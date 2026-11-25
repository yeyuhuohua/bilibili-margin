import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'));
const policy = new Map<string, string[]>(manifest.content_security_policy.extension_pages.split(';').map((part: string) => { const [name, ...values] = part.trim().split(/\s+/); return [name, values]; }));
describe('weather CSP recovery', () => {
  it('allows explicit optional weather endpoints without wildcard sources', () => {
    expect(new Set(policy.get('connect-src'))).toEqual(new Set(["'self'", 'https://app.bilibili.com', 'https://bsbsb.top', 'https://api.github.com', 'https://github.com', 'https://ipwho.is', 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com', 'https://www.nmc.cn']));
  });
  it('keeps script restrictions and only adds what the reminder needs', () => {
    expect(policy.get('script-src')).toEqual(["'self'"]); expect(policy.get('object-src')).toEqual(["'none'"]);
    // 定时检查只需要 alarms；不碰定位等敏感权限，也没有通知权限
    expect(manifest.permissions).toEqual(['storage', 'alarms']);
    expect(manifest.permissions).not.toContain('geolocation');
    expect(manifest.permissions).not.toContain('notifications');
    expect(manifest.host_permissions).toEqual(['https://app.bilibili.com/*', 'https://bsbsb.top/*']);
    expect(manifest.optional_host_permissions).toEqual(['https://github.com/*']);
  });
});
