const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeScene,sampleTour,segmentClear,constrainOrbit,findTourJoin,boundedBytes,install,MAX_BYTES}=require('../welcome.js');

const scene=()=>({schemaVersion:1,poster:'/assets/world/book-garden/source.png',splat:{url:'/assets/world/book-garden/world.spz'},camera:{position:[0,1,4],target:[0,1,0]},tour:{durationSeconds:40,waypoints:[{position:[0,1,4],target:[0,1,0]},{position:[2,1,3],target:[0,1,0]}]},hotspots:[{id:'library',label:'教材书院',position:[0,0,0],href:'https://evil.invalid/'}]});
test('manifest admits local source assets and real coordinates, with fixed safe learning routes',()=>{
  const value=normalizeScene(scene());assert.equal(value.splat.url,'/assets/world/book-garden/world.spz');assert.equal(value.hotspots[0].href,'/study#/textbooks');assert.deepEqual(value.camera.up,[0,1,0]);
  for(const path of ['https://evil.invalid/a.spz','/assets/world/book-garden/../secret.spz','/assets/world/book-garden/%2e%2e/a.spz','/assets/world/book-garden/a.spz?key=secret','/assets/world/book-garden/a.js']){const raw=scene();raw.splat.url=path;assert.throws(()=>normalizeScene(raw));}
  for(const patch of [{fov:120},{position:[Infinity,1,2]},{target:[0,1,4]},{minDistance:10,maxDistance:1}]){const raw=scene();Object.assign(raw.camera,patch);assert.throws(()=>normalizeScene(raw));}
  const bad=scene();bad.hotspots[0].id='arbitrary-route';assert.throws(()=>normalizeScene(bad));
});
test('guided path has exact endpoints, bounded intermediate coordinates and no hidden flight outside path',()=>{
  const path=normalizeScene(scene()).tour.waypoints;assert.deepEqual(sampleTour(path,0),path[0]);assert.deepEqual(sampleTour(path,1),path[1]);assert.deepEqual(sampleTour(path,-10),path[0]);assert.deepEqual(sampleTour(path,10),path[1]);
  for(let i=0;i<=100;i++){const point=sampleTour(path,i/100);assert.ok(point.position[0]>=0&&point.position[0]<=2);assert.ok(point.position[2]>=3&&point.position[2]<=4);assert.deepEqual(point.target,[0,1,0]);}assert.throws(()=>sampleTour(path,NaN));
});
test('manual camera remains inside the room and rejects entering the approximate desk volume',()=>{
  const bounds={min:[-3.3,1.1,-8.3],max:[3.3,3.3,-2.65]},exclusion={min:[-1.9,-.1,-6.8],max:[1.9,2.2,-4]},previous=[0,1.45,-3.1];
  assert.deepEqual(constrainOrbit([8,-10,5],previous,bounds,exclusion),[3.3,1.1,-2.65]);assert.deepEqual(constrainOrbit([0,1.5,-5.1],previous,bounds,exclusion),previous);assert.deepEqual(constrainOrbit([0,3,-5.1],previous,bounds,exclusion),previous);assert.deepEqual(constrainOrbit([0,3,-5.1],[0,3,-3.1],bounds,exclusion),[0,3,-5.1]);
  const invalid=scene();invalid.camera.bounds=bounds;assert.throws(()=>normalizeScene(invalid),/漫游区域/);invalid.camera.bounds={min:[0,0,0],max:[0,2,3]};assert.throws(()=>normalizeScene(invalid),/退化/);
});
test('whole camera segments cannot tunnel through the desk and a resumed tour joins a clear route',()=>{
  const bounds={min:[-4,1,-9],max:[4,4,-2]},exclusion={min:[-1.9,-.1,-6.8],max:[1.9,2.2,-4]},previous=[-3,1.5,-5];
  assert.equal(segmentClear(previous,[3,1.5,-5],bounds,exclusion),false);assert.deepEqual(constrainOrbit([3,1.5,-5],previous,bounds,exclusion),previous);assert.equal(segmentClear([-3,3,-5],[3,3,-5],bounds,exclusion),true);
  const path=[{position:[-3,1.5,-3],target:[0,1,-5]},{position:[-3,1.5,-8],target:[0,1,-5]},{position:[3,1.5,-8],target:[0,1,-5]},{position:[3,1.5,-3],target:[0,1,-5]}],join=findTourJoin([3.5,1.5,-5],[0,1,-5],path,bounds,exclusion);assert.ok(join);assert.deepEqual(join.from.position,[3.5,1.5,-5]);assert.equal(segmentClear(join.from.position,join.to.position,bounds,exclusion),true);assert.ok(join.to.position[0]>1.9);assert.ok(join.duration>=.6&&join.duration<=3);assert.deepEqual(sampleTour([join.from,join.to],0).position,[3.5,1.5,-5]);
  const bad=scene();Object.assign(bad.camera,{position:previous,target:[0,1,-5],bounds,exclusion});bad.tour.waypoints=[{position:previous,target:[0,1,-5]},{position:[3,1.5,-5],target:[0,1,-5]}];assert.throws(()=>normalizeScene(bad),/不能穿过/);
});
test('stream resource budget rejects advertised or actual oversized data and cancels the stream',async()=>{
  let cancelled=false;const oversized=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':String(MAX_BYTES+1)}});await assert.rejects(boundedBytes(oversized),/预算/);assert.equal(cancelled,true);
  let streamedCancel=false;const streamed=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.enqueue(new Uint8Array([4,5,6]));},cancel(){streamedCancel=true;}}));await assert.rejects(boundedBytes(streamed,{maxBytes:5}),/预算/);assert.equal(streamedCancel,true);
  const seen=[],good=await boundedBytes(new Response(new Uint8Array([1,2,3])),{maxBytes:5,onProgress:n=>seen.push(n)});assert.deepEqual([...good],[1,2,3]);assert.deepEqual(seen,[3]);await assert.rejects(boundedBytes(new Response('',{status:404})),/不可用/);
});
function fakeDocument(){
  class Element extends EventTarget{constructor(){super();this.classList={add(){},remove(){}};this.attrs={};this.hidden=false;this.disabled=false;this.textContent='';this.parentElement=this;this.dataset={};}setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key];}replaceChildren(){}contains(){return true;}querySelector(){return new Element();}focus(){}}
  const elements=new Map(['book-garden','garden-view','garden-status','garden-poster','garden-controls','garden-explore','garden-hotspots'].map(id=>[id,new Element()])),doc=new EventTarget(),win=new EventTarget();win.navigator={};win.matchMedia=()=>Object.assign(new EventTarget(),{matches:true});doc.getElementById=id=>elements.get(id);doc.defaultView=win;return{doc,elements};
}
test('missing manifest remains static and never claims a real world or imports GPU libraries',async()=>{
  const {doc,elements}=fakeDocument();let imports=0;const client=install({document:doc,fetch:async()=>new Response('',{status:404}),loadLibraries:async()=>{imports++;throw new Error('must not load');}});await client.explore();assert.equal(imports,0);assert.equal(client.getState().ready,false);assert.equal(client.getState().classification,'static-poster');assert.match(elements.get('garden-status').textContent,/尚未准备好/);client.dispose();
});
test('static cancellation and dispose invalidate delayed scene admission before GPU imports',async()=>{
  const {doc}=fakeDocument(),pending=[];let imports=0;const client=install({document:doc,fetch:()=>new Promise(resolve=>pending.push(resolve)),loadLibraries:async()=>{imports++;throw new Error('must not load');}}),started=client.explore();client.staticMode();pending.splice(0).forEach(resolve=>resolve(Response.json(scene())));await started;assert.equal(imports,0);assert.equal(client.getState().mode,'static');assert.equal(client.getState().ready,false);client.dispose();assert.equal(client.getState().ready,false);
});
test('manifest is single flight and static mode aborts its pending transfer',async()=>{
  const {doc}=fakeDocument();let requests=0,signal;
  const client=install({document:doc,fetch:(_url,options)=>{requests++;signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
  const started=client.explore();assert.equal(requests,1);client.staticMode();await started;assert.equal(signal.aborted,true);assert.equal(client.getState().loading,false);assert.equal(client.getState().ready,false);client.dispose();
});
test('manifest budget rejects its streaming body before parsing or loading GPU libraries',async()=>{
  const {doc}=fakeDocument();let cancelled=false,imports=0;
  const client=install({document:doc,fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(32001));},cancel(){cancelled=true;}})),loadLibraries:async()=>{imports++;throw Error('must not import');}});
  await client.explore();assert.equal(cancelled,true);assert.equal(imports,0);assert.equal(client.getState().hasManifest,false);client.dispose();
});
test('partially constructed renderer is released exactly once when Spark setup fails',async()=>{
  const {doc,elements}=fakeDocument();let created=0,released=0,lost=0;
  const vector={fromArray(){}};class Renderer{constructor(){created++;this.domElement=elements.get('garden-view');}setPixelRatio(){}setClearColor(){}setAnimationLoop(){}dispose(){released++;}forceContextLoss(){lost++;}}
  const THREE={WebGLRenderer:Renderer,Scene:class{},PerspectiveCamera:class{constructor(){this.position=vector;this.up=vector;}lookAt(){}}};
  const client=install({document:doc,fetch:async url=>url.endsWith('.json')?Response.json(scene()):new Response(new Uint8Array([1,2,3])),inspectSpz:async()=>({numPoints:1}),loadLibraries:async()=>[THREE,{SparkRenderer:class{constructor(){throw Error('synthetic Spark setup failure');}}},{}]});
  await client.explore();assert.equal(created,1);assert.equal(released,1);assert.equal(lost,1);assert.equal(client.getState().ready,false);client.dispose();assert.equal(released,1);
});
test('BFCache pagehide releases the world but retains a working explore action for return',async()=>{
  const {doc}=fakeDocument();let requests=0;const client=install({document:doc,fetch:async()=>{requests++;return new Response('',{status:404});}});await client.explore();assert.equal(requests,1);
  const event=new Event('pagehide');Object.defineProperty(event,'persisted',{value:true});doc.defaultView.dispatchEvent(event);await client.explore();assert.equal(requests,2);assert.equal(client.getState().classification,'static-poster');
  doc.defaultView.dispatchEvent(new Event('pagehide'));await client.explore();assert.equal(requests,2);
});
test('invalid actual SPZ header is rejected before GPU modules or renderer admission',async()=>{
  const {doc}=fakeDocument();let imports=0;const client=install({document:doc,fetch:async url=>url.endsWith('.json')?Response.json(scene()):new Response(new Uint8Array([1,2,3])),inspectSpz:require('../welcome-spz.js').inspectSpz,loadLibraries:async()=>{imports++;throw Error('must not load');}});
  await client.explore();assert.equal(imports,0);assert.equal(client.getState().ready,false);assert.equal(client.getState().classification,'static-poster');client.dispose();
});
test('locally vendored Three, controls and Spark module graphs resolve actual public exports',async()=>{
  const THREE=await import('../assets/vendor/world/three.module.js'),Orbit=await import('../assets/vendor/world/OrbitControls.js'),Spark=await import('../assets/vendor/world/spark.module.js');assert.equal(THREE.REVISION,'180');assert.equal(typeof Orbit.OrbitControls,'function');assert.equal(typeof Spark.SparkRenderer,'function');assert.equal(typeof Spark.SplatMesh,'function');
});
