import { registerMenuPage } from '../../common/menu-crossbar.js';
import { registerVisorPage } from '../../common/visor-page.js';
import '../../common/visor-menu.js';
import '../../common/desktop-controls.js';
import { generationSettings } from '../impossible-spaces/generation-menu.js';
import './lobby.ts';
import './room-hud.ts';

const game = () => document.querySelector('[impossible-game]')?.components['impossible-game'];
const session = () => game()?.expansion;
const bindings:any[]=[];
const action=(id:string,label:string,info?:any)=>({kind:'action',id,label,info});
function setting(kind:string,group:string,key:string,label:string,value:any,info:string,extra={}) {
  const item={kind,id:`expand:${group}:${key}`,label,value,info,...extra};bindings.push({item,group,key});return item;
}
const num=(group,key,label,value,min,max,step,suffix='')=>setting('number',group,key,label,value,key==='scale'?'Used next time you Generate level. This changes the floor plan size.':'Advanced setting. Change a little, then try walking.',{min,max,step,suffix});
const toggle=(key,label,value,info)=>setting('toggle','experiments',key,label,value,info);
// Original growth remains the only generator. A target may be shortened when space is tight.
for(const item of generationSettings.growth)if(item.id==='growth:minWidth')item.value=1;
for(const item of generationSettings.growth)if(item.id==='growth:pieceCount'){item.value=36;item.label='Room + hall target';item.max=100;item.info='Try to make this many rooms, halls and lifts. Small boundaries may fit fewer.';}
const customize={kind:'submenu',id:'customize',label:'Customize',info:'Build your kind of place. Changes are used next time you Generate level.',items:[
  ...generationSettings.growth.filter(i=>['growth:pieceCount','growth:minSizePct','growth:maxSizePct'].includes(i.id)),
  setting('select','session','roomTypes','Room shapes','mixed','Choose familiar rectangles or a mix of shapes. Used for the next level.',{options:[{value:'mixed',label:'Mixed shapes'},{value:'simple',label:'Simple rectangles'},{value:'bendy',label:'Bendy rooms'}]}),
  {kind:'submenu',id:'generation-advanced',label:'More building options',items:generationSettings.growth.filter(i=>!['growth:pieceCount','growth:minSizePct','growth:maxSizePct'].includes(i.id))}
]};
const advanced={kind:'submenu',id:'advanced-effects',label:'Advanced tuning',info:'For grown-up experiments. You do not need these to play.',items:[
  num('session','scale','World width / depth',1.25,1,2,.05,'x'),
  num('gain','maxGain','Longest steps',1.2,1,2,.05,'x'),num('gain','speedForMax','Full gain at',2,.8,4,.1,' m/s'),
  num('steering','maxCurvature','Walking curve',5,0,20,1,' deg/m'),num('steering','maxSteeringRate','Turning rate cap',6,1,30,1,' deg/s'),
  num('steering','minTurnGain','Smallest turn',.9,.5,1,.05,'x'),num('steering','maxTurnGain','Largest turn',200/180,1,1.5,.01,'x'),
  num('steering','lookAhead','Look ahead',1.5,.5,3,.1,' s'),num('steering','wallMargin','Edge space',.4,.2,1,.05,' m'),
  num('steering','steeringSpeed','Full curve at',2,.8,4,.1,' m/s'),num('steering','turnSpeed','Full turn gain at',180,60,360,10,' deg/s'),num('steering','alignmentStrength','Turn strength',1,0,1,.05)
]};
export const experimentItems=[
  toggle('routes','Plan the next door',true,'Think ahead! We try to leave room for your walk through the next door, not just the room you are in. Works while you play.'),
  toggle('translation','Longer steps',true,'One real step can take you a little farther in the game. Objects stay the same size. Works while you play.'),
  toggle('adaptiveGain','Steps that fit',false,'When a door is far away, your game steps can gently grow. This helps you reach it with fewer real steps. Works while you play.'),
  toggle('steering','Bend my walk',true,'A tiny turn of the world can make a straight-looking walk follow a gentle curve. Works while you walk.'),
  toggle('turns','Help my turns',true,'When you turn your head, the game can turn a little more or less. This aims your next walk toward open floor.'),
  toggle('adaptiveRooms','Fit the next wing',false,'Inside a closed lift, the next rooms can turn and stretch a little to fit your floor. The lift and things inside it stay still.'),
  toggle('growOnRide','Build as I explore',false,'The first time you ride to a new place, we build its rooms while the lift is shut. Places you have seen stay the same. The lift may wait a moment.'),
  toggle('blockers','Paths around things',false,'Fences make a path around the room. You can see across them, but walk around them. Used for the next level.'),
  toggle('attention','Things to look at',false,'Wall pictures glow and move so there are fun things to look at. You do not have to look at them to keep playing. Used for the next level.'),
  toggle('switches','Door switches',false,'Some doors have a switch off to the side. Walk to it, then come back through the door. Used for the next level.'),
  setting('select','experiments','floorCues','Floor pattern','normal','Small squares pass your feet more often. Does that make you feel faster? This only changes the picture on the floor.',{options:[{value:'normal',label:'Normal squares'},{value:'dense',label:'Small squares'},{value:'sparse',label:'Big squares'}]}),
  advanced
];
const experiments={kind:'submenu',id:'experiments',label:'Experiments',info:'Try one trick at a time. The little card explains what it does.',items:experimentItems};
const debug={kind:'submenu',id:'debug',label:'Tools & help',info:()=>session()?.describe()||'',items:[
  setting('toggle','session','paused','Pause movement effects',false,'Keep real head tracking, but stop extra steps and world turning.'),
  action('expand-reanchor','Recover here','Return inside your real boundary first. This puts the game back around you.'),action('outline','Show / hide boundary'),
  action('expand-ride','Ride lift (accessible)','Use this instead of pulling the handle. Stand fully inside the lift first.'),
  action('expand-map','Show / hide debug map','Desktop-only map of the whole generated layout.'),action('expand-export','Save debug report'),action('expand-clear-stats','Clear counters'),
  {kind:'info',id:'expand-stats',label:'Walking stats',info:()=>session()?.describe()||''}
]};
export function setupItems(){
  const g=game();if(g?.measuring())return g.calibration().menuItems();
  if(g?.generating)return [{kind:'info',id:'building',label:'Building your level...',info:()=>g.detail},action('expand-exit','Cancel')];
  if(!g?.manualBoundary)return [action('expand-boundary','Set Boundary','Walk around your clear floor, or point down and hold the trigger to paint it. Then open your watch and choose Set Boundary.')];
  return [action('generate-current','Generate level','Make rooms and start exploring!'),customize,action('expand-boundary','Redraw Boundary','Replace your floor outline. Cancel keeps your old outline.')];
}
function syncValues(){const s=session();if(s)for(const b of bindings)b.item.value=(b.group==='session'?s:s[b.group])[b.key];}
const portable={title:'EXPANDING ROOMS',items:()=>game()?.measuring()?setupItems():game()?.level?[action('expand-exit','Exit level','Return to setup. Your saved boundary stays ready.'),experiments,debug]:[...setupItems(),...(game()?.manualBoundary?[experiments,debug]:[])],info:()=>game()?.message||'Make room for an adventure.',onOpen:syncValues};
registerMenuPage('expanding-watch',portable);registerVisorPage('expanding-visor',portable);
registerMenuPage('expanding-setup',{title:'LET\'S EXPLORE',items:setupItems,info:()=>game()?.message||'Start with your floor.',onOpen:syncValues});
registerMenuPage('expanding-experiments',{title:'EXPERIMENTS',items:experimentItems,info:'Optional tricks. Pick one to learn what it does.',onOpen:syncValues});
document.addEventListener('menu-commit',(event:any)=>{
  const s=session(),b=bindings.find(b=>b.item.id===event.detail.id);if(!s||!b)return;
  (b.group==='session'?s:s[b.group])[b.key]=event.detail.value;s.sync();syncValues();
});
document.addEventListener('menu-action',(event:any)=>{
  const g=game(),s=session();if(!s)return;const id=event.detail.id;
  if(id==='expand-boundary'){
    if(g.xr){g.calibration().inputItem.value='both';g.calibration().start();if(!g.measuring())g.status('Boundary setup',g.calibration().status);}
    else {g.manualBoundary={preview:true};g.status('Preview boundary ready','Enter VR to paint your real floor.');}
  }
  if(id==='expand-exit'){g.cancelGeneration();g.clearLevel();g.status('Ready to explore','Generate another level, or change things in Customize.');g.scene.components['expanding-lobby']?.recenter();}
  if(id==='expand-reanchor')s.recover();if(id==='expand-ride')g.requestRide(1,true);
  if(id==='expand-map'){const map=document.querySelector('#map');map.hidden=!map.hidden;}
  if(id==='expand-export')s.exportReport();if(id==='expand-clear-stats'&&s.walker)for(const k of Object.keys(s.walker.stats))s.walker.stats[k]=0;
});
