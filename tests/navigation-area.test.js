import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareFloor} from '../common/floor-overlap.js';
const systems={},components={};
globalThis.AFRAME={registerSystem:(n,d)=>systems[n]=d,registerComponent:(n,d)=>components[n]=d};
await import('../common/navigation-area.js');
const rect=(x)=>prepareFloor([{x,z:0},{x:x+3,z:0},{x:x+3,z:4},{x,z:4}]);
function fixture(){
  const system=Object.create(systems['navigation-areas']);system.init();
  const area=(id,x,priority=0)=>{const floor=rect(x),a={data:{enabled:true,priority},getFloor:()=>floor,getSnapshot:()=>({id,floor})};
    a.el={components:{'navigation-area':a}};system.areas.add(a);return a;};
  return{system,area};
}
test('walking between rooms selects only the containing active-area footprint',()=>{
  const {system,area}=fixture();area('first',0);area('second',4);
  assert.equal(system.getActiveArea({x:1,z:1}).id,'first');assert.equal(system.getActiveArea({x:5,z:1}).id,'second');
});
test('portal selection pins the intended room even where impossible rooms overlap',()=>{
  const {system,area}=fixture(),a=area('first',0),b=area('second',0);
  assert.equal(system.getActiveArea({x:1,z:1}).id,'first');system.setActiveArea(b.el);
  assert.equal(system.getActiveArea({x:1,z:1}).id,'second');
  b.data.enabled=false;assert.equal(system.getActiveArea({x:1,z:1}).id,'first');
  system.setActiveArea(null);assert.equal(system.getActiveArea({x:1,z:1}).id,'first');
});
test('outside-room recovery keeps the previous area rather than combining unrelated geometry',()=>{
  const {system,area}=fixture();area('room',0);area('elsewhere',10);
  system.getActiveArea({x:1,z:1});assert.equal(system.getActiveArea({x:4,z:1}).id,'room');
});
test('unknown initial position does not invent an active room',()=>{
  const {system,area}=fixture();area('room',0);
  assert.equal(system.getActiveArea({x:20,z:20}),null);
});
