import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Official release assets, pinned to the SHA-256 digests published by GitHub.
const assets = [
  { name: 'gitleaks.zip', url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip', sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e' },
  { name: 'osv-scanner.exe', url: 'https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_windows_amd64.exe', sha256: '9964ed64ec9a387391eb4cc006ad5c531154821aef29b793e02c448de4686438' },
];
await mkdir('.security-tools', { recursive: true });
const verified = [];
for (const asset of assets) {
  const file = `.security-tools/${asset.name}`;
  let bytes = await readFile(file).catch(() => null);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Download failed: ${asset.name}, HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.name}`);
  await writeFile(file, bytes);
  verified.push({ ...asset, bytes: bytes.length });
  console.log(`Verified ${asset.name}`);
}
await writeFile('.security-tools/verified.json', JSON.stringify(verified, null, 2));
