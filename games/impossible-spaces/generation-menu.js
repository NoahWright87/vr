import {registerMenuPage} from '../../common/menu-crossbar.js';
const game=()=>document.querySelector('[impossible-game]')?.components['impossible-game'];
const numeric=(style,key,label,value,min,max,step=1,suffix='')=>({kind:'number',id:`${style}:${key}`,label,value,min,max,step,suffix});
const choose=(style,key,label,value,values,suffix='')=>({kind:'select',id:`${style}:${key}`,label,value,options:values.map(value=>({value,label:String(value)+suffix}))});
export const generationSettings={
  growth:[numeric('growth','pieceCount','Pieces',12,2,24),numeric('growth','minSizePct','Min room %',3,1,30),numeric('growth','maxSizePct','Max room %',15,1,50),choose('growth','branchChance','Branches',.3,[0,.15,.3,.5,.75]),choose('growth','minWidth','Door width',.8,[.8,1,1.2],' m'),choose('growth','boundaryMargin','Margin',.1,[.1,.15,.25,.4],' m'),numeric('growth','seed','Seed',42,0,999999)],
  'rooms-first':[numeric('rooms-first','roomCount','Rooms',8,2,24),numeric('rooms-first','roomsPerLayer','Rooms per layer',3,1,5),choose('rooms-first','roomSize','Room size',1.2,[1.2,1.6,2],' m'),{kind:'select',id:'rooms-first:connectionMode',label:'Connections',value:'halls',options:[{value:'halls',label:'Prefer hallways'},{value:'doors',label:'Compact doorways'},{value:'mixed',label:'Mixed'}]},choose('rooms-first','minWidth','Hall / door width',.8,[.8,1,1.2],' m'),choose('rooms-first','boundaryMargin','Margin',.1,[.1,.15,.25,.4],' m'),numeric('rooms-first','seed','Seed',42,0,999999)]
};
export const generationValues=style=>Object.fromEntries(generationSettings[style].map(item=>[item.id.split(':')[1],item.value]));
export const generationMenu=()=>({kind:'submenu',id:'generate-level',label:'Generate level',info:()=>[game()?.message||'Save a boundary, then generate rooms here.',game()?.detail||''].filter(Boolean).join('\n'),items:[
  {kind:'action',id:'generate-current',label:'Generate new rooms',info:'Use the current style and settings with a new seed, inside your saved boundary.'},
  {kind:'submenu',id:'rooms-first-style',label:'Rooms first',info:'Place rooms, then connect them. Complete room count or an explicit failure. Additional elevator layers reuse your area.',items:[...generationSettings['rooms-first'],{kind:'action',id:'generate-rooms-first',label:'Generate!'}]},
  {kind:'submenu',id:'growth-style',label:'Existing generation',info:'Grow rooms and halls outward. Pieces is a target; a short result is reported.',items:[...generationSettings.growth,{kind:'action',id:'generate-growth',label:'Generate!'}]}
]});
export function focusGeneration(component){
  const menu=component.menu;menu.reset();const index=menu.level().items.findIndex(item=>item.id==='generate-level');
  if(index>=0){menu.moveFocus(index-menu.level().index);menu.activate();}
}
const layerActions=()=>{
  const g=game(),layers=g?.level?.roomsFirst?.layers,index=layers?.findIndex(l=>l.cabinId===g.state?.activeId);
  if(!layers||index<0)return [];
  if(index===layers.length-1)return [{kind:'action',id:'ride-previous',label:'Return to previous layer'}];
  return [{kind:'action',id:'ride-next',label:'Next layer'},...(index>0?[{kind:'action',id:'ride-previous',label:'Previous layer'}]:[])];
};
registerMenuPage('impossible-watch',{
  title:'',info:()=>[game()?.message||'Reading boundary',game()?.detail||'Walk with your feet.'].join('\n'),
  onOpen:component=>document.querySelector('a-scene')?.components['boundary-floor-lab']?.focusCalibration(component),
  items:()=>[
    generationMenu(),
    {kind:'submenu',id:'boundary-calibration',label:'Calibrate area',info:()=>document.querySelector('a-scene')?.components['boundary-floor-lab']?.describe()||'',items:()=>document.querySelector('a-scene')?.components['boundary-floor-lab']?.menuItems()||[]},
    {kind:'action',id:'outline',label:'Show / hide footprint'},
    {kind:'submenu',id:'footprint-source',label:'Footprint source',info:()=>game()?.manualBoundary?'Your traced area is ready.':'Calibrate in this session to use a traced area.',items:[{kind:'action',id:'use-traced',label:'Use traced area'},{kind:'action',id:'use-headset',label:'Use headset boundary'}]},
    ...layerActions()
  ]
});
