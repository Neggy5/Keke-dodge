// Keke Dodge Online v2 — production-friendly Node server
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
const MAX_BODY = 8192;
fs.mkdirSync(DIR, { recursive: true });

const emptyDb = () => ({ scores: [], chat: [] });
let db = emptyDb();
try {
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  db = { scores: Array.isArray(parsed.scores) ? parsed.scores : [], chat: Array.isArray(parsed.chat) ? parsed.chat : [] };
} catch {}

let dirty = false, writing = false;
const persist = () => {
  if (!dirty || writing) return;
  writing = true;
  const tmp = FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (!err) fs.rename(tmp, FILE, () => { dirty = false; writing = false; });
    else { writing = false; }
  });
};
setInterval(persist, 2000);
process.on('SIGTERM', () => { try { fs.mkdirSync(DIR, {recursive:true}); fs.writeFileSync(FILE, JSON.stringify(db)); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { fs.mkdirSync(DIR, {recursive:true}); fs.writeFileSync(FILE, JSON.stringify(db)); } catch {} process.exit(0); });

const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const ipOf = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || 'unknown';

const limits = new Map();
function tooFast(req, action, ms) {
  const key = ipOf(req) + ':' + action, now = Date.now(), last = limits.get(key) || 0;
  if (now - last < ms) return true;
  limits.set(key, now); return false;
}
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [k,v] of limits) if (v < cutoff) limits.delete(k);
}, 60000);

const runs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [k,v] of runs) if (v < cutoff) runs.delete(k);
}, 60000);

const clients = new Set();
function broadcast(event, data) {
  const msg = (event ? `event: ${event}\n` : '') + `data: ${data}\n\n`;
  for (const c of [...clients]) {
    try { c.write(msg); } catch { clients.delete(c); }
  }
}
function json(res, code, obj, extra={}) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store', ...extra});
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let b = '';
  for await (const chunk of req) {
    b += chunk;
    if (Buffer.byteLength(b) > MAX_BODY) return {};
  }
  try { return JSON.parse(b); } catch { return {}; }
}
const top = () => db.scores.slice().sort((a,b)=>b.s-a.s || a.t-b.t).slice(0,20).map(({n,s})=>({n,s}));
const stats = () => ({ players: clients.size, scores: db.scores.length, messages: db.chat.length });

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && (p==='/' || p==='/index.html')) {
    return fs.readFile(path.join(__dirname,'public','index.html'), (e,buf) => {
      if (e) return json(res,500,{error:'missing index.html'});
      res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});
      res.end(buf);
    });
  }
  if (req.method === 'GET' && p==='/health') return json(res,200,{ok:true,version:2,uptime:Math.round(process.uptime()),time:Date.now()});
  if (req.method === 'GET' && p==='/api/stats') return json(res,200,stats());

  if (p==='/api/run' && req.method==='POST') {
    if (tooFast(req,'run',500)) return json(res,429,{error:'slow down'});
    const id = crypto.randomBytes(12).toString('hex');
    runs.set(id, Date.now());
    return json(res,200,{id});
  }

  if (p==='/api/scores') {
    if (req.method==='GET') return json(res,200,top());
    if (req.method==='POST') {
      if (tooFast(req,'score',1000)) return json(res,429,{error:'slow down'});
      const b=await readBody(req), start=runs.get(String(b.id||''));
      const name=clean(b.name,12)||'Anon', score=Math.floor(Number(b.score));
      if (!start || !Number.isFinite(score) || score<0 || score>1000000) return json(res,400,{error:'rejected'});
      runs.delete(String(b.id));
      const secs=(Date.now()-start)/1000;
      if (secs < 1 || score > secs*180+150) return json(res,400,{error:'score validation failed'});
      const mine=db.scores.find(x=>String(x.n).toLowerCase()===name.toLowerCase());
      if (mine) { if(score>mine.s){mine.s=score;mine.t=Date.now();} }
      else db.scores.push({n:name,s:score,t:Date.now()});
      db.scores.sort((a,b)=>b.s-a.s).splice(200);
      dirty=true;
      const result=top();
      broadcast('leaderboard',JSON.stringify(result));
      return json(res,200,result);
    }
  }

  if (p==='/api/chat') {
    if (req.method==='GET') return json(res,200,db.chat.slice(-50));
    if (req.method==='POST') {
      if (tooFast(req,'chat',1200)) return json(res,429,{error:'slow down'});
      const b=await readBody(req), text=clean(b.text,200), name=clean(b.name,12)||'Anon';
      if(!text) return json(res,400,{error:'empty'});
      const blocked=/\b(?:porn|n[i1]gger|faggot|kill yourself)\b/i;
      if(blocked.test(text)) return json(res,400,{error:'message blocked'});
      const msg={id:Date.now().toString(36)+'-'+crypto.randomBytes(3).toString('hex'),n:name,m:text,t:Date.now()};
      db.chat.push(msg); db.chat=db.chat.slice(-200); dirty=true;
      broadcast('chat',JSON.stringify(msg));
      return json(res,200,{ok:true});
    }
  }

  if (p==='/api/chat/stream' && req.method==='GET') {
    res.writeHead(200, {'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
    res.write(': connected\n\n');
    clients.add(res);
    broadcast('online',String(clients.size));
    const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},15000);
    req.on('close',()=>{clearInterval(ping);clients.delete(res);broadcast('online',String(clients.size));});
    return;
  }

  if (p==='/api/chat/stream' && req.method!=='GET') return json(res,405,{error:'method not allowed'});
  return json(res,404,{error:'not found'});
});

server.keepAliveTimeout=65000;
server.headersTimeout=66000;
server.listen(PORT,'0.0.0.0',()=>console.log(`Keke Dodge v2 listening on ${PORT}`));
