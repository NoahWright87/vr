import { growWing } from './grow-wing.ts';
self.onmessage=({data})=>{try{self.postMessage({level:growWing(data.level,data.from,data.to,data.seed,data.options)});}catch(error){self.postMessage({error:error.message});}};
