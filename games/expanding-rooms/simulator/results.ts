import { VERSION, type Job } from './model.ts';
export function failed(job: Job, error: unknown) {
  return {version:VERSION,job,outcome:'generation-failed',reason:String(error instanceof Error?error.message:error),seconds:0,
    stats:{physicalMetres:0,virtualMetres:0,boundaryExits:0,wallBlocks:0,rejectedGain:0,recoveries:0},
    visited:0,totalPieces:0,minClearance:null,headTurnDegrees:0,scans:0,exit:'',warning:''};
}
export function addResult(groups: Map<string,any>, r: any) {
    const key=[r.job.shape,r.job.profile,r.job.scale,r.job.gain].join(' / ');
    if(!groups.has(key))groups.set(key,{key,runs:0,completed:0,outcomes:{},physical:0,virtual:0,seconds:0,minClearance:null});
    const g=groups.get(key);g.runs++;g.completed+=r.outcome==='completed'?1:0;
    g.outcomes[r.outcome]=(g.outcomes[r.outcome]||0)+1;g.physical+=r.stats.physicalMetres;g.virtual+=r.stats.virtualMetres;g.seconds+=r.seconds;
    if(r.minClearance!==null)g.minClearance=g.minClearance===null?r.minClearance:Math.min(g.minClearance,r.minClearance);
}
export function groupRows(groups: Map<string,any>) {
  return [...groups.values()].map(g=>({...g,completionRate:g.completed/g.runs}));
}
export function summarize(results: any[]) {
  const groups=new Map<string,any>();for(const r of results)addResult(groups,r);
  return groupRows(groups);
}
