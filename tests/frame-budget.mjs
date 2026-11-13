import assert from 'node:assert/strict';
import { build } from 'vite';
import { chromium } from 'playwright';

const bundle = await build({ configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry: 'tests/frame-budget-entry.ts', name: 'frameTest', formats: ['iife'] },
} });
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find((x) => x.type === 'chunk').code;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }) });
try {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  // The standalone scheduler fixture has no extension storage environment.
  await page.evaluate(() => Object.defineProperty(globalThis, 'chrome', {
    configurable: true, value: { storage: { onChanged: { addListener() {} } } },
  }));
  await page.addScriptTag({ content: code });
  for (const hz of [60, 100, 120, 144, 165, 240]) {
    const result = await page.evaluate((hz) => frameTest.frameBudget(hz), hz);
    console.log(`scheduler ${hz}Hz: ${JSON.stringify(result)} draws in three-second phases`);
    for (const name of ['full', 'restored', 'resumed']) {
      assert.equal(result[name].draws, hz * 3, `${hz}Hz ${name} draws every native frame`);
      assert.ok(Math.abs(result[name].maxGap - 1000 / hz) < .001, `${hz}Hz ${name} has no artificial skipped frames`);
    }
    assert.ok(result.capped.draws >= 88 && result.capped.draws <= 92, `${hz}Hz explicit 30fps cap`);
    assert.equal(result.adaptiveAfterCap, 0, `${hz}Hz intentional cap is not mistaken for overload`);
    const protection = await page.evaluate((hz) => frameTest.frameProtection(hz), hz);
    console.log(`protection ${hz}Hz: ${JSON.stringify(protection)}`);
    assert.equal(protection.costlyMs, 1000 / 30, `${hz}Hz sustained draw cost lowers the rate`);
    assert.equal(protection.stillCostlyMs, 1000 / 30, `${hz}Hz persistent cost stays limited`);
    assert.ok(protection.costly.draws >= 88 && protection.costly.draws <= 92, `${hz}Hz overload keeps a 30fps cadence`);
    assert.equal(protection.recoveredMs, 0, `${hz}Hz sustained healthy frames restore the native rate`);
    assert.equal(protection.recovered.draws, hz * 3, `${hz}Hz recovery restores high refresh`);
    assert.equal(protection.droppedMs, 1000 / 30, `${hz}Hz sustained missed frames also lower the rate`);
  }
} finally { await browser.close(); }
