
/* ===========================================================
 * ¡Atrapa el Trap o Salva el Proceso!  —  Un solo archivo.
 * 1) CONFIGURACIÓN  2) CAPA DE DATOS (Supabase)
 * 3) ESTADO Y FASES 4) LÓGICA DEL JUEGO 5) INTERFAZ
 * =========================================================== */

/* ---------- 1) CONFIGURACIÓN: Supabase ---------- */
const SUPABASE_URL = "https://wpdwxziglcartaabuhuz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xONoEvqvaTNv32uXufF5-w_J4mfcM5s";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ADMIN_PIN = "1234";      // Cámbialo: PIN del modo profesor
const GAME_MS = 60000;         // Duración del juego
const CARD_MS = 3000;          // Tiempo por tarjeta
const TARGET_SCORE = 1500;     // Puntaje que equivale a nota 10

/* ---------- 2) CAPA DE DATOS: Supabase ---------- */
function pathToSegments(path) {
  return String(path || "").split("/").filter(Boolean);
}

function getAtPath(obj, segments) {
  return segments.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function setAtPath(obj, segments, value) {
  if (!segments.length) return value;
  const [head, ...rest] = segments;
  if (!rest.length) {
    obj[head] = value;
    return obj;
  }
  obj[head] = obj[head] && typeof obj[head] === "object" ? obj[head] : {};
  obj[head] = setAtPath(obj[head], rest, value);
  return obj;
}

async function loadRoomState(roomCode) {
  const { data, error } = await supabase
    .from("rooms")
    .select("state")
    .eq("code", roomCode)
    .maybeSingle();

  if (error) throw error;
  return data ? (data.state || {}) : {};
}

async function saveRoomState(roomCode, nextState) {
  const { error } = await supabase.from("rooms").upsert({
    code: roomCode,
    state: nextState || {},
    updated_at: new Date().toISOString()
  }, { onConflict: "code" });

  if (error) throw error;
}

function subscribeRoom(roomCode, callback) {
  const channel = supabase
    .channel(`room:${roomCode}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "rooms",
        filter: `code=eq.${roomCode}`
      },
      (payload) => {
        callback(payload.new?.state ?? {});
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

const db = {
  async update(path, value) {
    const segments = pathToSegments(path);
    const roomCode = segments[1];
    if (!roomCode) return;

    const room = await loadRoomState(roomCode) || {};
    const next = JSON.parse(JSON.stringify(room));
    const target = segments.slice(2);

    if (!target.length) {
      Object.assign(next, value);
    } else {
      const existing = getAtPath(next, target) || {};
      setAtPath(next, target, { ...existing, ...value });
    }

    await saveRoomState(roomCode, next);
  },
  listen(path, callback) {
    const segments = pathToSegments(path);
    const roomCode = segments[1];
    if (!roomCode) return () => {};

    const emit = async () => {
      const room = await loadRoomState(roomCode) || {};
      const target = segments.slice(2);
      callback(target.length ? (getAtPath(room, target) ?? null) : room);
    };

    emit();
    const unsub = subscribeRoom(roomCode, (nextState) => {
      const target = segments.slice(2);
      callback(target.length ? (getAtPath(nextState, target) ?? null) : nextState);
    });

    return unsub;
  },
  offline: () => {},
  onOffset: (callback) => callback(0)
};

if (!window.supabase) {
  console.warn("Supabase no cargó correctamente. Revisa la conexión en la red.");
}

/* ---------- 3) ESTADO Y FASES ---------- */
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rnd=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const me={id:localStorage.pid||(localStorage.pid=Math.random().toString(36).slice(2,9)),name:""};
let code="",isAdmin=false,room={},offset=0,g=null,waiting=false,curPhase="",curScr="",adminInit=false;
const now=()=>Date.now()+offset;
const myPath=()=>`rooms/${code}/players/${me.id}`;

/** Fase derivada del reloj sincronizado: lobby → count → game → final */
function phase(){
  if(room?.status!=="running") return "lobby";
  const t=now()-room.startAt;
  return t<0?"count":t<GAME_MS?"game":"final";
}
const players=()=>Object.entries(room?.players||{}).map(([id,p])=>({id,...p})).filter(p=>p.name);
function show(id){document.querySelectorAll(".scr").forEach(s=>s.classList.toggle("on",s.id===id));}

/* ---------- Unirse ---------- */
function join(admin){
  const name=$("name").value.trim();
  if(!admin&&!name) return $("name").focus();
  if(admin&&prompt("PIN de profesor:")!==ADMIN_PIN) return alert("PIN incorrecto");
  me.name=name; isAdmin=admin; localStorage.nm=name;
  code=($("code").value.trim().toUpperCase()||"SALA1");
  $("lobbyCode").textContent=$("aCode").textContent=code;
  db.onOffset(o=>offset=o);
  db.listen(`rooms/${code}`,r=>{
    room=r||{};
    if(isAdmin&&!room.status&&!adminInit){adminInit=true;db.update(`rooms/${code}`,{status:"lobby"});}
    renderRoom();
  });
  if(!admin){
    db.update(myPath(),{name,online:true});
    db.offline(myPath()+"/online",false);   // si cierra la pestaña, deja de contar como conectado
    if(phase()!=="lobby") waiting=true;     // llegó tarde: espera la siguiente ronda
  }
  setInterval(tick,100);
}

/* ---------- 4) LÓGICA DEL JUEGO ---------- */
/** Genera una tarjeta. Válido: 0 ≤ desplazamiento < Límite. Dirección física = Base + desplazamiento */
function makeQ(){
  const base=rnd(1,40)*100, limit=rnd(2,20)*100, seg=rnd(0,5), valid=Math.random()<.5;
  if(Math.random()<.5){ // Tipo A: segmento + desplazamiento
    let off = valid ? rnd(0,limit-1) : (()=>{const r=Math.random();return r<.3?limit:r<.4?-rnd(1,99):rnd(limit+1,limit+400);})();
    const why = valid ? `${off} < ${limit} → física ${base}+${off} = ${base+off} ✔`
      : off<0 ? `Desplazamiento negativo (${off}) → TRAP` : `${off} ≥ ${limit} (el límite es exclusivo) → TRAP`;
    return {seg,base,limit,valid,label:"Desplazamiento:",acc:off,why,phys:base+off};
  }
  // Tipo B: dirección física ya calculada
  const addr = valid ? base+rnd(0,limit-1) : [base+limit,base+limit+rnd(1,300),base-rnd(1,99)][rnd(0,2)];
  const why = valid ? `${base} ≤ ${addr} < ${base+limit} ✔ dentro del segmento`
    : `${addr} fuera de [${base}, ${base+limit-1}] → TRAP`;
  return {seg,base,limit,valid,label:"Dirección física:",acc:addr,why,phys:addr};
}

function startGame(){
  g={score:0,combo:0,best:0,ok:0,bad:0,locked:true};
  db.update(myPath(),{score:0,ok:0,bad:0,best:0,done:false});
  nextQ();
}
function nextQ(){
  if(phase()!=="game") return;
  const q=g.q=makeQ(); g.qStart=Date.now(); g.locked=false;
  $("qSeg").textContent=q.seg; $("qBase").textContent=q.base; $("qLim").textContent=q.limit;
  $("qLabel").textContent=q.label; $("qAcc").textContent=q.acc; $("qFb").innerHTML="";
}
function answer(choice){ // true = Válido, false = TRAP, null = tiempo agotado
  if(!g||g.locked||phase()!=="game") return;
  g.locked=true; const q=g.q, dt=Date.now()-g.qStart; let msg,color,good=false;
  if(choice===null){g.bad++;g.combo=0;g.score-=50;msg="⏰ ¡Tiempo! −50";color="var(--warn)";}
  else if(choice===q.valid){
    g.ok++;g.combo++;g.best=Math.max(g.best,g.combo);
    const pts=(100+Math.round(50*(1-dt/CARD_MS)))*(1+Math.min(3,Math.floor(g.combo/3)));
    g.score+=pts;msg=`¡Correcto! +${pts}`;color="var(--ok)";good=true;
  } else {g.bad++;g.combo=0;g.score-=75;msg="❌ Error −75";color="var(--bad)";$("qCard").classList.add("shake");}
  g.score=Math.max(0,g.score);
  // Mapa de memoria: muestra dónde cayó el acceso (0–7000)
  const pc=v=>Math.min(100,Math.max(0,v/70));
  $("qFb").innerHTML=`<div class="font-bold text-lg" style="color:${color}">${msg}</div><div class="mono">${q.why}</div>
    <div class="relative h-5 mt-2 rounded bg-slate-900 border border-slate-700">
      <div class="absolute h-full" style="left:${pc(q.base)}%;width:${pc(q.limit)}%;background:var(--ok);opacity:.45"></div>
      <div class="absolute -top-1 h-7 w-1" style="left:${pc(q.phys)}%;background:${q.valid?"#fff":"var(--bad)"}"></div></div>`;
  setTimeout(()=>$("qCard").classList.remove("shake"),300);
  db.update(myPath(),{score:g.score,ok:g.ok,bad:g.bad,best:g.best});
  setTimeout(nextQ,good?600:1400);
}
function finishGame(){
  if(!g) return; g.locked=true;
  db.update(myPath(),{score:g.score,ok:g.ok,bad:g.bad,best:g.best,done:true});
  const n=Math.min(10,Math.max(0,g.score/TARGET_SCORE*10));
  $("fScore").textContent=g.score; $("fGrade").textContent=n.toFixed(1);
  $("fMsg").textContent=n>=9?"¡Experto en memoria!":n>=6?"Aprobado":"A repasar segmentación";
  $("fStats").textContent=`Aciertos ${g.ok} · Errores ${g.bad} · Mejor combo ${g.best}`;
}

/* ---------- 5) INTERFAZ ---------- */
function lb(list,podium){
  const s=[...list].sort((a,b)=>(b.score||0)-(a.score||0)), medal=["🥇","🥈","🥉"], h=[110,80,60];
  if(!s.length) return '<p class="text-center text-slate-400">Aún no hay alumnos conectados.</p>';
  let out="";
  if(podium) out+='<div class="flex items-end justify-center gap-2 mb-4">'+[1,0,2].filter(i=>s[i]).map(i=>
    `<div class="text-center w-1/3 max-w-[9rem]"><div class="text-3xl">${medal[i]}</div><div class="truncate font-bold">${esc(s[i].name)}</div>
     <div class="mono font-bold pt-2 rounded-t" style="height:${h[i]}px;background:${["var(--warn)","#94a3b8","#c2763b"][i]};color:#0b1020">${s[i].score||0}</div></div>`).join("")+"</div>";
  return out+s.map((p,i)=>podium&&i<3?"":
    `<div class="flex justify-between py-2 px-3 border-b border-slate-700 ${p.id===me.id?"bg-slate-800 rounded":""}">
      <span><span class="mono text-slate-400 mr-2">${i+1}°</span>${esc(p.name)}</span><b class="mono">${p.score||0}</b></div>`).join("");
}
function renderRoom(){
  const ps=players(), on=ps.filter(p=>p.online!==false), ph=phase();
  $("lobbyCount").textContent=$("aCount").textContent=on.length;
  $("lobbyList").innerHTML=on.map(p=>`<span class="px-3 py-1 rounded-full border border-slate-500 ${p.id===me.id?"ring-2 ring-amber-300":""}">${esc(p.name)}</span>`).join("");
  $("aBoard").innerHTML=lb(ph==="lobby"?on:ps,ph==="final");
  $("fBoard").innerHTML=lb(ps,true);
}
/** Bucle de 100 ms: decide qué pantalla mostrar según la fase sincronizada */
function tick(){
  const ph=phase(), t=now()-(room.startAt||0);
  if(ph==="lobby") waiting=false;
  const scr=isAdmin?"admin":(waiting&&ph!=="lobby")?"lobby":ph;
  if(scr!==curScr){curScr=scr;show("s-"+scr);}
  if(ph!==curPhase){
    if(ph==="game"&&!isAdmin&&!waiting) startGame();
    if(curPhase==="game"&&ph==="final"&&!isAdmin) finishGame();
    curPhase=ph; renderRoom();
  }
  if(ph==="count") $("countNum").textContent=Math.min(3,Math.ceil(-t/1000));
  if(ph==="game"){
    const left=Math.max(0,Math.ceil((GAME_MS-t)/1000));
    $("gTime").textContent=left;
    if(isAdmin) $("aStatus").textContent=`⏱ ${left}s`;
    else if(g){
      $("gScore").textContent=g.score; $("gCombo").textContent="x"+(1+Math.min(3,Math.floor(g.combo/3)));
      const el=Date.now()-g.qStart;
      if(!g.locked){$("gBar").style.width=Math.max(0,100-el/CARD_MS*100)+"%"; if(el>=CARD_MS) answer(null);}
    }
  }
  if(isAdmin){
    const b=$("aBtn");
    $("aStatus").style.display=ph==="lobby"?"none":"block";
    if(ph==="count") $("aStatus").textContent=Math.min(3,Math.ceil(-t/1000));
    if(ph==="final") $("aStatus").textContent="🏁 Terminó";
    b.disabled=ph==="count"||ph==="game"; b.style.opacity=b.disabled?.4:1;
    b.textContent=ph==="final"?"🔄 Nueva ronda":ph==="lobby"?"🚀 Iniciar Juego para Todos":"Juego en curso...";
  }
}
/** Admin: iniciar (todos arrancan en startAt, hora del servidor) o preparar nueva ronda */
function adminAction(){
  const ph=phase();
  if(ph==="lobby") db.update(`rooms/${code}`,{status:"running",startAt:now()+3500});
  else if(ph==="final"){
    players().forEach(p=>db.update(`rooms/${code}/players/${p.id}`,{score:0,ok:0,bad:0,best:0,done:false}));
    db.update(`rooms/${code}`,{status:"lobby"});
  }
}

/* Eventos */
$("name").value=localStorage.nm||"";
$("btnJoin").onclick=()=>join(false);
$("btnAdmin").onclick=()=>join(true);
$("aBtn").onclick=adminAction;
$("bOk").onclick=()=>answer(true);
$("bBad").onclick=()=>answer(false);
$("btnReplay").onclick=()=>{waiting=true;};
addEventListener("keydown",e=>{
  if(curScr!=="game") return;
  if(e.key==="ArrowLeft"||e.key.toLowerCase()==="v") answer(true);
  if(e.key==="ArrowRight"||e.key.toLowerCase()==="t") answer(false);
});
