import { Episode, jobs, totalJobs, validateConfig } from './model.ts';
import { failed } from './results.ts';

let iterator: ReturnType<typeof jobs>, episode: Episode|null=null, running=false, paused=false, replay=false;
let completed=0,total=0,rate=10,lastClock=0,credit=0,lastUpdate=0;
const send=(type:string,data:any={})=>postMessage({type,...data});
function tick() {
  if(!running)return;
  if(paused){lastClock=performance.now();setTimeout(tick,50);return;}
  const now=performance.now(),deadline=now+18;
  credit=rate===0?Infinity:Math.min(credit+(now-lastClock)/1000*rate,rate*.25);
  lastClock=now;
  while(running&&performance.now()<deadline&&(credit>=1/90||!episode)) {
    if(!episode) {
      const next=iterator.next();
      if(next.done){running=false;send('done',{completed,total});break;}
      try {
        episode=new Episode(next.value,replay);
        send('episode',{job:next.value,level:episode.level,boundary:episode.boundary,exit:episode.exit,exitPoint:episode.exitPoint,completed,total,snapshot:episode.snapshot()});
      } catch(error) {completed++;send('result',{result:failed(next.value,error),completed,total});continue;}
    }
    if(!episode.outcome){
      try{episode.step();}catch(error){episode.finish('simulation-error',String(error instanceof Error?error.message:error));}
      credit-=1/90;
    }
    if(episode.outcome) {
      completed++;
      send('result',{result:episode.result(),completed,total,snapshot:episode.snapshot(),
        ...(replay?{trace:episode.trace,level:episode.level,boundary:episode.boundary,exitPoint:episode.exitPoint,exit:episode.exit}:{})});
      episode=null;
    }
  }
  if(episode&&performance.now()-lastUpdate>200){lastUpdate=performance.now();send('frame',{snapshot:episode.snapshot()});}
  if(running)setTimeout(tick,rate===0?0:8);
}
self.onmessage=(event:any)=>{
  const message=event.data;
  if(message.type==='pause'){paused=!!message.value;return;}
  if(message.type==='rate'){rate=[0,1,10].includes(message.value)?message.value:10;credit=0;return;}
  if(message.type!=='start'||running)return;
  try {
    const config=validateConfig(message.config);iterator=jobs(config);total=totalJobs(config);
    replay=!!message.replay;rate=replay?0:([0,1,10].includes(message.rate)?message.rate:10);
    completed=0;paused=false;running=true;lastClock=performance.now();tick();
  } catch(error){send('error',{message:String(error instanceof Error?error.message:error)});}
};
