// Keke Dodge Online v3 — multiplayer Abuja runner
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||3000),DIR=process.env.DATA_DIR||path.join(__dirname,'data'),FILE=path.join(DIR,'db.json'),MAX_BODY=12000;
fs.mkdirSync(DIR,{recursive:true});
const empty=()=>({players:[],scores:[],chat:[]});
let db=empty();
try{const p=JSON.parse(fs.readFileSync(FILE,'utf8'));db={players:Array.isArray(p.players)?p.players:[],scores:Array.isArray(p.scores)?p.scores:[],chat:Array.isArray(p.chat)?p.chat:[]}}catch{}
let dirty=false,writing=false;
function persist(){if(!dirty||writing)return;writing=true;const t=FILE+'.tmp';fs.writeFile(t,JSON.stringify(db),e=>{if(!e)fs.rename(t,FILE,()=>{dirty=false;writing=false});else writing=false})}
setInterval(persist,2000);
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{try{fs.writeFileSync(FILE,JSON.stringify(db))}catch{}process.exit(0)});
const clean=(s,m)=>String(s??'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,m);
const ip=req=>(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim()||'unknown';
const limits=new Map(),runs=new Map(),sessions=new Map(),clients=new Map();
function rate(req,a,ms){const k=ip(req)+':'+a,n=Date.now(),l=limits.get(k)||0;if(n-l<ms)return true;limits.set(k,n);return false}
setInterval(()=>{const c=Date.now()-120000;for(const[k,v]of limits)if(v<c)limits.delete(k);for(const[k,v]of runs)if(v.at<c)runs.delete(k)},60000);
function json(res,c,o){res.writeHead(c,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(o))}
async function body(req){let s='';for await(const ch of req){s+=ch;if(Buffer.byteLength(s)>MAX_BODY)return{}}try{return JSON.parse(s)}catch{return{}}}
function newId(){return crypto.randomBytes(12).toString('hex')}
function token(){return crypto.randomBytes(24).toString('hex')}
function player(req){const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');const id=sessions.get(t);return id?db.players.find(p=>p.id===id):null}
function top(){return db.players.slice().sort((a,b)=>b.best-a.best).slice(0,20).map((p,i)=>({rank:i+1,n:p.name,s:p.best,coins:p.coins}))}
function stats(){return{players:clients.size,registered:db.players.length,scores:db.scores.length,messages:db.chat.length}}
function send(c,event,data){try{c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}catch{clients.delete(c)}}
function broadcast(event,data,except){for(const[c]of clients)if(c!==except)send(c,event,data)}
function validName(n){return clean(n,16).replace(/[^a-zA-Z0-9 _.-]/g,'').trim()}
function unique(n,id){return !db.players.some(p=>p.id!==id&&p.name.toLowerCase()===n.toLowerCase())}
function publicPlayer(p){return{id:p.id,name:p.name,coins:p.coins,best:p.best,shieldTokens:p.shieldTokens}}

const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost'),p=u.pathname;
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization'});return res.end()}
 if(req.method==='GET'&&(p==='/'||p==='/index.html'))return fs.readFile(path.join(__dirname,'public','index.html'),(e,b)=>{if(e)return json(res,500,{error:'missing index.html'});res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(b)});
 if(req.method==='GET'&&p==='/health')return json(res,200,{ok:true,version:3,uptime:Math.round(process.uptime()),time:Date.now()});
 if(req.method==='GET'&&p==='/api/stats')return json(res,200,stats());

 if(p==='/api/profile'&&req.method==='POST'){
   if(rate(req,'profile',500))return json(res,429,{error:'slow down'});
   const b=await body(req),name=validName(b.name)||'Rider';
   if(name.length<2)return json(res,400,{error:'name too short'});
   const existing=db.players.find(x=>x.id===String(b.id||''));
   if(existing){if(!unique(name,existing.id))return json(res,409,{error:'name taken'});existing.name=name;dirty=true;sessions.set(existing.token,existing.id);return json(res,200,{token:existing.token,player:publicPlayer(existing)})}
   if(!unique(name))return json(res,409,{error:'name taken'});
   const pl={id:newId(),name,token:token(),coins:0,best:0,shieldTokens:1,created:Date.now()};
   db.players.push(pl);sessions.set(pl.token,pl.id);dirty=true;return json(res,200,{token:pl.token,player:publicPlayer(pl)});
 }
 if(p==='/api/profile'&&req.method==='GET'){const pl=player(req);if(!pl)return json(res,401,{error:'unauthorized'});return json(res,200,publicPlayer(pl))}
 if(p==='/api/run'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'run',800))return json(res,429,{error:'slow down'});
   const id=newId();runs.set(id,{player:pl.id,at:Date.now()});return json(res,200,{id})
 }
 if(p==='/api/scores'&&req.method==='GET')return json(res,200,top());
 if(p==='/api/scores'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'score',1000))return json(res,429,{error:'slow down'});
   const b=await body(req),r=runs.get(String(b.id||'')),score=Math.floor(Number(b.score)),distance=Math.floor(Number(b.distance));
   if(!r||r.player!==pl.id||!Number.isFinite(score)||score<0||score>2000000||!Number.isFinite(distance)||distance<0)return json(res,400,{error:'rejected'});
   runs.delete(String(b.id));const sec=(Date.now()-r.at)/1000,maxDist=Math.min(100000,Math.floor(sec*650+250));
   const earned=Math.max(0,Math.min(250,Math.floor(Number(b.coins)||0)));
   if(sec<1||distance>maxDist||score>distance/10+earned*12+Number(b.combo||0)*2+100)return json(res,400,{error:'score validation failed'});
   if(score>pl.best)pl.best=score;
   pl.coins+=earned;db.scores.push({player:pl.id,s:score,t:Date.now()});db.scores=db.scores.slice(-500);dirty=true;
   const result=top();broadcast('leaderboard',result);return json(res,200,{leaderboard:result,player:publicPlayer(pl),earned});
 }
 if(p==='/api/shop'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'shop',700))return json(res,429,{error:'slow down'});
   const b=await body(req);if(b.item==='shield'){if(pl.coins<50)return json(res,400,{error:'need 50 coins'});pl.coins-=50;pl.shieldTokens++;dirty=true;return json(res,200,publicPlayer(pl))}return json(res,400,{error:'unknown item'})
 }
 if(p==='/api/chat'&&req.method==='GET')return json(res,200,db.chat.slice(-50));
 if(p==='/api/chat'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'chat',1200))return json(res,429,{error:'slow down'});
   const b=await body(req),text=clean(b.text,200);if(!text)return json(res,400,{error:'empty'});
   if(/\b(?:porn|n[i1]gger|faggot|kill yourself)\b/i.test(text))return json(res,400,{error:'message blocked'});
   const msg={id:newId(),n:pl.name,m:text,t:Date.now()};db.chat.push(msg);db.chat=db.chat.slice(-200);dirty=true;broadcast('chat',msg);return json(res,200,{ok:true})
 }
 if(p==='/api/chat/stream'&&req.method==='GET'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});
   res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
   res.write(': connected\n\n');clients.set(res,{player:pl.id,name:pl.name,state:{lane:1,score:0,zone:'Wuse',ts:Date.now()}});broadcast('online',clients.size);
   const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},15000);
   req.on('close',()=>{clearInterval(ping);clients.delete(res);broadcast('online',clients.size)});return;
 }
 if(p==='/api/multiplayer/state'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'state',90))return json(res,429,{error:'slow down'});
   const b=await body(req),lane=Math.max(0,Math.min(2,Math.floor(Number(b.lane)))),score=Math.max(0,Math.min(2000000,Math.floor(Number(b.score)||0))),zone=clean(b.zone,20)||'Wuse';
   const conn=[...clients.entries()].find(([,v])=>v.player===pl.id);if(!conn)return json(res,409,{error:'stream required'});
   conn[1].state={lane,score,zone,ts:Date.now()};broadcast('rider',{id:pl.id,name:pl.name,lane,score,zone},conn[0]);return json(res,200,{ok:true})
 }
 if(p==='/api/multiplayer/players'&&req.method==='GET')return json(res,200,[...clients.values()].map(v=>({id:v.player,name:v.name,lane:v.state.lane,score:v.state.score,zone:v.state.zone})));
 return json(res,404,{error:'not found'})
});
server.keepAliveTimeout=65000;server.headersTimeout=66000;server.listen(PORT,'0.0.0.0',()=>console.log(`Keke Dodge v3 listening on ${PORT}`));
