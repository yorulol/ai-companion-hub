import { api, particles, render, toast, esc } from "./common.js";
import { coreOrb } from "./core-orb.js";
particles(document.getElementById("particles"));
const orb = coreOrb(document.getElementById("coreOrb"));
const $ = (id) => document.getElementById(id);
const views = [...document.querySelectorAll(".view")];
let activeView = "dashboard";
function showView(name) {
  activeView = name;
  views.forEach((v) => v.classList.toggle("active", v.id === `${name}View`));
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const frame = $(`${name}Frame`);
  if (frame?.dataset.src && !frame.src) frame.src = frame.dataset.src;
  document.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
  if (name === "files") loadRoots().then(() => browseFiles(fileCwd));
  if (name === "models") loadModels();
  if (name === "security") loadSecurity();
  if (name === "terminal") setTimeout(() => $("input").focus(), 50);
}
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
document.querySelectorAll("[data-svc]").forEach((b) => b.addEventListener("click", () => window.open({ollama:"http://localhost:11434",openrouter:"https://openrouter.ai"}[b.dataset.svc], "_blank", "noopener")));
document.addEventListener("click", (e) => document.querySelectorAll("details[open]").forEach((d) => { if (!d.contains(e.target)) d.removeAttribute("open"); }));
function updateClock(){const d=new Date();$("dateLine").textContent=d.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"});$("clockLine").textContent=d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});}updateClock();setInterval(updateClock,1000);

const messages = $("messages"), input = $("input"), sendBtn = $("send");
const SCOPE = "panel:" + (localStorage.getItem("yoru.scope") || (()=>{const s=crypto.randomUUID?.()||Math.random().toString(36).slice(2);localStorage.setItem("yoru.scope",s);return s})());
function termLine(role,text,tools=[]){const line=document.createElement("div");line.className=`term-line ${role}`;const label=role==="user"?"oz@yoru:~$":role==="system"?"system::":"yoru::";line.innerHTML=`<div class="prompt">${label}</div><div class="content">${render(text)}${tools.length?`<div class="tools">TOOLS / ${tools.map(t=>esc(t.tool)).join(" → ")}</div>`:""}</div>`;messages.appendChild(line);messages.scrollTop=messages.scrollHeight;return line;}
termLine("system","YORU core online. Natural language and terminal commands are ready.");
async function send(text){text=String(text||"").trim();if(!text)return;showView("terminal");termLine("user",text);const pending=termLine("assistant","processing…");sendBtn.disabled=true;orb.setLevel(.7);try{const r=await api("/api/chat",{method:"POST",body:{userText:text,mode:"general",scope:SCOPE}});pending.querySelector(".content").innerHTML=`${render(r.reply||"No response.")}${r.tools?.length?`<div class="tools">TOOLS / ${r.tools.map(t=>esc(t.tool)).join(" → ")}</div>`:""}`;$("terminalProvider").textContent=`${r.provider||"AUTO"}${r.model?` / ${r.model}`:""}`.toUpperCase();}catch(e){pending.querySelector(".content").textContent=`ERROR / ${e.message}`;}finally{sendBtn.disabled=false;orb.setLevel(.15);messages.scrollTop=messages.scrollHeight;input.focus();}}
$("terminalForm").addEventListener("submit",e=>{e.preventDefault();const t=input.value;input.value="";input.style.height="auto";send(t)});input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("terminalForm").requestSubmit()}});input.addEventListener("input",()=>{input.style.height="auto";input.style.height=Math.min(150,input.scrollHeight)+"px"});
$("globalSend").onclick=()=>{const t=$("globalInput").value;$("globalInput").value="";send(t)};$("globalInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("globalSend").click()});

let recog=null;try{const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(R){recog=new R();recog.interimResults=true;recog.lang="en-US";let last="";recog.onresult=e=>{last="";for(const r of e.results)last+=r[0].transcript;$("globalInput").value=last;orb.setLevel(.65)};recog.onend=()=>{$("micBtn").classList.remove("on");$("voiceLabel").textContent="TAP TO SPEAK";if(last.trim()){const t=last;last="";send(t)}};}}
catch{}
function toggleMic(){if(!recog)return toast("Voice input is not supported by this browser.");if($("micBtn").classList.contains("on")){recog.stop();return}$("micBtn").classList.add("on");$("voiceLabel").textContent="LISTENING";try{recog.start()}catch{}}
$("micBtn").onclick=toggleMic;$("dockMic").onclick=toggleMic;

function overviewRow(code,name,status,tone="on"){return `<div class="overview-row"><i>${code}</i><div><b>${name}</b><small>${status}</small></div><em class="${tone}">${tone==="on"?"ACTIVE":"IDLE"}</em></div>`}
function renderProviders(list,preferred){const enabled=list.filter(p=>p.enabled&&(!p.keyRequired||p.hasKey));$("llmCount").textContent=`${enabled.length} CONNECTED`;$("providerCards").innerHTML=list.map(p=>`<div class="provider-card ${p.enabled?"on":""}"><b>${esc(p.name)}${p.name===preferred?" / PRIMARY":""}</b><small>${p.enabled?(p.keyRequired&&!p.hasKey?"KEY REQUIRED":esc(p.model||"CONNECTED")):"OFFLINE"}</small></div>`).join("");$("providerMatrix").innerHTML=list.map(p=>`<div class="matrix-card"><strong>${esc(p.name.toUpperCase())}</strong><small>${p.enabled?`ENABLED / ${esc(p.model||"AUTO MODEL")}`:"DISABLED"}</small></div>`).join("");const select=$("providerSelect");select.innerHTML=`<option value="">AUTO / ${esc(preferred||"ROUTER")}</option>`+list.filter(p=>p.enabled).map(p=>`<option value="${esc(p.name)}">${esc(p.name.toUpperCase())}</option>`).join("");$("overviewRows").innerHTML=[overviewRow("AI","AI Core",preferred||"Auto routing"),overviewRow("M","Memory","24-message context"),overviewRow("V","Voice",voiceConnected?"In session":"Standby",voiceConnected?"on":"off"),overviewRow("AG","Agents","YORU + ACE"),overviewRow("LLM","Providers",`${enabled.length} connected`),overviewRow("SYS","System","Operational")].join("");}
$("providerSelect").onchange=async e=>{if(!e.target.value)return;await api("/api/providers",{method:"POST",body:{preferred:e.target.value}});toast(`Primary provider: ${e.target.value}`);refreshAll()};
let voiceConnected=false;
function agents(h){const list=[{c:"Y",n:"YORU Core",s:h.ok?"Active":"Offline"},{c:"A",n:"ACE Agent",s:"Standby"},{c:"D",n:"Discord Bot",s:h.bot?.running?"Active":"Offline"},{c:"ALT",n:"Alt Interface",s:h.selfbot?.running?"Active":"Offline"}];$("agentGrid").innerHTML=list.map(a=>`<div class="agent-card"><i>${a.c}</i><div><b>${a.n}</b><small>${a.s}</small></div></div>`).join("");}
function missions(events){const latest=events.slice(-4).reverse();$("missionList").innerHTML=(latest.length?latest:[{at:new Date().toISOString(),message:"Command center initialized"},{at:new Date().toISOString(),message:"Provider health monitoring"},{at:new Date().toISOString(),message:"Voice recorder standing by"}]).map((e,i)=>`<div class="mission-row"><time>${new Date(e.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time><div>${esc(e.message)}<i style="width:${90-i*15}%"></i></div><span>${i?"LOGGED":"NOW"}</span></div>`).join("");}
function activity(events){$("activityFeed").innerHTML=(events.slice(-8).reverse().map(e=>`<div class="feed-item"><i>${esc((e.kind||"E").slice(0,1).toUpperCase())}</i><div><b>${esc(e.message)}</b><small>${esc(e.kind||"system")}</small></div><time>${new Date(e.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></div>`).join(""))||`<div class="empty-line">No activity logged yet.</div>`;}
async function refreshAll(){try{const [h,p,s,a,v,k,w]=await Promise.all([api("/api/health",{owner:false}),api("/api/providers"),api("/api/owner/system"),api("/api/owner/activity"),api("/api/owner/voice"),api("/api/owner/killswitch"),api("/api/workspace/info",{owner:false})]);voiceConnected=!!v.inChannel;renderProviders(p.providers,p.preferred);agents(h);activity(a.events||[]);missions(a.events||[]);$("sessionCount").textContent=String(w.sessions?.length||0);const used=Math.round(((s.memGB-s.freeMemGB)/s.memGB)*100);$("cpuGauge").style.setProperty("--value",Math.min(100,s.cpus*5));$("cpuGauge").querySelector("span").textContent=`${s.cpus}C`;$("ramGauge").style.setProperty("--value",used);$("ramGauge").querySelector("span").textContent=`${used}%`;const up=Math.min(99,Math.round(s.uptimeMin/60));$("diskGauge").style.setProperty("--value",up);$("diskGauge").querySelector("span").textContent=`${up}H`;$("systemTelemetry").textContent=`HOST       ${s.hostname}\nPLATFORM   ${s.platform} ${s.arch}\nPROCESSORS ${s.cpus}\nMEMORY     ${(s.memGB-s.freeMemGB).toFixed(1)} / ${s.memGB} GB\nUPTIME     ${s.uptimeMin} minutes\nHOME       ${s.home}\nACCESS     ${s.unrestricted?"UNRESTRICTED":"SANDBOXED"}`;$("networkState").textContent=`NETWORK / ${h.ok?"CONNECTED":"OFFLINE"}`;$("callState").textContent=`VOICE / ${v.inChannel?"RECORDING":"STANDBY"}`;$("killState").textContent=k.active?"LOCKDOWN ACTIVE":"SYSTEM CLEAR";$("killState").style.color=k.active?"var(--red)":"var(--green)";$("voiceState").textContent=v.inChannel?`Recording channel ${v.channelId}; ${v.events||0} voice events captured.`:"No active voice session.";}catch(e){$("networkState").textContent="NETWORK / OFFLINE";}}
refreshAll();setInterval(refreshAll,7000);

$("lookupGo").onclick=runLookup;$("lookupQuery").addEventListener("keydown",e=>{if(e.key==="Enter")runLookup()});
function flattenHit(hit){if(hit.row&&typeof hit.row==="object")return Object.entries(hit.row);if(hit.context)return [["Context",hit.context],["Line",hit.line||"—"]];return Object.entries(hit).filter(([k])=>!['row','context'].includes(k));}
async function runLookup(){const q=$("lookupQuery").value.trim();if(q.length<3)return toast("Use at least three characters.");$("lookupSummary").innerHTML="<b>SEARCHING</b><span>Scanning indexed knowledge sources…</span>";$("lookupResults").innerHTML="";try{const r=await api("/api/owner/lookup",{method:"POST",body:{query:q}});const hits=(r.matches||[]).flatMap(group=>(group.hits||[]).map(hit=>({hit,error:group.error})));if(r.protected&&!hits.length){$("lookupSummary").innerHTML="<b>PROTECTED</b><span>This identity is excluded from lookup output.</span>";return}$("lookupSummary").innerHTML=`<b>${hits.length} MATCH${hits.length===1?"":"ES"}</b><span>Searched ${r.files||0} indexed sources for “${esc(q)}”. Source identities remain private.</span>`;$("lookupResults").innerHTML=hits.map(({hit},i)=>`<article class="result-card"><header><b>RESULT ${String(i+1).padStart(3,"0")}</b><span>CONFIRMED MATCH</span></header><dl class="result-fields">${flattenHit(hit).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==="object"?JSON.stringify(v):v)}</dd>`).join("")}</dl></article>`).join("")||`<div class="lookup-summary hud-panel"><b>NO MATCHES</b><span>No indexed records matched that query.</span></div>`;}catch(e){$("lookupSummary").innerHTML=`<b>ERROR</b><span>${esc(e.message)}</span>`;}}

let fileCwd="~",selectedFile=null;
async function loadRoots(){try{const r=await api("/api/owner/fs/roots");$("fileRoots").innerHTML=r.roots.map(root=>`<button data-root="${esc(root.path)}">${esc(root.name)}</button>`).join("");$("fileRoots").querySelectorAll("button").forEach(b=>b.onclick=()=>browseFiles(b.dataset.root));}catch(e){$("fileRoots").innerHTML=`<div class="empty-line">${esc(e.message)}</div>`;}}
function bytes(n){if(!n)return "—";if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;return `${(n/1048576).toFixed(1)} MB`;}
async function browseFiles(path=fileCwd){$("filePath").value=path;$("fileList").innerHTML='<div class="empty-line">Opening location…</div>';try{const r=await api("/api/owner/fs/list",{method:"POST",body:{path}});fileCwd=r.items[0]?.path?parentPath(r.items[0].path):path;$("filePath").value=fileCwd;$("breadcrumbs").textContent=fileCwd;$("fileList").innerHTML=r.items.map(item=>`<div class="file-row"><button data-path="${esc(item.path)}" data-type="${item.type}"><svg><use href="#i-${item.type==='dir'?'folder':'file'}"/></svg><b>${esc(item.name)}</b><small>${item.type==='dir'?'DIRECTORY':bytes(item.size)}</small></button></div>`).join("")||'<div class="empty-line">Empty folder.</div>';$("fileList").querySelectorAll("button").forEach(b=>b.onclick=()=>b.dataset.type==="dir"?browseFiles(b.dataset.path):openFile(b.dataset.path));}catch(e){$("fileList").innerHTML=`<div class="empty-line">${esc(e.message)}</div>`;}}
function parentPath(p){if(/^[A-Za-z]:\\?$/.test(p))return p;const clean=p.replace(/[\\/]+$/,'');const idx=Math.max(clean.lastIndexOf('/'),clean.lastIndexOf('\\'));return idx<=0?(clean.includes('\\')?clean.slice(0,3):'/'):clean.slice(0,idx)}
async function openFile(path){try{const r=await api("/api/owner/fs/read",{method:"POST",body:{path}});selectedFile=path;$("editorName").textContent=path;$("fileEditor").value=r.content;$("saveFile").disabled=false;$("askFile").disabled=false;}catch(e){toast(e.message,4000)}}
$("fileGo").onclick=()=>browseFiles($("filePath").value.trim());$("filePath").addEventListener("keydown",e=>{if(e.key==="Enter")$("fileGo").click()});$("fileUp").onclick=()=>browseFiles(parentPath(fileCwd));$("saveFile").onclick=async()=>{if(!selectedFile)return;await api("/api/owner/fs/write",{method:"POST",body:{path:selectedFile,content:$("fileEditor").value}});toast("File saved.")};$("askFile").onclick=()=>selectedFile&&send(`Review and help me edit this file: ${selectedFile}`);

async function loadSecurity(){try{const [ka,va,k,v]=await Promise.all([api("/api/owner/killswitch-admins"),api("/api/owner/voice-admins"),api("/api/owner/killswitch"),api("/api/owner/voice")]);$("killAdmins").value=(ka.admins||[]).join("\n");$("voiceAdmins").value=(va.admins||[]).join("\n");$("killState").textContent=k.active?"LOCKDOWN ACTIVE":"SYSTEM CLEAR";$("voiceState").textContent=v.inChannel?`Recording channel ${v.channelId}.`:"No active voice session.";}catch(e){toast(e.message)}}
function ids(id){return $(id).value.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean)}
$("saveKillAdmins").onclick=async()=>{await api("/api/owner/killswitch-admins",{method:"POST",body:{admins:ids("killAdmins")}});toast("Killswitch admins saved.")};$("saveVoiceAdmins").onclick=async()=>{await api("/api/owner/voice-admins",{method:"POST",body:{admins:ids("voiceAdmins")}});toast("Voice admins saved.")};$("ksEngage").onclick=async()=>{await api("/api/owner/killswitch",{method:"POST",body:{reason:"command-center"}});toast("Killswitch engaged.");refreshAll()};$("ksRelease").onclick=async()=>{await api("/api/owner/jumpstart",{method:"POST"});toast("YORU jumpstarted.");refreshAll()};$("voiceJoin").onclick=async()=>{const channel=$("voiceChannel").value.trim();if(!channel)return toast("Enter a channel ID or name.");await api("/api/owner/voice/join",{method:"POST",body:{channel}});toast("Voice session started.");refreshAll()};$("voiceLeave").onclick=async()=>{const r=await api("/api/owner/voice/leave",{method:"POST"});toast(r.message||"Voice files saved.",4000);refreshAll()};
const meetings=()=>showView("security");document.querySelectorAll('[data-action="meetings"]').forEach(b=>b.onclick=meetings);

function fmtGb(n){return n?(n/1024**3).toFixed(2)+" GB":"?"}
async function loadModels(){
  try{
    const r=await api("/api/models/custom");
    $("modelsEnabled").checked=!!r.enabled;
    const list=$("mbList");
    if(!r.models?.length){list.innerHTML='<div class="empty-line">No models built yet. Point the builder at an HF folder or a .gguf file above.</div>';return}
    list.innerHTML=r.models.map(m=>{
      const active=m.name===r.active;
      return `<div class="hud-panel" style="padding:12px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><b>${esc(m.name)}</b> ${active?'<span style="color:#27dcf4">· ACTIVE</span>':''}
          <div style="font-size:12px;opacity:.7">${fmtGb(m.sizeBytes)} · ~${m.paramsB||"?"}B params · ${m.kind||"?"} · ${m.runtime||"ollama"}</div>
          <div style="font-size:11px;opacity:.5">${esc(m.source||"")}</div></div>
        <div style="display:flex;gap:6px">
          <button data-use="${esc(m.name)}">USE</button>
          <button data-del="${esc(m.name)}" style="color:#ff6b6b">DELETE</button>
        </div></div>`;
    }).join("");
    list.querySelectorAll("[data-use]").forEach(b=>b.onclick=async()=>{await api("/api/models/custom/use",{method:"POST",body:{name:b.dataset.use}});toast(`Now using ${b.dataset.use}`);loadModels()});
    list.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!confirm(`Delete ${b.dataset.del}?`))return;await api("/api/models/custom/delete",{method:"POST",body:{name:b.dataset.del}});toast("Deleted");loadModels()});
  }catch(e){toast(e.message,4000)}
}
$("modelsEnabled")?.addEventListener("change",async e=>{await api("/api/models/custom/toggle",{method:"POST",body:{enabled:e.target.checked}});toast(`Custom models ${e.target.checked?"enabled":"disabled"}`)});
$("mbRefresh")?.addEventListener("click",loadModels);
$("mbBuild")?.addEventListener("click",async()=>{
  const sourcePath=$("mbSource").value.trim();
  if(!sourcePath)return toast("Enter a HuggingFace repo ID, folder, or .gguf path.");
  const name=$("mbName").value.trim()||undefined;
  const system=$("mbSystem").value.trim()||undefined;
  const base=$("mbBase")?.value.trim()||undefined;
  const force=$("mbForce").checked;
  const log=$("mbLog");log.textContent=`Building from ${sourcePath}\n(this can take a while — HuggingFace downloads stream progress below.)\n\n`;
  $("mbBuild").disabled=true;
  try{
    const r=await api("/api/models/custom/build",{method:"POST",body:{sourcePath,name,system,base,force}});
    log.textContent+=(r.logs||[]).join("\n")+`\n\n✓ Built ${r.built.name} (${fmtGb(r.built.sizeBytes)})`;
    toast(`Built ${r.built.name}`);loadModels();
  }catch(e){log.textContent+=`\n✗ ${e.message}`;toast(e.message,6000)}
  finally{$("mbBuild").disabled=false;log.scrollTop=log.scrollHeight}
});
