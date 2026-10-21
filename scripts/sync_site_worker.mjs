import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = resolve(root, 'site/worker/index.js');
const [html, parser, ui, source] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'ocr-parser.js'), 'utf8'),
  readFile(resolve(root, 'ocr-ui.js'), 'utf8'),
  readFile(workerPath, 'utf8'),
]);

const jsonStart = source.indexOf('const json=');
if (jsonStart < 0) throw new Error('Worker JSON helper marker is missing.');
const prefix = source.slice(0, source.indexOf('const HTML='));
if (!prefix && !source.startsWith('const HTML=')) throw new Error('Worker HTML marker is missing.');
let rest = source.slice(jsonStart);
const routeMarker = ' const url=new URL(request.url);\n';
if (!rest.includes(routeMarker)) throw new Error('Worker request router marker is missing.');
const routes = " const url=new URL(request.url);\n if(url.pathname==='/ocr-parser.js')return new Response(OCR_PARSER,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});\n if(url.pathname==='/ocr-ui.js')return new Response(OCR_UI,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});\n";
// Re-running this sync must replace, not accumulate, the two OCR asset routes.
rest = rest.replace(/ if\(url\.pathname==='\/ocr-(?:parser|ui)\.js'\)return new Response\(OCR_(?:PARSER|UI),\{headers:\{'content-type':'application\/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'\}\}\);\n/g, '');
rest = rest.replace(routeMarker, routes);
const output = `${prefix}const HTML=${JSON.stringify(html)};\nconst OCR_PARSER=${JSON.stringify(parser)};\nconst OCR_UI=${JSON.stringify(ui)};\n${rest}`;
await writeFile(workerPath, output);
console.log('Synced dashboard HTML and local OCR assets into the Sites Worker.');
