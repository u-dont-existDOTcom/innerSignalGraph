import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const hash = content => createHash('sha256').update(content).digest('base64');
/** Deterministic single-file build. No bundler, network or runtime imports. */
export async function buildPreview() {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const files = await Promise.all(['../policy.mjs', './model.mjs', './view.mjs'].map(read));
  const script = `'use strict';\n(() => {\n${files.map(content => content
    .replace(/^import \{[^\n]+\} from '[^']+';\n/gm, '')
    .replace(/^export (?=(?:const|function) )/gm, '')).join('\n')}\n})();\n`;
  if (/^\s*(import|export)\s/m.test(script) || /<\/script/i.test(script)) {
    throw new Error('Unsupported source in standalone preview');
  }
  const template = await read('./shell.html');
  for (const token of ['__SCRIPT__', '__CSP__']) {
    if (template.split(token).length !== 2) throw new Error('Missing or duplicate build token');
  }
  const css = template.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  if (!css) throw new Error('Missing preview CSS');
  const policy = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return template.replace('__CSP__', () => policy).replace('__SCRIPT__', () => script);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (!output || !output.endsWith('.html')) throw new Error('Supply an output .html path');
  await writeFile(output, await buildPreview(), { flag: 'wx' });
  console.log(`Built standalone fictional preview: ${output}`);
}
