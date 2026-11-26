import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('../docs',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://local').pathname);if(p==='/')p='/index.html';let file=resolve(root,'.'+p);if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}if(!(await stat(file)).isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));}catch{res.writeHead(404).end('Not found');}});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port));
