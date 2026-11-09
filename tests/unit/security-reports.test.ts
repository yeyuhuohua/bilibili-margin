import { describe, expect, it } from 'vitest';
import { validateReport } from '../../scripts/security-checks.mjs';

describe('安全扫描通过条件', () => {
  const clean = { results: [], errors: [], skipped_rules: [], paths: { scanned: ['src/first.ts', 'src/second.ts'] } };
  it('未扫描源码不能判为通过', () => {
    expect(() => validateReport('semgrep', { ...clean, paths: { scanned: [] } })).toThrow('No source files');
  });
  it('已知源码文件被遗漏不能判为通过', () => {
    expect(() => validateReport('semgrep', clean, ['src/first.ts', 'src/missing.ts'])).toThrow('skipped');
  });
  it('源码覆盖完整、无错误、无发现才通过', () => {
    expect(validateReport('semgrep', clean, ['src/first.ts', 'src/second.ts'])).toEqual({ scannedFiles: 2, expectedSourceFiles: 2, findings: 0 });
  });
  it.each([{ results: [{ check_id: 'fixture' }] }, { errors: [{ message: 'parse failed' }] }, { skipped_rules: ['fixture'] }])('拒绝发现、错误或跳过的规则 %j', patch => {
    expect(() => validateReport('semgrep', { ...clean, ...patch })).toThrow();
  });
  it('规则没有正反样本或有失败时不能通过', () => {
    const checks = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [String(index), { passed: true, errors: [] }]));
    const report = { results: { fixture: { checks } }, config_with_errors: [], config_missing_tests: [] };
    expect(validateReport('semgrep-rules', report)).toEqual({ rulesPassed: 5 });
    expect(() => validateReport('semgrep-rules', { results: {} })).toThrow();
    checks['0'].passed = false;
    expect(() => validateReport('semgrep-rules', report)).toThrow();
  });
  it('凭据匹配与依赖漏洞不能判为通过', () => {
    expect(validateReport('gitleaks', [])).toEqual({ findings: 0 });
    expect(() => validateReport('gitleaks', [{ Secret: 'REDACTED' }])).toThrow();
    expect(validateReport('osv', { results: [] })).toEqual({ knownVulnerabilities: 0 });
    expect(() => validateReport('osv', { results: [{ packages: [{ vulnerabilities: [{ id: 'fixture' }] }] }] })).toThrow();
    expect(() => validateReport('osv', {})).toThrow();
  });
});
