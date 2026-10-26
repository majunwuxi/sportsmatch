import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = resolve(root, 'site/worker/index.js');
const [html, parser, ui, parlayParser, parlayUi, teamMap, basketballTeams, logo, source] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'ocr-parser.js'), 'utf8'),
  readFile(resolve(root, 'ocr-ui.js'), 'utf8'),
  readFile(resolve(root, 'parlay-parser.js'), 'utf8'),
  readFile(resolve(root, 'parlay-ui.js'), 'utf8'),
  readFile(resolve(root, 'teams-map.js'), 'utf8'),
  readFile(resolve(root, 'basketball-teams.js'), 'utf8'),
  readFile(resolve(root, 'assets/match-monitor-logo.webp')),
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
 if(url.pathname==='/parlay-parser.js')return new Response(PARLAY_PARSER,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(url.pathname==='/parlay-ui.js')return new Response(PARLAY_UI,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(url.pathname==='/teams-map.js')return new Response(TEAM_MAP_JS,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(url.pathname==='/basketball-teams.js')return new Response(BASKETBALL_TEAM_JS,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 // BRAND_LOGO_ROUTE_BEGIN
 if(url.pathname==='/brand-logo.webp'){
   if(request.method!=='GET')return json({detail:'Method not allowed'},405);
   const image=Uint8Array.from(atob(BRAND_LOGO_B64),c=>c.charCodeAt(0));
   return new Response(image,{headers:{'content-type':'image/webp','cache-control':'public, max-age=604800','x-content-type-options':'nosniff'}})
 }
 // BRAND_LOGO_ROUTE_END
 // TEAM_LOGO_PROXY_ROUTE_BEGIN
 if(url.pathname.startsWith('/team-logo/')){
   const match=url.pathname.match(/^\\/team-logo\\/(\\d+)\\.png$/);
   if(!match)return json({detail:'球队队徽不存在'},404);
   if(request.method!=='GET')return json({detail:'Method not allowed'},405);
   const id=match[1],entry=TEAM_DIRECTORY[id];
   if(!hasRegisteredTeamLogo(entry))return json({detail:'球队队徽不存在'},404);
   if(!env.BACKEND_URL||!env.BACKEND_USER||!env.BACKEND_PASSWORD)return json({detail:'独立监测后台尚未配置'},503);
   let backend;
   try{backend=new URL(env.BACKEND_URL);if(backend.protocol!=='https:'||backend.username||backend.password)throw Error('invalid backend url');backend.pathname='/team-logo/'+id+'.png';backend.search='';backend.hash=''}catch{return json({detail:'后台必须使用HTTPS地址'},503)}
   let timer;
   try{
     const controller=new AbortController();
     timer=setTimeout(()=>controller.abort(),8000);
     const authorization='Basic '+btoa(Array.from(new TextEncoder().encode(env.BACKEND_USER+':'+env.BACKEND_PASSWORD),b=>String.fromCharCode(b)).join(''));
     const upstream=await fetch(backend.toString(),{method:'GET',headers:{authorization},redirect:'manual',signal:controller.signal});
     if(upstream.status>=300&&upstream.status<400)return json({detail:'后台返回重定向，已拒绝转发凭证'},502);
     if(!upstream.ok)return json({detail:'后台无法提供球队队徽'},502);
     if(upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/png')return json({detail:'后台返回了非PNG队徽'},502);
     const size=Number(upstream.headers.get('content-length')||0);
     if(size>2097152)return json({detail:'球队队徽图片超过大小限制'},502);
     const image=new Uint8Array(await upstream.arrayBuffer());
     if(image.byteLength>2097152)return json({detail:'球队队徽图片超过大小限制'},502);
     if(image.byteLength<8||image[0]!==137||image[1]!==80||image[2]!==78||image[3]!==71||image[4]!==13||image[5]!==10||image[6]!==26||image[7]!==10)return json({detail:'后台返回的队徽不是有效PNG'},502);
     return new Response(image,{headers:{'content-type':'image/png','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'}})
   }catch{return json({detail:'暂时无法连接独立监测后台'},502)}finally{clearTimeout(timer)}
 }
 // TEAM_LOGO_PROXY_ROUTE_END
`;
// Re-running this sync must replace, not accumulate, embedded asset routes.
rest = rest.replace(/ if\(url\.pathname==='\/(?:ocr-(?:parser|ui)|parlay-(?:parser|ui))\.js'\)return new Response\((?:OCR_(?:PARSER|UI)|PARLAY_(?:PARSER|UI)),\{headers:\{'content-type':'application\/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'\}\}\);\n| if\(url\.pathname==='\/(?:teams-map\.js|basketball-teams\.js)'\)return new Response\((?:TEAM_MAP_JS|BASKETBALL_TEAM_JS),\{headers:\{'content-type':'application\/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'\}\}\);\n/g, '');
rest = rest.replace(/ \/\/ BRAND_LOGO_ROUTE_BEGIN[\s\S]*? \/\/ BRAND_LOGO_ROUTE_END\n/g, '');
// Clean up the unmarked form generated by the first logo-route sync.
rest = rest.replace(/ if\(url\.pathname==='\/brand-logo\.webp'\)\{\n[\s\S]*?\n \}\n/g, '');
rest = rest.replace(/ \/\/ TEAM_LOGO_PROXY_ROUTE_BEGIN[\s\S]*? \/\/ TEAM_LOGO_PROXY_ROUTE_END\n/g, '');
rest = rest.replace(routeMarker, routes);
rest = rest.replace(/img-src 'self'[^;]+/, "img-src 'self' blob: data: https://cdn.nba.com https://cdn.wnba.com");
const output = `${prefix}const HTML=${JSON.stringify(html)};\nconst OCR_PARSER=${JSON.stringify(parser)};\nconst OCR_UI=${JSON.stringify(ui)};\nconst PARLAY_PARSER=${JSON.stringify(parlayParser)};\nconst PARLAY_UI=${JSON.stringify(parlayUi)};\nconst TEAM_MAP_JS=${JSON.stringify(teamMap)};\nconst BASKETBALL_TEAM_JS=${JSON.stringify(basketballTeams)};\nconst BRAND_LOGO_B64=${JSON.stringify(logo.toString('base64'))};\nconst TEAM_DIRECTORY=JSON.parse(TEAM_MAP_JS.slice("globalThis.MatchMonitorTeamDirectory=".length).trim().replace(/;$/, ""));\nfunction hasRegisteredTeamLogo(entry){if(typeof entry?.logo!=="string")return false;try{const logo=new URL(entry.logo);return logo.protocol==="https:"&&Boolean(logo.hostname)&&!logo.username&&!logo.password&&!logo.port}catch{return false}}\n${rest}`;
await writeFile(workerPath, output);
console.log('Synced dashboard HTML, OCR assets, and team directory into the Sites Worker.');
