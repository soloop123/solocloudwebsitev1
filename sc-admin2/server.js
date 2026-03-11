/**
 * SoloCloud Admin Backend  —  node server.js
 * http://localhost:3001
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const crypto = require('crypto');

const PORT  = 3001;
const DIR   = __dirname;

// ══════════════════════════════════════════
//  CREDENTIALS  ← change these
// ══════════════════════════════════════════
const ADMIN_EMAIL = 'admin@solocloud.host';   // change to your email
const ADMIN_PASS  = 'SoloCloud@Admin#2026';   // change to your password

// ══════════════════════════════════════════
//  SESSION / RATE LIMIT
// ══════════════════════════════════════════
const sessions = new Map(); // token -> expiresAt
const fails    = {};        // ip -> { count, lockedUntil }

function isLocked(ip) {
  const f = fails[ip];
  if (!f) return false;
  if (f.lockedUntil && Date.now() < f.lockedUntil) return true;
  if (f.lockedUntil && Date.now() >= f.lockedUntil) { delete fails[ip]; }
  return false;
}
function recordFail(ip) {
  if (!fails[ip]) fails[ip] = { count: 0 };
  fails[ip].count++;
  if (fails[ip].count >= 5) { fails[ip].lockedUntil = Date.now() + 30*60*1000; fails[ip].count = 0; }
}
function attemptsLeft(ip) { return Math.max(0, 5 - (fails[ip]?.count || 0)); }
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function isAuthed(req) {
  const tok = (req.headers.cookie||'').split(';').map(c=>c.trim().split('=')).find(([k])=>k==='sc_tok');
  if (!tok) return false;
  const exp = sessions.get(tok[1]);
  if (!exp || Date.now() > exp) { if (exp) sessions.delete(tok[1]); return false; }
  return true;
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
function readBody(req) {
  return new Promise(res => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{res(JSON.parse(d));}catch{res({});} }); });
}
function send(res, data, code=200, extra={}) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type':'application/json', ...extra });
  res.end(body);
}
function rf(name)        { try{return fs.readFileSync(path.join(DIR,name),'utf8');}catch{return null;} }
function wf(name, cont)  { fs.writeFileSync(path.join(DIR,name),cont,'utf8'); }

// ══════════════════════════════════════════
//  PATCHERS — read/write real HTML values
// ══════════════════════════════════════════

// ── Global (all files) ───────────────────
// Social links appear in every file's footer
function readGlobal() {
  const c = rf('index.html'); if (!c) return {};
  const discord   = (c.match(/href="(https:\/\/discord\.gg\/[^"]+)"[^>]*><i class="fa-brands fa-discord/)||[])[1]||'';
  const youtube   = (c.match(/href="(https:\/\/www\.youtube\.com\/[^"]+)"[^>]*><i class="fa-brands fa-youtube/)||[])[1]||'';
  const instagram = (c.match(/href="(https:\/\/www\.instagram\.com\/[^"]+)"[^>]*><i class="fa-brands fa-instagram/)||[])[1]||'';
  const billing_login  = (c.match(/href="([^"]*billing[^"]*\/login)"[^>]*class="[^"]*btn-login/)||[])[1]||'';
  const billing_signup = (c.match(/href="([^"]*billing[^"]*\/register)"[^>]*class="[^"]*btn[^"]*signup/)||[])[1]||'';
  const copyright = (c.match(/©[^<]+/)||[])[0]||'';
  return { discord, youtube, instagram, billing_login, billing_signup, copyright };
}
function saveGlobal(data) {
  const files = ['index.html','minecraft.html','hytale.html','palworld.html','bothosting.html','vpshosting.html','domain.html','aboutus.html','legal.html','payment.html','branding.html','games.html'];
  files.forEach(f => {
    let c = rf(f); if (!c) return;
    if (data.discord)   c = c.replace(/(href=")https:\/\/discord\.gg\/[^"]+(")/g, `$1${data.discord}$2`);
    if (data.youtube)   c = c.replace(/(href=")https:\/\/www\.youtube\.com\/[^"]+(")/g, `$1${data.youtube}$2`);
    if (data.instagram) c = c.replace(/(href=")https:\/\/www\.instagram\.com\/[^"]+(")/g, `$1${data.instagram}$2`);
    if (data.billing_login)  c = c.replace(/(href=")[^"]*billing[^"]*\/login(")/g, `$1${data.billing_login}$2`);
    if (data.billing_signup) c = c.replace(/(href=")[^"]*billing[^"]*\/register(")/g, `$1${data.billing_signup}$2`);
    if (data.copyright) c = c.replace(/©[^<]+/, data.copyright);
    wf(f, c);
  });
  return true;
}

// ── Home page ────────────────────────────
function readHome() {
  const c = rf('index.html'); if (!c) return {};
  const h1   = (c.match(/<h1>([^<]+<span>[^<]+<\/span>[^<]*)<\/h1>/)||[])[1]||'';
  const sub  = (c.match(/<h1>[^<]+<\/h1>\s*<p>([^<]+)<\/p>/)||[])[1]||'';
  const stats = [...c.matchAll(/data-target="(\d+)"[^>]*>.*?<p>([^<]+)<\/p>/gs)].map(m=>({val:m[1],label:m[2].trim()}));
  const revs  = [...c.matchAll(/class="review-text">([^<]+)<\/p>[\s\S]*?class="user-name">([^<]+)<\/span>/g)].map(m=>({text:m[1].replace(/^"|"$/g,'').trim(),name:m[2].trim()}));
  return { h1: h1.replace(/<[^>]+>/g,'').trim(), sub, stats, revs };
}
function saveHome(data) {
  let c = rf('index.html'); if (!c) return false;
  if (data.h1) c = c.replace(/(<h1>)[^<]+(<span>)[^<]+(<\/span>)[^<]*(<\/h1>)/, (m,a,b,d,e)=>`${a}${data.h1}${e}`);
  if (data.sub) c = c.replace(/(<h1>[^<]+<\/h1>\s*<p>)[^<]+(<\/p>)/, `$1${data.sub}$2`);
  if (data.stats) {
    let i=0;
    c = c.replace(/data-target="\d+"/g, ()=>`data-target="${data.stats[i]?.val||0}"${(i++,'')}`);
    let j=0;
    c = c.replace(/(<span class="stat-num"[^>]*>0<\/span><p>)[^<]+(<\/p>)/g, ()=>`$1${data.stats[j++]?.label||''}$2`);
  }
  if (data.revs) {
    let i=0;
    c = c.replace(/(class="review-text">")[^"]+(")/g, ()=>`class="review-text">"${data.revs[i++]?.text||''}"$2`); // won't work perfectly but a best effort
  }
  wf('index.html', c); return true;
}

// ── Minecraft ────────────────────────────
function readMinecraft() {
  const c = rf('minecraft.html'); if (!c) return {};
  const india = c.match(/india:\s*\{[^}]*price:'([^']+)'[^}]*url:'([^']+)'/)||[];
  const sg    = c.match(/singapore:\s*\{[^}]*price:'([^']+)'[^}]*url:'([^']+)'/)||[];
  const de    = c.match(/germany:\s*\{[^}]*price:'([^']+)'[^}]*url:'([^']+)'/)||[];
  const h1    = (c.match(/<h1[^>]*>([^<]+)<\/h1>/)||[])[1]||'';
  const sub   = (c.match(/<h1[^>]*>[^<]+<\/h1>[^<]*<p[^>]*>([^<]+)<\/p>/)||[])[1]||'';
  return { h1:h1.trim(), sub:sub.trim(), india_price:india[1]||'', india_url:india[2]||'', sg_price:sg[1]||'', sg_url:sg[2]||'', de_price:de[1]||'', de_url:de[2]||'' };
}
function saveMinecraft(data) {
  let c = rf('minecraft.html'); if (!c) return false;
  if (data.india_price) c = c.replace(/(india:\s*\{[^}]*price:')[^']*(')/,   `$1${data.india_price}$2`);
  if (data.india_url)   c = c.replace(/(india:\s*\{[^}]*url:')[^']*(')/,     `$1${data.india_url}$2`);
  if (data.sg_price)    c = c.replace(/(singapore:\s*\{[^}]*price:')[^']*(')/,`$1${data.sg_price}$2`);
  if (data.sg_url)      c = c.replace(/(singapore:\s*\{[^}]*url:')[^']*(')/,  `$1${data.sg_url}$2`);
  if (data.de_price)    c = c.replace(/(germany:\s*\{[^}]*price:')[^']*(')/,  `$1${data.de_price}$2`);
  if (data.de_url)      c = c.replace(/(germany:\s*\{[^}]*url:')[^']*(')/,    `$1${data.de_url}$2`);
  wf('minecraft.html', c); return true;
}

// ── Hytale ───────────────────────────────
function readHytale() {
  const c = rf('hytale.html'); if (!c) return {};
  const prices = [...c.matchAll(/price:\s*'(₹[^']+)'/g)].map(m=>m[1]);
  const urls   = [...c.matchAll(/url:\s*'([^']*billing[^']*)'/g)].map(m=>m[1]);
  const h1     = (c.match(/<h1[^>]*>([^<]+)<\/h1>/)||[])[1]||'';
  const sub    = (c.match(/<h1[^>]*>[^<]+<\/h1>[^<]*<p[^>]*>([^<]+)<\/p>/)||[])[1]||'';
  return { h1:h1.trim(), sub:sub.trim(), india_price:prices[0]||'', sg_price:prices[1]||'', de_price:prices[2]||'', india_url:urls[0]||'', sg_url:urls[1]||'', de_url:urls[2]||'' };
}
function saveHytale(data) {
  let c = rf('hytale.html'); if (!c) return false;
  let i=0; c=c.replace(/price:\s*'₹[^']+'/g,()=>`price: '${[data.india_price,data.sg_price,data.de_price][i++]||''}'`);
  let j=0; c=c.replace(/(url:\s*')[^']*billing[^']*(')/g,()=>`url: '${[data.india_url,data.sg_url,data.de_url][j++]||''}'`);
  wf('hytale.html', c); return true;
}

// ── Palworld ─────────────────────────────
function readPalworld() {
  const c = rf('palworld.html'); if (!c) return {};
  const prices = [...c.matchAll(/price:\s*'(₹[^']+)'/g)].map(m=>m[1]);
  const urls   = [...c.matchAll(/url:\s*'([^']*billing[^']*)'/g)].map(m=>m[1]);
  const h1     = (c.match(/<h1[^>]*>([^<]+)<\/h1>/)||[])[1]||'';
  const sub    = (c.match(/<h1[^>]*>[^<]+<\/h1>[^<]*<p[^>]*>([^<]+)<\/p>/)||[])[1]||'';
  return { h1:h1.trim(), sub:sub.trim(), india_price:prices[0]||'', sg_price:prices[1]||'', de_price:prices[2]||'', india_url:urls[0]||'', sg_url:urls[1]||'', de_url:urls[2]||'' };
}
function savePalworld(data) {
  let c = rf('palworld.html'); if (!c) return false;
  let i=0; c=c.replace(/price:\s*'₹[^']+'/g,()=>`price: '${[data.india_price,data.sg_price,data.de_price][i++]||''}'`);
  let j=0; c=c.replace(/(url:\s*')[^']*billing[^']*(')/g,()=>`url: '${[data.india_url,data.sg_url,data.de_url][j++]||''}'`);
  wf('palworld.html', c); return true;
}

// ── Bot Hosting ──────────────────────────
function readBothosting() {
  const c = rf('bothosting.html'); if (!c) return {};
  const h1   = (c.match(/<h1[^>]*>([^<]+)<\/h1>/)||[])[1]||'';
  const sub  = (c.match(/<h1[^>]*>[^<]+<\/h1>[^<]*<p[^>]*>([^<]+)<\/p>/)||[])[1]||'';
  const names  = [...c.matchAll(/class="plan-name">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  const prices = [...c.matchAll(/class="plan-price">₹(\d+)<span>/g)].map(m=>m[1]);
  const descs  = [...c.matchAll(/class="plan-desc">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  return { h1:h1.trim(), sub:sub.trim(), names, prices, descs };
}
function saveBothosting(data) {
  let c = rf('bothosting.html'); if (!c) return false;
  if (data.names)  { let i=0; c=c.replace(/(<div class="plan-name">)[^<]+(<\/div>)/g,(_,a,b)=>`${a}${data.names[i++]||''}${b}`); }
  if (data.prices) { let i=0; c=c.replace(/(<div class="plan-price">₹)\d+(<span>)/g,(_,a,b)=>`${a}${data.prices[i++]||'0'}${b}`); }
  if (data.descs)  { let i=0; c=c.replace(/(<div class="plan-desc">)[^<]+(<\/div>)/g,(_,a,b)=>`${a}${data.descs[i++]||''}${b}`); }
  wf('bothosting.html', c); return true;
}

// ── VPS ──────────────────────────────────
function readVps() {
  const c = rf('vpshosting.html'); if (!c) return {};
  const h1     = (c.match(/<h1[^>]*>([^<]+)<\/h1>/)||[])[1]||'';
  const sub    = (c.match(/<h1[^>]*>[^<]+<\/h1>[^<]*<p[^>]*>([^<]+)<\/p>/)||[])[1]||'';
  const names  = [...c.matchAll(/class="plan-name">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  const prices = [...c.matchAll(/class="plan-price">₹([\d,]+)<span>/g)].map(m=>m[1]);
  const descs  = [...c.matchAll(/class="plan-desc">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  return { h1:h1.trim(), sub:sub.trim(), names, prices, descs };
}
function saveVps(data) {
  let c = rf('vpshosting.html'); if (!c) return false;
  if (data.names)  { let i=0; c=c.replace(/(<div class="plan-name">)[^<]+(<\/div>)/g,(_,a,b)=>`${a}${data.names[i++]||''}${b}`); }
  if (data.prices) { let i=0; c=c.replace(/(<div class="plan-price">₹)[\d,]+(<span>)/g,(_,a,b)=>`${a}${data.prices[i++]||'0'}${b}`); }
  if (data.descs)  { let i=0; c=c.replace(/(<div class="plan-desc">)[^<]+(<\/div>)/g,(_,a,b)=>`${a}${data.descs[i++]||''}${b}`); }
  wf('vpshosting.html', c); return true;
}

// ── Domains ──────────────────────────────
function readDomains() {
  const c = rf('domain.html'); if (!c) return {};
  const h1     = (c.match(/<h1[^>]*>([^<]+)<\/h1>/)||[])[1]||'';
  const exts   = [...c.matchAll(/class="ext-name">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  const prices = [...c.matchAll(/class="ext-price">₹([\d,]+)\s*<span>/g)].map(m=>m[1]);
  return { h1:h1.trim(), exts, prices };
}
function saveDomains(data) {
  let c = rf('domain.html'); if (!c) return false;
  if (data.prices) { let i=0; c=c.replace(/(class="ext-price">₹)[\d,]+(\s*<span>)/g,(_,a,b)=>`${a}${data.prices[i++]||'0'}${b}`); }
  wf('domain.html', c); return true;
}

// ── About ────────────────────────────────
function readAbout() {
  const c = rf('aboutus.html'); if (!c) return {};
  const h1    = (c.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)||[])[1]||'';
  const story = [...c.matchAll(/class="story-text">\s*<p>([^<]+)<\/p>/g)].map(m=>m[1].trim()).join('\n\n') ||
                (c.match(/class="story-body">([\s\S]*?)<\/div>/)||[])[1]?.replace(/<[^>]+>/g,'').trim()||'';
  const names = [...c.matchAll(/class="team-name">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  const roles = [...c.matchAll(/class="team-role">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  const bios  = [...c.matchAll(/class="team-bio">([^<]+)<\/div>/g)].map(m=>m[1].trim());
  return { h1:h1.replace(/<[^>]+>/g,'').trim(), story, names, roles, bios };
}
function saveAbout(data) {
  let c = rf('aboutus.html'); if (!c) return false;
  if (data.names) { let i=0; c=c.replace(/(<div class="team-name">)[^<]+(<\/div>)/g,(_,a,b)=>`${a}${data.names[i++]||''}${b}`); }
  if (data.roles) { let i=0; c=c.replace(/(<div class="team-role">)[^<]+(<\/div>)/g,(_,a,b)=>`${a}${data.roles[i++]||''}${b}`); }
  if (data.bios)  { let i=0; c=c.replace(/(<div class="team-bio">)[^<]+(<\/div>)/g,(_,a,b)=>`${a}${data.bios[i++]||''}${b}`); }
  wf('aboutus.html', c); return true;
}

// ── Reviews (index.html) ─────────────────
function readReviews() {
  const c = rf('index.html'); if (!c) return {};
  const texts = [...c.matchAll(/class="review-text">"?([^<"]+)"?<\/p>/g)].map(m=>m[1].replace(/^"|"$/g,'').trim());
  const names = [...c.matchAll(/class="user-name">([^<]+)<\/span>/g)].map(m=>m[1].trim());
  return { texts, names };
}
function saveReviews(data) {
  let c = rf('index.html'); if (!c) return false;
  if (data.texts) { let i=0; c=c.replace(/(class="review-text">")[^"<]+(")/g,(_,a,b)=>`${a}${data.texts[i++]||''}${b}`); }
  if (data.names) { let i=0; c=c.replace(/(<span class="user-name">)[^<]+(<\/span>)/g,(_,a,b)=>`${a}${data.names[i++]||''}${b}`); }
  wf('index.html', c); return true;
}

// ── Home stats ───────────────────────────
function readStats() {
  const c = rf('index.html'); if (!c) return {};
  const vals   = [...c.matchAll(/data-target="(\d+)"/g)].map(m=>m[1]);
  const labels = [...c.matchAll(/data-target="\d+"[^>]*>0<\/span><p>([^<]+)<\/p>/g)].map(m=>m[1].trim());
  return { vals, labels };
}
function saveStats(data) {
  let c = rf('index.html'); if (!c) return false;
  if (data.vals) {
    let i=0; c=c.replace(/data-target="\d+"/g,()=>`data-target="${data.vals[i++]||'0'}"`);
  }
  if (data.labels) {
    let i=0; c=c.replace(/(data-target="\d+"[^>]*>0<\/span><p>)[^<]+(<\/p>)/g,(_,a,b)=>`${a}${data.labels[i++]||''}${b}`);
  }
  wf('index.html', c); return true;
}

// ══════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════
const MIME = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml'};

const server = http.createServer(async (req, res) => {
  const p  = url.parse(req.url).pathname;
  const m  = req.method;
  const ip = req.socket.remoteAddress||'127.0.0.1';

  if (m==='OPTIONS') {
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
    return res.end();
  }

  // ── Login ──────────────────────────────
  if (p==='/api/login' && m==='POST') {
    if (isLocked(ip)) return send(res,{error:'Too many attempts. Locked 30 min.'},429);
    const b = await readBody(req);
    const emailOk = b.email?.toLowerCase()===ADMIN_EMAIL.toLowerCase();
    const passOk  = b.password===ADMIN_PASS;
    if (emailOk && passOk) {
      const tok = makeToken();
      sessions.set(tok, Date.now()+12*60*60*1000);
      res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':`sc_tok=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`});
      return res.end(JSON.stringify({ok:true}));
    }
    recordFail(ip);
    const left = attemptsLeft(ip);
    return send(res,{error:`Wrong email or password. ${left} attempt${left===1?'':'s'} left.`},401);
  }

  // ── Logout ─────────────────────────────
  if (p==='/api/logout' && m==='POST') {
    res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'sc_tok=; Path=/; Max-Age=0'});
    return res.end(JSON.stringify({ok:true}));
  }

  // ── Auth check ─────────────────────────
  if (p==='/api/me') return send(res,{ok:isAuthed(req)});

  // ── Protected ──────────────────────────
  if (!isAuthed(req) && p.startsWith('/api/')) return send(res,{error:'Unauthorized'},401);

  if (p==='/api/read' && m==='POST') {
    const b = await readBody(req);
    const map = {global:readGlobal,home:readHome,minecraft:readMinecraft,hytale:readHytale,palworld:readPalworld,bothosting:readBothosting,vps:readVps,domains:readDomains,about:readAbout,reviews:readReviews,stats:readStats};
    const fn = map[b.page]; if (!fn) return send(res,{error:'Unknown'},400);
    return send(res,{ok:true,data:fn()});
  }

  if (p==='/api/save' && m==='POST') {
    const b = await readBody(req);
    const map = {global:saveGlobal,home:saveHome,minecraft:saveMinecraft,hytale:saveHytale,palworld:savePalworld,bothosting:saveBothosting,vps:saveVps,domains:saveDomains,about:saveAbout,reviews:saveReviews,stats:saveStats};
    const fn = map[b.page]; if (!fn) return send(res,{error:'Unknown'},400);
    const ok = fn(b.data);
    return send(res,{ok});
  }

  // ── Static files ───────────────────────
  let fp = path.join(DIR, p==='/'?'admin.html':p.replace(/^\//,''));
  if (!fs.existsSync(fp)||!fs.statSync(fp).isFile()) return send(res,{error:'Not found'},404);
  res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});
  fs.createReadStream(fp).pipe(res);
});

server.listen(PORT, ()=>console.log(`\n  SoloCloud Admin  →  http://localhost:${PORT}\n  Email: ${ADMIN_EMAIL}\n  Pass:  ${ADMIN_PASS}\n`));
