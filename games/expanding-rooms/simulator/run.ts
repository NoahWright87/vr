// Headless overnight runner. JSONL is flushed per episode; completed runs survive
// interruption. No browser rendering, background-tab throttling or display sleep.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Episode, jobs, validateConfig, VERSION } from './model.ts';
import { failed, summarize } from './results.ts';

const args=process.argv.slice(2);
const option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')) {
  console.log('node --experimental-strip-types games/expanding-rooms/simulator/run.ts --config batch.json --out results.jsonl [--seeds 20]');
} else {
  const configFile=option('--config'),output=option('--out');
  if(!configFile||!output)throw new Error('Provide --config (exported simulator report/config) and --out (new JSONL file). Use --help.');
  if(existsSync(output))throw new Error('Output already exists. Choose a new file; existing results will not be overwritten.');
  const raw=JSON.parse(readFileSync(configFile,'utf8')),override=option('--seeds');
  const config=validateConfig({...raw.config??raw,...(override?{seeds:Number(override)}:{})});
  writeFileSync(output,JSON.stringify({type:'config',version:VERSION,config})+'\n',{flag:'wx'});
  const results:any[]=[],start=performance.now();let simulated=0;
  for(const job of jobs(config)) {
    let result;
    try{
      const episode=new Episode(job);
      try{while(!episode.outcome)episode.step();}catch(error){episode.finish('simulation-error',String(error instanceof Error?error.message:error));}
      result=episode.result();
    }
    catch(error){result=failed(job,error);}
    results.push(result);simulated+=result.seconds;
    appendFileSync(output,JSON.stringify({type:'result',result})+'\n');
    if(results.length%10===0)console.log(`${results.length} episodes; ${(simulated/((performance.now()-start)/1000)).toFixed(1)}x measured throughput`);
  }
  const elapsed=(performance.now()-start)/1000;
  const summary={type:'summary',episodes:results.length,wallSeconds:elapsed,simulatedSeconds:simulated,throughput:simulated/elapsed,groups:summarize(results)};
  appendFileSync(output,JSON.stringify(summary)+'\n');console.log(JSON.stringify(summary,null,2));
}
