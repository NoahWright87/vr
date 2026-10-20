import { DEFAULT_CONFIG, SHAPES, PROFILES, validateConfig, totalJobs, VERSION } from './model.ts';
import { summarize, addResult, groupRows } from './results.ts';
import { renderWalls, colliderWalls } from '../../impossible-spaces/core/runtime.ts';
import { raySeg, edgesOf } from '../../impossible-spaces/core/geometry.ts';
const $=(id:string)=>document.getElementById(id)!;
const field=(id:string)=>$(id) as HTMLInputElement;
const numeric=['startSeed','seeds','seconds','pieces','speedForMax','maxCurvature','steeringSpeed','maxSteeringRate','lookAhead','wallMargin','minTurnGain','maxTurnGain','turnSpeed','alignmentStrength'];
const toggles=['boundaryStop','steeringEnabled','turnEnabled'];
for(const [id,values] of [['shapes',SHAPES],['profiles',PROFILES]] as const)for(const value of values) {
  const label=document.createElement('label');label.className='check';
  const input=document.createElement('input');input.type='checkbox';input.name=id;input.value=value;input.checked=DEFAULT_CONFIG[id].includes(value);
  label.append(input,document.createTextNode(value));$(id).append(label);
}
const effectFields=[
  ['speedForMax','Full movement gain at (m/s)',.8,4,.1],
  ['maxCurvature','Maximum curve (degrees/m)',0,20,1],['steeringSpeed','Full steering at (m/s)',.8,4,.1],
  ['maxSteeringRate','Steering cap (degrees/s)',1,30,1],['lookAhead','Look ahead (s)',.5,3,.1],
  ['wallMargin','Guidance wall margin (m)',.1,1,.05],['minTurnGain','Minimum turn gain',.5,1,.05],
  ['maxTurnGain','Maximum turn gain',1,1.5,.01],['turnSpeed','Full turn gain at (degrees/s)',60,360,10],
  ['alignmentStrength','Overlap response',0,1,.05],
];
for(const [id,title] of [['steeringEnabled','Walking steering'],['turnEnabled','Turn gain']]) {
  const label=document.createElement('label');label.className='check';const input=document.createElement('input');
  input.id=id;input.type='checkbox';input.checked=true;label.append(input,document.createTextNode(title));$('effects').append(label);
}
for(const [id,title,min,max,step] of effectFields) {
  const label=document.createElement('label');label.textContent=String(title);const input=document.createElement('input');
  input.id=String(id);input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(DEFAULT_CONFIG[id]);label.append(input);$('effects').append(label);
}
// Default 200/180 is intentionally not rounded to a menu step.
field('maxTurnGain').step='any';
const selected=(name:string)=>[...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el:HTMLInputElement)=>el.value);
function readConfig() {
  const c:any={...DEFAULT_CONFIG,shapes:selected('shapes'),profiles:selected('profiles')};
  for(const id of numeric)c[id]=Number(field(id).value);
  for(const id of toggles)c[id]=field(id).checked;
  for(const id of ['scales','gains'])c[id]=field(id).value.split(',').map(s=>Number(s.trim()));
  return validateConfig(c);
}
function fillConfig(c:any) {
  for(const id of numeric)field(id).value=String(c[id]);
  for(const id of toggles)field(id).checked=c[id];
  for(const id of ['scales','gains'])field(id).value=c[id].join(', ');
  for(const name of ['shapes','profiles'])document.querySelectorAll(`input[name="${name}"]`).forEach((el:HTMLInputElement)=>{el.checked=c[name].includes(el.value);});
}
let worker:Worker|null=null,config=validateConfig(DEFAULT_CONFIG),results:any[]=[],replayFrames:any[]=[],view:any=null,snapshot:any=null;
let paused=false,replaying=false,playing=false,started=0,simulated=0,wallSeconds=0,pausedAt=0,total=0,done=0,trail:any[]=[];
const aggregates=new Map<string,any>();let renderQueued=false;
function queueResults(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;renderResults();});}
function status(text:string){$('status').textContent=text;}
function controls(active:boolean) {
  (field('run') as any).disabled=active;(field('sweep') as any).disabled=active;
  (field('pause') as any).disabled=!active;(field('stop') as any).disabled=!active;
  $('pause').textContent=paused?'Resume':'Pause';
  $('settings').querySelectorAll('input').forEach((el:HTMLInputElement)=>{el.disabled=active;});
  field('load').disabled=active;
}
function stop() {
  const wasRunning=!!worker;
  worker?.terminate();worker=null;playing=false;
  if(paused)started+=performance.now()-pausedAt;
  if(wasRunning&&!replaying)wallSeconds=(performance.now()-started)/1000;
  paused=false;controls(false);
}
function progress(includeCurrent=true) {
  const elapsed=Math.max(.001,(performance.now()-started)/1000);
  const time=simulated+(includeCurrent?(snapshot?.time||0):0);
  status(`${replaying?'Replaying':`Batch ${done} / ${total}`} · ${paused?'paused · ':''}${(time/elapsed).toFixed(1)}× measured · ${Math.round(time)} simulated seconds / ${elapsed.toFixed(1)} wall seconds`);
}
function start(c:any,replay=false) {
  stop();started=performance.now();simulated=0;done=0;total=totalJobs(c);replaying=replay;replayFrames=[];trail=[];
  $('replay').hidden=true;paused=false;controls(true);
  worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
  worker.onerror=event=>{stop();status(`Simulation worker failed: ${event.message}`);};
  worker.onmessage=event=>{
    const m=event.data;
    if(m.type==='error'){stop();status(m.message);return;}
    if(m.type==='episode'){view=m;snapshot=m.snapshot;trail=[];draw();}
    if(m.type==='frame'){snapshot=m.snapshot;trail.push(snapshot);if(trail.length>3000)trail.shift();draw();progress();}
    if(m.type==='result') {
      done=m.completed;simulated+=m.result.seconds;snapshot=m.snapshot;
      if(replay) {
        replayFrames=m.trace||[];if(m.level)view={...m,job:m.result.job};
        $('replay').hidden=!replayFrames.length;field('scrub').max=String(Math.max(0,replayFrames.length-1));field('scrub').value='0';
        if(replayFrames.length){snapshot=replayFrames[0];trail=[];}
        $('detail').textContent=`${m.result.outcome}: ${m.result.reason}${m.result.warning?' Generation note: '+m.result.warning:''}`;
      } else {
        results.push(m.result);addResult(aggregates,m.result);queueResults();progress(false);
      }
      draw();
    }
    if(m.type==='done') {
      const elapsed=(performance.now()-started)/1000;
      stop();
      renderResults();
      status(`${replay?'Replay ready':`Finished ${done} episodes`} · ${(simulated/Math.max(.001,elapsed)).toFixed(1)}× measured throughput · ${simulated.toFixed(1)} simulated seconds in ${elapsed.toFixed(1)} s`);
    }
  };
  worker.postMessage({type:'start',config:c,rate:Number(field('rate').value),replay});
  status(replay?'Regenerating the selected episode…':`Starting ${total} episodes…`);
}
function renderResults() {
  $('summary').replaceChildren();$('results').replaceChildren();
  for(const group of groupRows(aggregates)) {
    const row=document.createElement('tr');
    const values=[group.key,`${group.completed}/${group.runs} (${Math.round(group.completionRate*100)}%)`,
      Object.entries(group.outcomes).map(([k,v])=>`${k}: ${v}`).join(' · '),
      `${(group.physical/group.runs).toFixed(1)} / ${(group.virtual/group.runs).toFixed(1)}`,
      group.minClearance===null?'—':`${group.minClearance.toFixed(2)} m`];
    for(const text of values){const td=document.createElement('td');td.textContent=text;row.append(td);}$('summary').append(row);
  }
  for(const result of results.slice(-100).reverse()) {
    const row=document.createElement('tr'),job=result.job;
    for(const text of [job.seed,`${job.shape} / ${job.profile} / ${job.scale}× / ${job.gain}×`,result.outcome,`${result.seconds.toFixed(1)} s`]) {
      const td=document.createElement('td');td.textContent=String(text);row.append(td);
    }
    const td=document.createElement('td'),button=document.createElement('button');button.textContent='Replay';button.disabled=!!worker;
    button.onclick=()=>{if(worker)return;start(validateConfig({...job,shapes:[job.shape],profiles:[job.profile],scales:[job.scale],gains:[job.gain],startSeed:job.seed,seeds:1}),true);};
    td.append(button);row.append(td);$('results').append(row);
  }
}
function draw() {
  if(!view||!snapshot)return;
  const state={activeId:snapshot.activeId,pos:snapshot.virtual,doorsClosed:snapshot.doorsClosed};
  const walls=colliderWalls(view.level,state),visible=renderWalls(view.level,state);
  const physical=(p:any)=>{
    const dx=p.x-snapshot.mapping.x,dz=p.y-snapshot.mapping.z,c=Math.cos(snapshot.yaw),s=Math.sin(snapshot.yaw);
    return {x:c*dx-s*dz,y:s*dx+c*dz};
  };
  for(const name of ['physical','virtual']) {
    const canvas=$(name) as HTMLCanvasElement,ctx=canvas.getContext('2d')!,real=name==='physical';
    const bounds=real?view.boundary:view.level.params.footprint;
    const minX=Math.min(...bounds.map(p=>p.x)),maxX=Math.max(...bounds.map(p=>p.x)),minY=Math.min(...bounds.map(p=>p.y)),maxY=Math.max(...bounds.map(p=>p.y));
    const scale=Math.min((canvas.width-60)/(maxX-minX),(canvas.height-60)/(maxY-minY));
    const project=(p:any)=>({x:canvas.width/2+(p.x-(minX+maxX)/2)*scale,y:canvas.height/2+(p.y-(minY+maxY)/2)*scale});
    const path=(poly:any[],closed=true)=>{ctx.beginPath();poly.forEach((p,i)=>{const q=project(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});if(closed)ctx.closePath();};
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.lineWidth=1;ctx.strokeStyle='#26384b';
    for(let x=Math.ceil(minX);x<=maxX;x++){path([{x,y:minY},{x,y:maxY}],false);ctx.stroke();}
    for(let y=Math.ceil(minY);y<=maxY;y++){path([{x:minX,y},{x:maxX,y}],false);ctx.stroke();}
    path(bounds);ctx.strokeStyle=real?'#ffad54':'#687f9c';ctx.lineWidth=2;ctx.stroke();
    if(!real&&field('allRooms').checked){ctx.globalAlpha=.18;for(const piece of view.level.pieces)for(const poly of piece.parts){path(poly);ctx.stroke();}ctx.globalAlpha=1;}
    for(const item of visible) {
      const hue=[...item.pieceId].reduce((n,c)=>n+c.charCodeAt(0)*37,0)%360;
      ctx.fillStyle=`hsla(${hue},65%,65%,.12)`;ctx.strokeStyle=`hsl(${hue},65%,65%)`;
      for(const region of item.regions){path(real?region.map(physical):region);ctx.fill();}
      ctx.lineWidth=2;for(const wall of item.walls){path(real?wall.map(physical):wall,false);ctx.stroke();}
    }
    const origin=real?snapshot.physical:snapshot.virtual,yaw=snapshot.head+(real?0:snapshot.yaw);
    const cone=[origin],occluders=real?edgesOf(view.boundary):walls;
    for(let i=0;i<=32;i++) {
      const angle=yaw-Math.PI*.55/2+Math.PI*.55*i/32,dir={x:-Math.sin(angle),y:-Math.cos(angle)};
      let length=2;for(const [a,b] of occluders){const t=raySeg(origin,dir,a,b);if(t!==null)length=Math.min(length,t);}
      cone.push({x:origin.x+dir.x*length,y:origin.y+dir.y*length});
    }
    path(cone);ctx.fillStyle='#ffe38c24';ctx.fill();
    path(trail.map(f=>real?f.physical:f.virtual),false);ctx.strokeStyle=real?'#68ccff':'#ffd477';ctx.lineWidth=2;ctx.stroke();
    if(!real&&(snapshot.activeId===view.exit||field('allRooms').checked)) {
      const p=project(view.exitPoint);ctx.strokeStyle='#7ce7af';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,.18*scale,0,Math.PI*2);ctx.stroke();
    }
    const p=project(origin);ctx.fillStyle='#68ccff';ctx.beginPath();ctx.arc(p.x,p.y,.16*scale,0,Math.PI*2);ctx.fill();
    const body=snapshot.body+(real?0:snapshot.yaw);
    path([origin,{x:origin.x-Math.sin(body)*.35,y:origin.y-Math.cos(body)*.35}],false);ctx.strokeStyle='#fff';ctx.stroke();
  }
  $('telemetry').textContent=`${view.job?.shape||''} · ${snapshot.time.toFixed(1)} s · ${snapshot.activeId} · physical ${snapshot.stats.physicalMetres.toFixed(1)} m / virtual ${snapshot.stats.virtualMetres.toFixed(1)} m · ${snapshot.stats.rejectedGain} rejected gain steps · ${snapshot.outcome||'walking / scanning'}`;
}
$('settings').onsubmit=event=>{event.preventDefault();try{config=readConfig();results=[];aggregates.clear();renderResults();start(config);}catch(error){status(error.message);}};
$('sweep').onclick=()=>fillConfig({...DEFAULT_CONFIG,shapes:[...SHAPES],profiles:[...PROFILES],scales:[1,1.25,1.5],gains:[1,1.2],seeds:20});
$('pause').onclick=()=>{
  paused=!paused;if(paused)pausedAt=performance.now();else started+=performance.now()-pausedAt;
  worker?.postMessage({type:'pause',value:paused});controls(true);status(paused?'Paused. Settings and completed results are retained.':'Resuming…');
};
$('stop').onclick=()=>{stop();renderResults();status(`Stopped. ${results.length} completed episodes retained; the unfinished episode is not counted.`);};
$('rate').onchange=()=>worker?.postMessage({type:'rate',value:Number(field('rate').value)});
$('allRooms').onchange=draw;
function scrub(){const index=Number(field('scrub').value);snapshot=replayFrames[index];if(!snapshot)return;trail=replayFrames.slice(0,index+1);$('replayTime').textContent=`${snapshot.time.toFixed(1)} / ${replayFrames.at(-1).time.toFixed(1)} s`;draw();}
$('scrub').oninput=()=>{playing=false;scrub();};
$('play').onclick=()=>{playing=!playing;if(Number(field('scrub').value)>=replayFrames.length-1)field('scrub').value='0';};
let lastAnimation=0;
function animate(time:number){if(playing&&time-lastAnimation>=100){lastAnimation=time;const next=Number(field('scrub').value)+1;if(next>=replayFrames.length)playing=false;else{field('scrub').value=String(next);scrub();}}requestAnimationFrame(animate);}
requestAnimationFrame(animate);
$('export').onclick=()=>{
  try {
    const report={version:VERSION,config:results.length?config:readConfig(),results,summary:summarize(results),wallSeconds};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='walking-simulator.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status(error.message);}
};
$('load').onchange=async()=>{
  try {
    const file=field('load').files?.[0];if(!file)return;if(file.size>100*1024*1024)throw new Error('Load reports smaller than 100 MB.');
    const text=await file.text();let report:any;
    try{report=JSON.parse(text);}catch{
      const rows=text.trim().split(/\r?\n/).map(line=>JSON.parse(line));
      report={version:rows[0]?.version,config:rows[0]?.config,results:rows.filter(r=>r.type==='result').map(r=>r.result)};
    }
    if(report.version!==VERSION)throw new Error('Unsupported report version.');
    if(!report.config||typeof report.config!=='object'||Array.isArray(report.config))throw new Error('Report is missing simulator settings.');
    const loaded=validateConfig(report.config);const imported=report.results||[];
    if(!Array.isArray(imported)||imported.length>100000)throw new Error('Invalid result count.');
    for(const r of imported) {
      if(!r.job||!Number.isFinite(r.seconds)||r.seconds<0||!r.stats||!['completed','boundary-stop','boundary-exit','wall-block','navigation-stall','timeout','no-exit','generation-failed','simulation-error'].includes(r.outcome))throw new Error('Invalid episode result.');
      validateConfig({...r.job,shapes:[r.job.shape],profiles:[r.job.profile],scales:[r.job.scale],gains:[r.job.gain],seeds:1,startSeed:r.job.seed});
      for(const value of [r.stats.physicalMetres,r.stats.virtualMetres,...(r.minClearance===null?[]:[r.minClearance])])if(!Number.isFinite(value)||value<0)throw new Error('Invalid episode metrics.');
    }
    stop();config=loaded;results=imported;aggregates.clear();for(const r of results)addResult(aggregates,r);
    wallSeconds=Number.isFinite(report.wallSeconds)?report.wallSeconds:0;
    fillConfig(config);renderResults();status(`Loaded ${results.length} completed episodes. Select Replay or run a new batch.`);
  }catch(error){status(`Could not load: ${error.message}`);}finally{field('load').value='';}
};
// Expose no alternate simulation logic: browser tests inspect only rendered state.
fillConfig(config);
