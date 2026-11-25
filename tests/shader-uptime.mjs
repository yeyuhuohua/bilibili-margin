import assert from 'node:assert/strict';
import { build } from 'vite';
import { chromium } from 'playwright';

const bundle = await build({ configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, lib: { entry: 'src/content/bg/program.ts', name: 'shaderTest', formats: ['iife'] },
} });
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(x => x.type === 'chunk').code;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : { channel:'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content:code });
  const invalid = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 64;
    const gl = canvas.getContext('webgl');
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    const errors = [];
    for (const id of ['mesh','aurora']) {
      const program = new shaderTest.ShaderProgram(gl,id);
      if (!gl.getProgramParameter(program.prog,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program.prog));
      program.bind();
      for (const time of [0,600,3600,86400]) for (const theme of ['light','dark']) {
        program.draw(canvas.width,canvas.height,time,theme);
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        for (let i=0; i<pixels.length; i+=4) {
          if (pixels[i]+pixels[i+1]+pixels[i+2] === 0) { errors.push({ id,time,theme }); break; }
        }
      }
    }
    return errors;
  });
  assert.deepEqual(invalid, []);
  console.log('PASS mesh and aurora pixel readback at 0, 600, 3600 and 86400 seconds in both themes');
} finally { await browser.close(); }
