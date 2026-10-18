// Host the existing Impossible Spaces runtime in Boundary Lab's XR scene.
// No navigation, new XR session, or transfer between tracking origins.
import '../impossible-spaces/main.ts';

function mount(){
  const scene=document.querySelector('a-scene'),camera=document.querySelector('#boundary-camera');
  scene.querySelectorAll('[data-calibration-opaque]').forEach(el=>el.setAttribute('data-level-lab-prop',''));
  const world=document.createElement('a-entity');world.id='world';world.setAttribute('data-calibration-opaque','');scene.appendChild(world);
  const panel=document.createElement('a-entity');panel.id='elevator-panel';panel.setAttribute('data-calibration-opaque','');panel.setAttribute('visible',false);
  panel.innerHTML=`
    <a-plane class="elevator-surface" width="0.5" height="0.35" color="#172a41" position="0 0 -0.008"></a-plane>
    <a-plane id="ride-button" width="0.36" height="0.17" color="#3a7895"><a-text font="sourcecodepro" value="RIDE" align="center" width="1" position="0 0 0.012"></a-text></a-plane>
    <a-plane id="ride-back-button" visible="false" width="0.18" height="0.17" position="-0.11 0 0" color="#3a7895"><a-text font="sourcecodepro" value="PREV" align="center" width="0.55" position="0 0 0.012"></a-text></a-plane>
    <a-text font="sourcecodepro" id="ride-label" value="Press to change rooms" align="center" color="#d4e4f5" width="0.8" position="0 -0.12 0.01"></a-text>`;
  scene.appendChild(panel);
  const status=document.createElement('a-text');status.id='head-status';status.setAttribute('data-calibration-opaque','');
  status.setAttribute('visible',false);status.setAttribute('position','0 0.3 -1.2');status.setAttribute('align','center');status.setAttribute('width',1.5);status.setAttribute('wrap-count',36);status.setAttribute('color','#d9eeff');camera.appendChild(status);
  const host=document.createElement('a-entity');scene.appendChild(host);
  const attach=()=>host.setAttribute('impossible-game','lab: true; rig: #boundary-rig; camera: #boundary-camera; reader: #boundary-rig');
  if(host.hasLoaded)attach();else host.addEventListener('loaded',attach,{once:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
