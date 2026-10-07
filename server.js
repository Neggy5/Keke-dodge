// Keke Dodge Online v6 — multiplayer Abuja runner
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
function json2(res,o,t){res.writeHead(200,{'content-type':t+'; charset=utf-8','cache-control':'no-cache'});res.end(JSON.stringify(o))}
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
const day=(o=0)=>new Date(Date.now()+o*864e5).toISOString().slice(0,10);
const seedOf=d=>{let h=2166136261;for(const c of 'keke'+d){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const MIS=d=>{const k=seedOf(d)%3;return[{id:'coins',txt:'Collect coins',t:[30,45,60][k],r:20,key:'coins'},{id:'near',txt:'Close calls',t:[6,9,12][k],r:25,key:'near'},{id:'dist',txt:'Ride metres',t:[1800,2600,3600][k],r:30,key:'dist'}]};
const misView=p=>{const d=day(),m=p.mis&&p.mis.day===d?p.mis:{day:d,prog:{},done:[]};return MIS(d).map(x=>({id:x.id,txt:x.txt,target:x.t,prog:Math.min(x.t,m.prog[x.key]||0),done:m.done.includes(x.id),reward:x.r}))};
const SKINS={green:0,lagos:150,midnight:250,gold:400};
function publicPlayer(p){const t=day();return{id:p.id,name:p.name,coins:p.coins,best:p.best,shieldTokens:p.shieldTokens,skin:p.skin||'green',skins:['green',...(p.skins||[])],streak:p.lastDaily===t||p.lastDaily===day(-1)?(p.streak||0):0,dailyDone:p.lastDaily===t,dailyBest:p.daily&&p.daily.day===t?p.daily.best:0,items:{magnet:(p.items&&p.items.magnet)||0,revive:(p.items&&p.items.revive)||0},missions:misView(p)}}
function dailyBoard(){const t=day();return db.players.filter(p=>p.daily&&p.daily.day===t).sort((a,b)=>b.daily.best-a.daily.best).slice(0,10).map((p,i)=>({rank:i+1,n:p.name,s:p.daily.best}))}

const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost'),p=u.pathname;
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization'});return res.end()}
 if(req.method==='GET'&&(p==='/'||p==='/index.html'))return fs.readFile(path.join(__dirname,'public','index.html'),(e,b)=>{if(e)return json(res,500,{error:'missing index.html'});res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(b)});
 if(req.method==='GET'&&p==='/health')return json(res,200,{ok:true,version:6,uptime:Math.round(process.uptime()),time:Date.now()});
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
   const b=await body(req),id=newId(),used={};pl.items=pl.items||{};for(const k of['magnet','revive'])if(b[k]&&(pl.items[k]||0)>0){pl.items[k]--;used[k]=1;dirty=true}runs.set(id,{player:pl.id,at:Date.now(),daily:b.daily?day():null});return json(res,200,{id,used,player:publicPlayer(pl),...(b.daily?{seed:seedOf(day())}:{})})
 }
 if(p==='/api/scores'&&req.method==='GET')return json(res,200,top());
 if(p==='/api/daily'&&req.method==='GET')return json(res,200,{day:day(),board:dailyBoard()});
 if(p==='/api/skin'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'skin',500))return json(res,429,{error:'slow down'});
   const b=await body(req),id=String(b.id||'');if(!(id in SKINS))return json(res,400,{error:'unknown skin'});
   pl.skins=pl.skins||[];if(id!=='green'&&!pl.skins.includes(id)){if(pl.coins<SKINS[id])return json(res,400,{error:'need ₦'+SKINS[id]});pl.coins-=SKINS[id];pl.skins.push(id)}
   pl.skin=id;dirty=true;return json(res,200,publicPlayer(pl))
 }
 if(req.method==='GET'&&p==='/manifest.webmanifest')return json2(res,{name:'Keke Dodge',short_name:'Keke Dodge',start_url:'/',display:'standalone',orientation:'portrait',background_color:'#241b16',theme_color:'#241b16',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]},'application/manifest+json');
 if(req.method==='GET'&&p==='/icon.svg'){res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'public,max-age=86400'});return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#241b16"/><rect x="96" y="150" width="320" height="40" fill="#ffcf33"/><rect x="96" y="190" width="320" height="170" fill="#1f9d55"/><rect x="130" y="205" width="252" height="60" fill="#7fb6c9"/><rect x="96" y="300" width="320" height="22" fill="#fff8ea"/><rect x="120" y="360" width="70" height="60" fill="#120d0a"/><rect x="322" y="360" width="70" height="60" fill="#120d0a"/></svg>`)}
 if(req.method==='GET'&&p==='/sw.js'){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-cache'});return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});")}
 if(p==='/api/scores'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'score',1000))return json(res,429,{error:'slow down'});
   const b=await body(req),r=runs.get(String(b.id||'')),score=Math.floor(Number(b.score)),distance=Math.floor(Number(b.distance));
   if(!r||r.player!==pl.id||!Number.isFinite(score)||score<0||score>2000000||!Number.isFinite(distance)||distance<0)return json(res,400,{error:'rejected'});
   runs.delete(String(b.id));const sec=(Date.now()-r.at)/1000,maxDist=Math.min(100000,Math.floor(sec*650+250));
   const earned=Math.max(0,Math.min(250,Math.floor(Number(b.coins)||0)));
   if(sec<1||distance>maxDist||score>distance/10+earned*12+Number(b.combo||0)*2+100)return json(res,400,{error:'score validation failed'});
   if(score>pl.best)pl.best=score;
   let bonus=0;if(r.daily&&(r.daily===day()||r.daily===day(-1))){const d=r.daily;if(!pl.daily||pl.daily.day!==d)pl.daily={day:d,best:0};if(score>pl.daily.best)pl.daily.best=score;if(pl.lastDaily!==d){pl.streak=pl.lastDaily&&new Date(d)-new Date(pl.lastDaily)===864e5?(pl.streak||0)+1:1;pl.lastDaily=d;bonus=10*Math.min(pl.streak,7)}}
   let mb=0;const md=day(),mdone=[];if(!pl.mis||pl.mis.day!==md)pl.mis={day:md,prog:{},done:[]};const pr=pl.mis.prog;pr.coins=(pr.coins||0)+earned;pr.near=(pr.near||0)+Math.max(0,Math.min(60,Math.floor(Number(b.combo)||0)));pr.dist=(pr.dist||0)+distance;
   for(const x of MIS(md))if(!pl.mis.done.includes(x.id)&&pr[x.key]>=x.t){pl.mis.done.push(x.id);mb+=x.r;mdone.push(x.txt)}
   pl.coins+=earned+bonus+mb;db.scores.push({player:pl.id,s:score,t:Date.now()});db.scores=db.scores.slice(-500);dirty=true;
   const result=top();broadcast('leaderboard',result);return json(res,200,{leaderboard:result,player:publicPlayer(pl),earned,bonus,missionBonus:mb,missionsDone:mdone,daily:dailyBoard()});
 }
 if(p==='/api/shop'&&req.method==='POST'){
   const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(rate(req,'shop',700))return json(res,429,{error:'slow down'});
   const b=await body(req);const IT={magnet:40,revive:90};if(IT[b.item]){if(pl.coins<IT[b.item])return json(res,400,{error:'need ₦'+IT[b.item]});pl.coins-=IT[b.item];pl.items=pl.items||{};pl.items[b.item]=(pl.items[b.item]||0)+1;dirty=true;return json(res,200,publicPlayer(pl))}if(b.item==='shield'){if(pl.coins<50)return json(res,400,{error:'need 50 coins'});pl.coins-=50;pl.shieldTokens++;dirty=true;return json(res,200,publicPlayer(pl))}return json(res,400,{error:'unknown item'})
 }
 if(p==='/api/use-shield'&&req.method==='POST'){const pl=player(req);if(!pl)return json(res,401,{error:'profile required'});if(pl.shieldTokens<1)return json(res,400,{error:'no shield'});pl.shieldTokens--;dirty=true;return json(res,200,publicPlayer(pl))}
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
server.keepAliveTimeout=65000;server.headersTimeout=66000;server.listen(PORT,'0.0.0.0',()=>console.log(`Keke Dodge v4 listening on ${PORT}`));
