import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = resolve(root, 'site/worker/index.js');
const [html, parser, ui, teamMap, source] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'ocr-parser.js'), 'utf8'),
  readFile(resolve(root, 'ocr-ui.js'), 'utf8'),
  readFile(resolve(root, 'teams-map.js'), 'utf8'),
  readFile(workerPath, 'utf8'),
]);

const jsonStart = source.indexOf('const json=');
if (jsonStart < 0) throw new Error('Worker JSON helper marker is missing.');
const prefix = source.slice(0, source.indexOf('const HTML='));
if (!prefix && !source.startsWith('const HTML=')) throw new Error('Worker HTML marker is missing.');
let rest = source.slice(jsonStart);
const routeMarker = ' const url=new URL(request.url);\n';
if (!rest.includes(routeMarker)) throw new Error('Worker request router marker is missing.');
const routes = ` const url=new URL(request.url);
 if(url.pathname==='/ocr-parser.js')return new Response(OCR_PARSER,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(url.pathname==='/ocr-ui.js')return new Response(OCR_UI,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(url.pathname==='/teams-map.js')return new Response(TEAM_MAP_JS,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 // TEAM_LOGO_PROXY_ROUTE_BEGIN
 if(url.pathname.startsWith('/team-logo/')){const match=url.pathname.match(/^\\/team-logo\\/(\\d+)\\.png$/);if(!match)return json({detail:'球队队徽不存在'},404);if(request.method!=='GET')return json({detail:'Method not allowed'},405);const id=match[1],entry=TEAM_DIRECTORY[id],logoUrl='https://media.api-sports.io/football/teams/'+id+'.png';if(!entry||entry.logo!==logoUrl)return json({detail:'球队队徽不存在'},404);let timer;try{const controller=new AbortController();timer=setTimeout(()=>controller.abort(),8000);const upstream=await fetch(logoUrl,{method:'GET',redirect:'error',signal:controller.signal});if(!upstream.ok||upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/png')return json({detail:'暂时无法加载球队队徽'},502);const size=Number(upstream.headers.get('content-length')||0);if(size>2097152)return json({detail:'球队队徽图片超过大小限制'},502);const image=await upstream.arrayBuffer();if(image.byteLength>2097152)return json({detail:'球队队徽图片超过大小限制'},502);return new Response(image,{headers:{'content-type':'image/png','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'}})}catch{return json({detail:'暂时无法加载球队队徽'},502)}finally{clearTimeout(timer)}}
 // TEAM_LOGO_PROXY_ROUTE_END
`;
// Re-running this sync must replace, not accumulate, the OCR and team map asset routes.
rest = rest.replace(/ if\(url\.pathname==='\/ocr-(?:parser|ui)\.js'\)return new Response\(OCR_(?:PARSER|UI),\{headers:\{'content-type':'application\/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'\}\}\);\n| if\(url\.pathname==='\/teams-map\.js'\)return new Response\(TEAM_MAP_JS,\{headers:\{'content-type':'application\/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'\}\}\);\n/g, '');
rest = rest.replace(/ \/\/ TEAM_LOGO_PROXY_ROUTE_BEGIN[\s\S]*? \/\/ TEAM_LOGO_PROXY_ROUTE_END\n/g, '');
rest = rest.replace(routeMarker, routes);
const output = `${prefix}const HTML=${JSON.stringify(html)};\nconst OCR_PARSER=${JSON.stringify(parser)};\nconst OCR_UI=${JSON.stringify(ui)};\nconst TEAM_MAP_JS=${JSON.stringify(teamMap)};\nconst TEAM_DIRECTORY=JSON.parse(TEAM_MAP_JS.slice("globalThis.MatchMonitorTeamDirectory=".length).trim().replace(/;$/, ""));\n${rest}`;
await writeFile(workerPath, output);
console.log('Synced dashboard HTML, OCR assets, and team directory into the Sites Worker.');
