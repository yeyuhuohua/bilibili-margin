import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const win = process.platform === 'win32';
const executable = (local, fallback) => existsSync(local) ? resolve(local) : fallback;

const normalize = file => win ? resolve(file).toLowerCase() : resolve(file);
export function validateReport(name, report, expectedFiles = []) {
  if (name === 'gitleaks') {
    if (!Array.isArray(report) || report.length) throw new Error('Secret scan is incomplete or has findings');
    return { findings: 0 };
  }
  if (!report || typeof report !== 'object' || (report.errors?.length ?? 0)) throw new Error('Scanner report contains errors');
  if (name === 'semgrep-rules') {
    const checks = Object.values(report.results ?? {}).flatMap(config => Object.values(config.checks ?? {}));
    if (report.config_with_errors?.length || report.config_missing_tests?.length || checks.length !== 5 || checks.some(check => check.passed !== true || check.errors?.length)) throw new Error('Security rule tests did not all pass');
    return { rulesPassed: checks.length };
  }
  if (!Array.isArray(report.results)) throw new Error('Scanner report is missing results');
  if (name === 'semgrep') {
    const scanned = report.paths?.scanned;
    if (!Array.isArray(scanned) || !scanned.length) throw new Error('No source files were scanned');
    if (report.results.length || report.skipped_rules?.length) throw new Error('Source scan has findings or skipped rules');
    const seen = new Set(scanned.map(normalize));
    const missing = expectedFiles.filter(file => !seen.has(normalize(file)));
    if (missing.length) throw new Error(`Source files were skipped: ${missing.join(', ')}`);
    return { scannedFiles: scanned.length, expectedSourceFiles: expectedFiles.length, findings: 0 };
  }
  if (report.results.some(source => source.packages?.some(pkg => pkg.vulnerabilities?.length))) throw new Error('Dependency scan has known vulnerabilities');
  return { knownVulnerabilities: 0 };
}

function sourceFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function execute(command, args, env) {
  return new Promise(done => {
    const child = spawn(command, args, { env, windowsHide: true, detached: !win });
    let stdout = '', stderr = '', error;
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', value => { error = value.message; });
    const timer = setTimeout(() => {
      error = 'Scanner timed out after 120 seconds';
      if (!child.pid) return;
      if (win) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Child already exited. */ } }
    }, 120_000);
    child.on('close', status => { clearTimeout(timer); done({ status, stdout, stderr, error }); });
  });
}

async function main() {
  mkdirSync('artifacts', { recursive: true });
  mkdirSync('.security-tools', { recursive: true });
  const environment = {
    ...process.env, PYTHONUTF8: '1', SEMGREP_SEND_METRICS: 'off', SEMGREP_ENABLE_VERSION_CHECK: '0',
    SEMGREP_SETTINGS_FILE: resolve('.security-tools/semgrep-settings.yml'),
    SEMGREP_LOG_FILE: resolve('.security-tools/semgrep.log'), OTEL_SDK_DISABLED: 'true',
    XDG_CONFIG_HOME: resolve('.security-tools'),
  };
  delete environment.SEMGREP_APP_TOKEN;
  const semgrep = executable(win ? '.security-venv/Scripts/semgrep.exe' : '.security-venv/bin/semgrep', 'semgrep');
  const checks = [
    ['gitleaks', executable(`.security-tools/gitleaks${win ? '.exe' : ''}`, 'gitleaks'), ['dir', '.', '--config', '.gitleaks.toml', '--redact', '--report-format', 'json', '--report-path', 'artifacts/gitleaks.json', '--no-banner']],
    ['semgrep-rules', semgrep, ['--legacy', 'scan', '--test', '--config', 'security/semgrep.yml', 'security/semgrep.ts', '--metrics=off', '--disable-version-check', '--json']],
    // This preview is nested in a larger workspace repository. Bound discovery to this project.
    ['semgrep', semgrep, ['--legacy', 'scan', '--config', 'security/semgrep.yml', '--metrics=off', '--disable-version-check', '--no-git-ignore', '--project-root', resolve('.'), '--json', '--output', 'artifacts/semgrep.json', '--error', '--strict', '--jobs=2', 'src']],
    ['osv', executable(`.security-tools/osv-scanner${win ? '.exe' : ''}`, 'osv-scanner'), ['scan', 'source', '--lockfile=package-lock.json', '--format=json', '--output-file=artifacts/osv.json']],
  ];
  const expected = sourceFiles('src');
  const results = [];
  for (const [name, command, args] of checks) {
    const file = `artifacts/${name}.json`;
    rmSync(file, { force: true });
    const result = await execute(command, args, environment);
    writeFileSync(`artifacts/${name}-run.log`, `${result.stdout}${result.stderr}${result.error ? `\n${result.error}` : ''}`);
    let error = result.error, details;
    try {
      if (name === 'semgrep-rules' && result.stdout) writeFileSync(file, result.stdout);
      if (result.status !== 0 || error) throw new Error(error || `Scanner exited with code ${result.status}`);
      details = validateReport(name, JSON.parse(readFileSync(file, 'utf8')), expected);
    } catch (value) { error = value.message; }
    const ok = result.status === 0 && !error;
    results.push({ name, exitCode: result.status, ok, error, ...details });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}; report: ${file}${error ? `; ${error}` : ''}`);
  }
  writeFileSync('artifacts/security-checks.json', JSON.stringify(results, null, 2));
  if (results.some(result => !result.ok)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
