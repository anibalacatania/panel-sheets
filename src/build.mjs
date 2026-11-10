// Genera index.html a partir de src/: compila el JSX y arma el CSS de Tailwind.
// Así el navegador no tiene que traducir nada al abrir la app (carga mucho más rápida).
//
// Uso (desde la carpeta del repositorio):
//   npm i -D @babel/core @babel/preset-react @babel/preset-env tailwindcss@3 terser
//   node src/build.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'package.json'));
const babel = require('@babel/core');
const { minify } = require('terser');

const SRC = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(SRC, '..');

// 1) JS: JSX -> JavaScript compatible con navegadores de los últimos años
const jsx = readFileSync(join(SRC, 'app.jsx'), 'utf8');
const { code } = babel.transformSync(jsx, {
  babelrc: false, configFile: false,
  presets: [
    [require.resolve('@babel/preset-env'), { targets: 'defaults, safari >= 12, chrome >= 64', modules: false }],
    [require.resolve('@babel/preset-react'), { runtime: 'classic' }],
  ],
});
const js = (await minify(code, { compress: true, mangle: true })).code;

// 2) CSS: solo las clases de Tailwind que usa la app
const tmp = mkdtempSync(join(tmpdir(), 'tw-'));
const cfg = join(tmp, 'tailwind.config.cjs');
writeFileSync(cfg, `module.exports = { content: [${JSON.stringify(join(SRC, 'app.jsx'))}, ${JSON.stringify(join(SRC, 'plantilla.html'))}] };`);
const salidaCss = join(tmp, 'out.css');
execFileSync(require.resolve('tailwindcss/lib/cli.js'), ['-c', cfg, '-i', join(SRC, 'estilos.css'), '-o', salidaCss, '--minify'], { stdio: 'inherit' });
const css = readFileSync(salidaCss, 'utf8');

// 3) Armar index.html
const html = readFileSync(join(SRC, 'plantilla.html'), 'utf8')
  .replace('/*CSS*/', () => css)
  .replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script'));
writeFileSync(join(RAIZ, 'index.html'), html);
console.log(`index.html generado: ${(html.length / 1024).toFixed(0)} KB (JS ${(js.length / 1024).toFixed(0)} KB, CSS ${(css.length / 1024).toFixed(0)} KB)`);
