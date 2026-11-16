/* Synthetic controller integration only: real welcome.install, Three camera and
 * OrbitControls math; fake DOM, renderer and splat. No browser, GPU, SPZ decode,
 * Atlas, provider, network, or real user data is exercised by this file. */
const test=require('node:test');
const assert=require('node:assert/strict');
const W=require('../welcome.js');
const BOUNDS={min:[-3.3,1.1,-8.3],max:[3.3,3.3,-2.65]};
const EXCLUSION={min:[-1.9,-.1,-6.8],max:[1.9,2.2,-4]};
const POSITIONS=[[0,1.45,-3.1],[3,1.65,-4.35],[3,1.65,-6.9],[0,1.8,-8],[-3,1.65,-7.3],[-3,1.6,-4.35],[0,1.45,-3.1],[0,3,-3.4],[0,1.45,-3.1]];
const TARGET=[0,.95,-5.1];
function syntheticScene(){return{schemaVersion:1,poster:'/assets/world/book-garden/source.png',splat:{url:'/assets/world/book-garden/synthetic-test.spz'},camera:{position:POSITIONS[0],target:TARGET,bounds:BOUNDS,exclusion:EXCLUSION,minDistance:.5,maxDistance:8},tour:{durationSeconds:54,waypoints:POSITIONS.map(position=>({position,target:TARGET}))},hotspots:[]};}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function assertSafe(p){assert.ok(p.every((n,i)=>n>=BOUNDS.min[i]-1e-9&&n<=BOUNDS.max[i]+1e-9),'camera outside bounds: '+p);assert.equal(p.every((n,i)=>n>EXCLUSION.min[i]&&n<EXCLUSION.max[i]),false,'camera entered exclusion: '+p);}
function assertNear(a,b){assert.ok(distance(a,b)<1e-8,JSON.stringify({a,b,distance:distance(a,b)}));}

class Element extends EventTarget{
  constructor(){super();this.attrs={};this.style={};this.dataset={};this.classList={add(){},remove(){}};this.parentElement=this;this.clientWidth=1280;this.clientHeight=720;this.hidden=false;this.textContent='';this.disabled=false;this.children=[];}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}replaceChildren(...c){this.children=c;}append(c){this.children.push(c);}contains(){return true;}querySelector(){return new Element();}focus(){}remove(){}closest(){return this;}
}
async function harness(){
  const THREE=await import('../assets/vendor/world/three.module.js'),{OrbitControls}=await import('../assets/vendor/world/OrbitControls.js');
  const elements=new Map(['book-garden','garden-view','garden-status','garden-poster','garden-controls','garden-explore','garden-hotspots'].map(id=>[id,new Element()]));
  const doc=new EventTarget(),win=new EventTarget();doc.defaultView=win;doc.hidden=false;doc.getElementById=id=>elements.get(id);doc.createElement=()=>new Element();win.navigator={};win.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});win.innerWidth=1280;win.innerHeight=720;
  let renderer,camera,controls,now=1000;
  class Renderer{constructor(){renderer=this;this.domElement=new Element();}setPixelRatio(){}setClearColor(){}setSize(){}setAnimationLoop(fn){this.loop=fn;}render(){}dispose(){}forceContextLoss(){}}
  class Camera extends THREE.PerspectiveCamera{constructor(...args){super(...args);camera=this;}}
  class WorldObject extends THREE.Object3D{constructor(){super();this.initialized=Promise.resolve();}dispose(){}}
  // Retain real OrbitControls update/damping mathematics; skip DOM connection.
  class SyntheticControls extends OrbitControls{constructor(cam,_canvas){super(cam);controls=this;}dispose(){}}
  const client=W.install({document:doc,fetch:async url=>url.endsWith('.json')?Response.json(syntheticScene()):new Response(new Uint8Array([1,2,3])),inspectSpz:async()=>({numPoints:1}),loadLibraries:async()=>[{...THREE,WebGLRenderer:Renderer,PerspectiveCamera:Camera},{SparkRenderer:WorldObject,SplatMesh:WorldObject},{OrbitControls:SyntheticControls}]});
  await client.explore();assert.equal(client.getState().ready,true);assert.equal(client.getState().mode,'tour');
  const tick=(ms=16)=>{now+=ms;renderer.loop?.(now);return camera.position.toArray();};tick();
  const forSeconds=(seconds,onFrame)=>{for(let i=0;i<Math.ceil(seconds*1000/16);i++){const p=tick();onFrame?.(p);}};
  function action(name){const button=new Element();button.dataset.gardenAction=name;const e=new Event('click');Object.defineProperty(e,'target',{value:button});elements.get('book-garden').dispatchEvent(e);}
  function key(name){const e=new Event('keydown');Object.defineProperty(e,'key',{value:name});renderer.domElement.dispatchEvent(e);return tick();}
  return{client,tick,forSeconds,action,key,position:()=>camera.position.toArray(),controls,renderer,elements};
}

test('synthetic route: all segments avoid conservative desk AABB, and crossed endpoints are rejected',()=>{
  const scene=W.normalizeScene(syntheticScene());
  for(let i=1;i<scene.tour.waypoints.length;i++)assert.equal(W.segmentClear(scene.tour.waypoints[i-1].position,scene.tour.waypoints[i].position,BOUNDS,EXCLUSION),true);
  for(let i=0;i<=800;i++)assertSafe(W.sampleTour(scene.tour.waypoints,i/800).position);
  const from=[-3,1.5,-5.1],to=[3,1.5,-5.1];assert.equal(W.segmentClear(from,to,BOUNDS,EXCLUSION),false);assert.deepEqual(W.constrainOrbit(to,from,BOUNDS,EXCLUSION),from);
  const crossing=syntheticScene();crossing.camera.position=from;crossing.tour.waypoints=[{position:from,target:TARGET},{position:to,target:TARGET}];assert.throws(()=>W.normalizeScene(crossing),/穿过/);
  const join=W.findTourJoin([3.2,1.5,-5.1],TARGET,scene.tour.waypoints,BOUNDS,EXCLUSION);assert.ok(join);assert.equal(W.segmentClear(join.from.position,join.to.position,BOUNDS,EXCLUSION),true);assert.ok(join.duration>=.6&&join.duration<=3);
});

test('synthetic install: home from the back side clears old inertia and remains at entrance on next frame',async t=>{
  const h=await harness();t.after(()=>h.client.dispose());h.forSeconds(22,assertSafe);assert.ok(h.position()[2]<-6,'fixture must reach rear before home');
  h.controls._sphericalDelta.theta=.6;h.controls._sphericalDelta.phi=.2;
  h.client.home();assert.equal(h.client.getState().mode,'orbit');assertNear(h.position(),POSITIONS[0]);h.tick();assertNear(h.position(),POSITIONS[0]);h.forSeconds(.5,assertSafe);assertNear(h.position(),POSITIONS[0]);
});

test('synthetic install: keyboard orbit then continue does not snap and joins via safe bounded frames',async t=>{
  const h=await harness();t.after(()=>h.client.dispose());h.forSeconds(1);h.client.pause();const onTour=h.position();for(let i=0;i<4;i++)h.key('-');const moved=h.position();assert.ok(distance(onTour,moved)>.2);
  h.action('tour');assert.equal(h.client.getState().mode,'tour');assertNear(h.tick(),moved);let previous=h.position(),maxFrameDistance=0;
  h.forSeconds(4.5,p=>{assertSafe(p);assert.equal(W.segmentClear(previous,p,BOUNDS,EXCLUSION),true);maxFrameDistance=Math.max(maxFrameDistance,distance(previous,p));previous=p;});
  assert.ok(maxFrameDistance<.1,'unexpected camera jump: '+maxFrameDistance);assert.ok(distance(h.position(),moved)>.1,'rejoin should actually advance');assert.equal(h.client.getState().mode,'tour');
});

test('synthetic install: pausing and static mode cancel an in-progress join without later camera writes',async t=>{
  const h=await harness();t.after(()=>h.client.dispose());h.forSeconds(1);h.client.pause();for(let i=0;i<4;i++)h.key('-');h.action('tour');h.tick();h.forSeconds(.16);h.client.pause();const paused=h.position();h.forSeconds(1);assertNear(h.position(),paused);assert.equal(h.client.getState().mode,'orbit');
  h.action('tour');h.tick();h.forSeconds(.16);const beforeStatic=h.position(),oldLoop=h.renderer.loop;h.client.staticMode();assert.equal(h.client.getState().mode,'static');assert.equal(h.client.getState().ready,false);assert.equal(h.renderer.loop,null);oldLoop(999999);assertNear(h.position(),beforeStatic);
});
