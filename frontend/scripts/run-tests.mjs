// Run the existing node:test TypeScript suites without a bundler (Node 24).
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/') || specifier.startsWith('.')) {
      const url = new URL(specifier.startsWith('@/') ? specifier.slice(2) : specifier,
        specifier.startsWith('@/') ? root : context.parentURL);
      for (const extension of ['.ts', '.tsx', '/index.ts']) {
        const candidate = new URL(url.href + extension);
        if (existsSync(candidate)) return next(candidate.href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) {
      return { format: 'module', shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }) };
    }
    return next(url, context);
  },
});

const files = readdirSync(new URL('features/', root), { recursive: true })
  .filter(path => path.endsWith('.test.ts')).sort();
for (const path of files) await import(new URL('features/' + path.replaceAll('\\', '/'), root));
