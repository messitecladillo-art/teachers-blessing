/**
 * THE UNSEEN LIGHT / 未见之光 — original procedural cinematography.
 * All meshes, surface maps, atmospheric light and motion are authored here.
 * Conceptual image; no stock imagery, sampled footage or simulated field data.
 * Fixed seed and absolute-time evaluation make frame seeking reproducible.
 */
import * as THREE from '/vendor/three/three.module.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, x) => a + (b - a) * x;
const ease = x => x * x * (3 - 2 * x);
const v = a => new THREE.Vector3(...a);
function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Camera positions are authored, not generated. Each cut changes the dramatic
// question or scale. Intervals are half-open, including an exact music cut at 112s.
export const SHOTS = [
  { id:'01',name:'A seam in darkness',world:'eclipse',start:0,end:7,from:[.4,13,8],to:[.15,13,6.5],look:[0,13,-1],fov:38 },
  { id:'02',name:'The eclipse monument',world:'eclipse',start:7,end:15,from:[-29,16,74],to:[-18,19,69],look:[0,21,0],fov:49 },
  { id:'03',name:'Human scale',world:'eclipse',start:15,end:24,from:[12,1.5,20],to:[-7,2.3,23],look:[0,20,0],fov:62,roll:-.015 },
  { id:'04',name:'A city of answers',world:'city',start:24,end:33,from:[110,116,125],to:[68,93,90],look:[0,13,-20],fov:51 },
  { id:'05',name:'We pass a window',world:'city',start:33,end:42,from:[-6,13,91],to:[-6,13,20],look:[-5,16,-45],fov:56 },
  { id:'06',name:'The answer machine',world:'city',start:42,end:49,from:[19,7,73],to:[13,8,43],look:[0,23,-105],fov:29 },
  { id:'07',name:'One record',world:'city',start:49,end:56,from:[-33,38,42],to:[-23,31,29],look:[-15,21,14],fov:42 },
  { id:'08',name:'The archive cathedral',world:'archive',start:56,end:65,from:[0,3,49],to:[0,4,26],look:[0,12,-23],fov:65 },
  { id:'09',name:'The order of things',world:'archive',start:65,end:74,from:[-25,18,17],to:[-14,18,-16],look:[0,12,-16],fov:41 },
  { id:'10',name:'A single sheet',world:'archive',start:74,end:81,from:[3.3,14.3,-1],to:[4.5,14.3,-3.6],look:[4,14,-8],fov:35 },
  { id:'11',name:'Perfect consensus',world:'archive',start:81,end:92,from:[0,51,2],to:[0,41,-5],look:[0,0,-12],fov:55,roll:.1 },
  { id:'12',name:'The closed circle',world:'ring',start:92,end:100,from:[0,8,46],to:[0,8,35],look:[0,8,0],fov:48 },
  { id:'13',name:'Nothing outside the frame',world:'ring',start:100,end:107,from:[-25,14,22],to:[-15,18,19],look:[0,8,0],fov:42 },
  { id:'14',name:'A perfect answer',world:'ring',start:107,end:112,from:[0,8,29],to:[0,8,24],look:[0,8,0],fov:31 },
  { id:'15',name:'The reverse angle',world:'ring',start:112,end:118,from:[24,8,-8],to:[23.8,8,-7.8],look:[18,8,2.7],fov:44 },
  { id:'16',name:'Not silence. Unheard.',world:'ring',start:118,end:124,from:[20,8,9],to:[19.2,8,8],look:[19,8,2],fov:30 },
  { id:'17',name:'Returning to the window',world:'room',start:124,end:134,from:[.7,4.8,19],to:[.15,4.55,10.5],look:[-2.4,4.5,-4],fov:11 },
  { id:'18',name:'Two empty chairs',world:'room',start:134,end:143,from:[7,2.6,-.2],to:[3.4,2.5,4.5],look:[-.1,1.8,-1.1],fov:43 },
  { id:'19',name:'The warmth remaining',world:'room',start:143,end:150,from:[1.6,2.9,1.3],to:[.8,2.7,.7],look:[-.1,2,-1],fov:36 },
  { id:'20',name:'Room for another question',world:'room',start:150,end:158,from:[-3.9,2.8,-5.8],to:[-4.1,3,-6.8],look:[.4,3,8],fov:51 },
  { id:'21',name:'Open the question',world:'prism',start:158,end:166,from:[-25,7,39],to:[-13,8,29],look:[0,8,0],fov:52 },
  { id:'22',name:'A path back in',world:'prism',start:166,end:174,from:[19,8,17],to:[10,9,15],look:[6,8,0],fov:41 },
  { id:'23',name:'Difference held in light',world:'prism',start:174,end:182,from:[-12,5,19],to:[-18,8,12],look:[0,9,0],fov:48 },
  { id:'24',name:'Many ways to see',world:'prism',start:182,end:190,from:[0,39,35],to:[0,48,46],look:[0,4,0],fov:58 },
  { id:'25',name:'Q — Question',world:'workflow',start:190,end:197,from:[-37,7,23],to:[-29,6,18],look:[-27,6,0],fov:44 },
  { id:'26',name:'D — Data',world:'workflow',start:197,end:204,from:[-18,10,18],to:[-12,8,17],look:[-9,5,0],fov:43 },
  { id:'27',name:'I — Insight',world:'workflow',start:204,end:211,from:[1,6,18],to:[6,7,16],look:[9,6,0],fov:44 },
  { id:'28',name:'A — Action',world:'workflow',start:211,end:218,from:[20,6,19],to:[30,8,19],look:[29,4,-3],fov:48 },
  { id:'29',name:'The city, again',world:'dawn',start:218,end:225,from:[64,81,114],to:[57,76,101],look:[0,13,-17],fov:55 },
  { id:'30',name:'The window remains warm',world:'dawn',start:225,end:232,from:[-30,27,46],to:[-24,24,35],look:[-15,21,14],fov:44 },
  { id:'31',name:'Let every question arrive',world:'dawn',start:232,end:240,from:[-2,50,121],to:[-2,55,135],look:[0,17,-30],fov:52 }
];

export function createFilmScene(canvas, { width=1920, height=1080 }={}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false, preserveDrawingBuffer:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(width,height,false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const camera = new THREE.PerspectiveCamera(48,width/height,.08,1400);
  const disposable = new Set();
  const keep = x => (disposable.add(x),x);
  const boxGeo = keep(new THREE.BoxGeometry(1,1,1));
  const sphereGeo = keep(new THREE.SphereGeometry(1,32,20));
  const pointGeo = keep(new THREE.SphereGeometry(1,8,6));
  const planeGeo = keep(new THREE.PlaneGeometry(1,1));
  const metal = keep(new THREE.MeshStandardMaterial({color:0x142737,metalness:.7,roughness:.32}));
  const obsidian = keep(new THREE.MeshStandardMaterial({color:0x08121c,metalness:.52,roughness:.43}));
  const ivory = keep(new THREE.MeshStandardMaterial({color:0xb8c4c7,roughness:.8,metalness:.08}));
  const teal = keep(new THREE.MeshBasicMaterial({color:0x58e7d5,toneMapped:false}));
  const white = keep(new THREE.MeshBasicMaterial({color:0xcbe9f2,toneMapped:false}));
  const gold = keep(new THREE.MeshBasicMaterial({color:0xffc578,toneMapped:false}));
  const mutedGold = keep(new THREE.MeshStandardMaterial({color:0x856441,metalness:.65,roughness:.4}));
  const dummy = new THREE.Object3D();
  function mesh(g,m,parent,pos=[0,0,0],scale=[1,1,1]) { const a=new THREE.Mesh(g,m); a.position.set(...pos);a.scale.set(...scale);parent.add(a); return a; }
  const box = (p,m,pos,scale) => mesh(boxGeo,m,p,pos,scale);
  const sphere = (p,m,pos,scale=1) => mesh(sphereGeo,m,p,pos,[scale,scale,scale]);
  function beam(parent,a,b,r,mat) { const d=v(b).sub(v(a)); const g=keep(new THREE.CylinderGeometry(r,r,d.length(),8,1,true)); const ob=mesh(g,mat,parent);ob.position.copy(v(a).add(v(b)).multiplyScalar(.5));ob.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return ob; }
  function line(parent,points,color=0x61bdb8,opacity=.5) { const g=keep(new THREE.BufferGeometry().setFromPoints(points.map(v))); const m=keep(new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false})); const l=new THREE.Line(g,m);parent.add(l);return l; }
  // Original image-based lighting, made from six painted radiance fields. The
  // PMREM convolution provides broad physical reflections without stock HDRIs.
  const environmentFaces=[];
  for(let face=0;face<6;face++){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');const g=ctx.createLinearGradient(0,0,0,256);g.addColorStop(0,'#6d8799');g.addColorStop(.48,'#24313b');g.addColorStop(1,'#070b10');ctx.fillStyle=g;ctx.fillRect(0,0,256,256);if(face===2){ctx.fillStyle='#86999d';ctx.fillRect(0,0,256,256);}if(face===3){ctx.fillStyle='#05090c';ctx.fillRect(0,0,256,256);}if(face===0||face===4){const l=ctx.createRadialGradient(140,74,2,140,74,89);l.addColorStop(0,'rgba(241,226,198,.93)');l.addColorStop(.4,'rgba(188,196,191,.5)');l.addColorStop(1,'rgba(24,37,45,0)');ctx.fillStyle=l;ctx.fillRect(0,0,256,256);}environmentFaces.push(c);}
  const environmentCube=keep(new THREE.CubeTexture(environmentFaces));environmentCube.colorSpace=THREE.SRGBColorSpace;environmentCube.needsUpdate=true;
  const pmrem=new THREE.PMREMGenerator(renderer);const environmentTarget=keep(pmrem.fromCubemap(environmentCube));pmrem.dispose();
  function world(bg=0x020810,fog=.003) { const s=new THREE.Scene();s.background=new THREE.Color(bg);s.fog=new THREE.FogExp2(bg,fog);s.environment=environmentTarget.texture;s.environmentIntensity=.42;const hemi=new THREE.HemisphereLight(0xaed5eb,0x111720,.72);s.add(hemi);const key=new THREE.DirectionalLight(0xb8d2ee,3.3);key.position.set(-35,70,30);key.castShadow=true;key.shadow.mapSize.set(1536,1536);Object.assign(key.shadow.camera,{left:-65,right:65,top:65,bottom:-65,near:.5,far:350});key.shadow.bias=-.00015;key.shadow.normalBias=.045;key.shadow.radius=2.5;s.add(key);const rim=new THREE.DirectionalLight(0x166e76,1.3);rim.position.set(40,18,-45);s.add(rim);return {scene:s,hemi,key,rim,update:()=>{}}; }
  function noiseTexture(kind='concrete') { const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');const im=ctx.createImageData(512,512),r=rng(811);for(let y=0;y<512;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4;const cloud=Math.sin(x*.047+Math.sin(y*.018))*Math.cos(y*.033)*9;let n=142+(r()-.5)*25+cloud;if(kind==='wood'){const grain=Math.sin(x*.2+Math.sin(y*.023)*2+Math.sin(y*.081)*.4);n=119+grain*15+Math.sin(x*.043+y*.002)*18+(r()-.5)*12;im.data[i]=n;im.data[i+1]=n*.77;im.data[i+2]=n*.55;}else {if(y%128<2||x%256<2)n*=.69;im.data[i]=n;im.data[i+1]=n;im.data[i+2]=n;}im.data[i+3]=255;}ctx.putImageData(im,0,0);const t=keep(new THREE.CanvasTexture(c));t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='wood'?1:2,kind==='wood'?1:4);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t; }
  const concreteMap=noiseTexture();
  const concrete = keep(new THREE.MeshStandardMaterial({color:0x9babae,map:concreteMap,roughness:.91,metalness:.06,bumpMap:concreteMap,bumpScale:.055}));
  function stars(parent,count=2200,spread=450) { const r=rng(707),p=new Float32Array(count*3),c=new Float32Array(count*3);for(let i=0;i<count;i++){const a=r()*TAU,y=.05+r()*.94,rad=spread*(.8+.2*r()),rr=Math.sqrt(1-y*y)*rad;p.set([Math.cos(a)*rr,y*rad,Math.sin(a)*rr],i*3);const b=.4+r()*.6;c.set([b*.71,b*.83,b],i*3);}const g=keep(new THREE.BufferGeometry());g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('color',new THREE.BufferAttribute(c,3));const m=keep(new THREE.PointsMaterial({size:.44,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:.83,depthWrite:false,toneMapped:false}));const a=new THREE.Points(g,m);parent.add(a);return a; }
  function dust(parent,{count=480,spread=40,height=30,color=0xb7dbdd,size=.055,seed=21}={}) {const r=rng(seed),arr=new Float32Array(count*3);for(let i=0;i<count;i++)arr.set([(r()-.5)*spread,r()*height,(r()-.5)*spread],i*3);const geo=keep(new THREE.BufferGeometry());geo.setAttribute('position',new THREE.BufferAttribute(arr,3));const mat=keep(new THREE.PointsMaterial({color,size,transparent:true,opacity:.45,depthWrite:false,blending:THREE.AdditiveBlending}));const obj=new THREE.Points(geo,mat);parent.add(obj);return obj; }
  function glow(parent,pos,color=0x75dcdf,size=5,opacity=.25) { const material=keep(new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{color:{value:new THREE.Color(color)},opacity:{value:opacity}},vertexShader:'varying vec2 q; void main(){q=uv*2.-1.; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 q; uniform vec3 color;uniform float opacity;void main(){float a=exp(-dot(q,q)*5.);gl_FragColor=vec4(color,a*opacity);}'}));const a=mesh(planeGeo,material,parent,pos,[size,size,1]);a.userData.billboard=true;return a; }
  const floorMap=noiseTexture();floorMap.repeat.set(80,80);
  const groundMat=keep(new THREE.MeshStandardMaterial({color:0x17232b,roughness:.33,metalness:.56,map:floorMap,bumpMap:floorMap,bumpScale:.016,transparent:true,opacity:.93,depthWrite:true}));
  function ground(parent,size=600,mat=groundMat) {const a=mesh(planeGeo,mat,parent,[0,-.035,0],[size,size,1]);a.rotation.x=-PI/2;a.renderOrder=6;return a; }
  function lightShaft(parent,a,b,width,color=0x77d5d3,opacity=.035) {const mat=keep(new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));const delta=v(b).sub(v(a));const geo=keep(new THREE.CylinderGeometry(.04,width,delta.length(),40,1,true));const ob=mesh(geo,mat,parent);ob.position.copy(v(a).add(v(b)).multiplyScalar(.5));ob.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v(a).sub(v(b)).normalize());return ob; }

  // I. A window-sized seam breaks a monument that appears larger than a world.
  const eclipse=world(0x01040a,.0035);stars(eclipse.scene,2600);
  const eclipseRoot=new THREE.Group();eclipse.scene.add(eclipseRoot);
  box(eclipseRoot,concrete,[-8,21,0],[15.5,42,8]);box(eclipseRoot,concrete,[8,21,0],[15.5,42,8]);
  box(eclipseRoot,gold,[0,21,-3.8],[.32,41.9,.12]);
  box(eclipseRoot,obsidian,[0,.7,0],[46,1.4,35]);
  for(let i=0;i<9;i++)box(eclipseRoot,metal,[0,.1+i*.08,12+i*1.6],[32+i*1.9,.12,1.55]);
  const eclipseSun=sphere(eclipse.scene,keep(new THREE.MeshBasicMaterial({color:0xe3caa1,toneMapped:false})),[0,66,-54],19.2);
  sphere(eclipse.scene,keep(new THREE.MeshBasicMaterial({color:0x01040a})),[.5,66,-50.5],18.8);
  const halo=glow(eclipse.scene,[0,66,-55],0xb8d8e9,115,.23);
  const slitGlow=glow(eclipse.scene,[0,20,4.2],0xffc57a,24,.13);
  const es=new THREE.PointLight(0xffb653,90,65,2);es.position.set(0,16,8);eclipse.scene.add(es);
  ground(eclipse.scene);const eDust=dust(eclipse.scene,{count:420,spread:60,height:55,size:.055});
  eclipse.update=t=>{eDust.position.y=Math.sin(t*.03)*.8;halo.quaternion.copy(camera.quaternion);slitGlow.quaternion.copy(camera.quaternion);};

  // II / VIII. One procedural city is revisited at dawn, preserving its geography.
  const city=world(0x040b15,.0046);
  const cityStars=stars(city.scene,1800,650);
  function facadeTexture(emission=false) {const c=document.createElement('canvas');c.width=128;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle=emission?'#000000':'#344352';ctx.fillRect(0,0,128,256);const r=rng(45);for(let row=0;row<24;row++)for(let col=0;col<9;col++){const lit=r()>.57;ctx.fillStyle=emission?(lit?'#84bbbf':'#000000'):(lit?'#bdd1d4':'#101d2b');ctx.fillRect(col*14+4,row*10+5,5,3);ctx.fillStyle=emission?'#000000':'#263542';ctx.fillRect(col*14,row*10,1,10);}const t=keep(new THREE.CanvasTexture(c));t.colorSpace=THREE.SRGBColorSpace;t.magFilter=THREE.LinearFilter;t.anisotropy=4;return t;}
  const facade=facadeTexture(),emission=facadeTexture(true);
  const buildingMat=keep(new THREE.MeshStandardMaterial({color:0xb7c4d3,map:facade,emissiveMap:emission,emissive:0x73b5bd,emissiveIntensity:.62,roughness:.58,metalness:.36}));
  const topMat=keep(new THREE.MeshStandardMaterial({color:0x172634,roughness:.82,metalness:.4}));
  const buildings=[],random=rng(3705);
  for(let x=-11;x<=11;x++)for(let z=-15;z<=7;z++){if(Math.abs(x)<1.25)continue;if(x===-1&&z===1)continue;const bx=x*15+(random()-.5)*4,bz=z*17+(random()-.5)*4;const height=9+Math.pow(random(),1.5)*74;buildings.push({x:bx,z:bz,h:height,w:6+random()*6,d:7+random()*7});}
  const blocks=new THREE.InstancedMesh(boxGeo,[buildingMat,buildingMat,topMat,topMat,buildingMat,buildingMat],buildings.length);city.scene.add(blocks);
  const roofCaps=new THREE.InstancedMesh(boxGeo,metal,buildings.length);city.scene.add(roofCaps);
  const mirrorMat=keep(new THREE.MeshBasicMaterial({map:emission,color:0x365e68,transparent:true,opacity:.48}));
  const mirror=new THREE.InstancedMesh(boxGeo,mirrorMat,buildings.length);mirror.renderOrder=1;city.scene.add(mirror);
  buildings.forEach((b,i)=>{dummy.position.set(b.x,b.h/2,b.z);dummy.scale.set(b.w,b.h,b.d);dummy.updateMatrix();blocks.setMatrixAt(i,dummy.matrix);blocks.setColorAt(i,new THREE.Color().setHSL(.57,.12,.63+random()*.25));dummy.position.y=b.h+.2;dummy.scale.set(b.w+.12,.4,b.d+.12);dummy.updateMatrix();roofCaps.setMatrixAt(i,dummy.matrix);dummy.position.set(b.x,-b.h/2,b.z);dummy.scale.set(b.w,b.h,b.d);dummy.updateMatrix();mirror.setMatrixAt(i,dummy.matrix);});
  ground(city.scene);const streets=new THREE.Group();city.scene.add(streets);
  for(let i=-15;i<8;i++){box(streets,teal,[0,.045,i*17],[.035,.04,13]);box(streets,white,[-7.7,.05,i*17],[.025,.035,11]);box(streets,white,[7.7,.05,i*17],[.025,.035,11]);}
  const lamps=new THREE.InstancedMesh(boxGeo,white,100);city.scene.add(lamps);for(let i=0;i<100;i++){dummy.position.set(i%2?-7.5:7.5,.45,Math.floor(i/2)*7-240);dummy.scale.set(.1,.1,1.5);dummy.updateMatrix();lamps.setMatrixAt(i,dummy.matrix);}
  // The sole large amber window is visible from both city visits, not a new prop.
  box(city.scene,concrete,[-18,17,10],[9,34,8]);
  const cityWindow=box(city.scene,gold,[-18,21,14.035],[5.6,3.6,.045]);
  box(city.scene,metal,[-18,21,14.11],[.096,3.64,.128]);box(city.scene,metal,[-18,21.28,14.12],[5.6,.072,.128]);
  const windowGlow=glow(city.scene,[-18,21,14.13],0xffb962,10,.12);windowGlow.material.depthTest=false;windowGlow.renderOrder=12;
  const windowLamp=new THREE.PointLight(0xffb66b,35,24,2);windowLamp.position.set(-18,21,18);city.scene.add(windowLamp);
  const skyMat=keep(new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{dawn:{value:0}},vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 p;uniform float dawn;void main(){vec3 d=normalize(p);float h=max(d.y,0.);vec3 night=mix(vec3(.017,.028,.047),vec3(.001,.004,.012),pow(h,.45));vec3 morning=mix(vec3(.36,.23,.16),vec3(.025,.071,.118),pow(h,.45));vec3 col=mix(night,morning,dawn);float sun=pow(max(dot(d,normalize(vec3(.2,.13,-1.))),0.),160.);col+=vec3(.94,.48,.15)*sun*dawn;gl_FragColor=vec4(col,1.);}` }));mesh(keep(new THREE.SphereGeometry(1000,32,16)),skyMat,city.scene).renderOrder=-10;
  const sunGlow=glow(city.scene,[45,26,-260],0xffbc72,96,.55);sunGlow.visible=false;
  const cityDust=dust(city.scene,{count:600,spread:180,height:110,size:.07});
  const traffic=new THREE.InstancedMesh(boxGeo,gold,34);city.scene.add(traffic);
  Object.assign(city.key.shadow.camera,{left:-160,right:160,top:160,bottom:-160,far:600});city.key.shadow.mapSize.set(2048,2048);
  const roofDetails=new THREE.InstancedMesh(boxGeo,topMat,buildings.length*2);city.scene.add(roofDetails);buildings.forEach((b,i)=>{for(let j=0;j<2;j++){dummy.position.set(b.x+(j-.5)*b.w*.35,b.h+.55,b.z);dummy.scale.set(b.w*.21,.6,b.d*.34);dummy.rotation.set(0,0,0);dummy.updateMatrix();roofDetails.setMatrixAt(i*2+j,dummy.matrix);}});
  city.update=(t,isDawn=false)=>{const dawn=isDawn?mix(.52,.83,clamp((t-218)/22)):0;skyMat.uniforms.dawn.value=dawn;city.hemi.intensity=isDawn?1.15:.55;city.key.color.set(isDawn?0xffc98e:0xb8d2ee);city.key.intensity=isDawn?3.7:2.5;city.key.position.set(isDawn?45:-35,isDawn?16:70,-80);city.scene.fog.color.set(isDawn?0x303c49:0x040b15);city.scene.fog.density=isDawn?.0038:.0046;buildingMat.emissiveIntensity=isDawn?.28:.62;cityStars.material.opacity=isDawn?.12:.83;sunGlow.visible=isDawn;sunGlow.quaternion.copy(camera.quaternion);windowGlow.quaternion.copy(camera.quaternion);cityDust.position.y=Math.sin(t*.02)*2;for(let i=0;i<34;i++){const z=((i*37+t*(i%2?3:-2))%400+400)%400-260;dummy.position.set(i%2?-3:3,.32,z);dummy.scale.set(.12,.07,1.6);dummy.updateMatrix();traffic.setMatrixAt(i,dummy.matrix);}traffic.instanceMatrix.needsUpdate=true;};

  // III. A colossal physical archive: repeated forms feel authoritative; the
  // distant gap is more important than all its bright, perfectly aligned rows.
  const archive=world(0x07101b,.011);archive.hemi.intensity=1.1;archive.key.intensity=3.8;
  ground(archive.scene,250);
  const archiveColumns=new THREE.InstancedMesh(boxGeo,concrete,48);archive.scene.add(archiveColumns);
  for(let i=0;i<48;i++){let row=Math.floor(i/4),col=i%4;dummy.position.set([-24,-15,15,24][col],19,33-row*8.5);dummy.scale.set(col===0||col===3?2.3:1.3,38,2);dummy.updateMatrix();archiveColumns.setMatrixAt(i,dummy.matrix);}
  for(let i=0;i<12;i++){box(archive.scene,metal,[0,37,33-i*8.5],[51,1.1,1.6]);box(archive.scene,white,[0,36.42,33-i*8.5],[12,.06,.08]);}
  for(let side of [-1,1]){box(archive.scene,concrete,[side*27,18,-12],[1.2,36,106]);box(archive.scene,metal,[side*26,5,-12],[2,.5,106]);}
  const sheetMat=keep(new THREE.MeshStandardMaterial({color:0x93b4be,emissive:0x235764,emissiveIntensity:.52,roughness:.64,metalness:.1,side:THREE.DoubleSide}));
  const sheets=new THREE.InstancedMesh(boxGeo,sheetMat,384);archive.scene.add(sheets);
  const bars=new THREE.InstancedMesh(boxGeo,teal,384);archive.scene.add(bars);
  const sheetBases=[];for(let i=0;i<384;i++){const side=i<192?-1:1,k=i%192,col=k%8,row=Math.floor(k/8)%8,depth=Math.floor(k/64);const p=[side*(5.3+depth*2.7),5+row*3.3,25-col*10];sheetBases.push(p);}
  const shelfDust=dust(archive.scene,{count:700,spread:55,height:34,size:.045});
  const archiveOrb=sphere(archive.scene,teal,[0,13,-35],1.15);glow(archive.scene,[0,13,-35],0x50cbc5,22,.18);
  for(let i=0;i<6;i++)lightShaft(archive.scene,[i%2?-14:14,37,18-i*12],[i%2?5:-5,0,14-i*12],5,0x9dbfc3,.025);
  const page=new THREE.Group();archive.scene.add(page);page.position.set(4,14,-8);
  box(page,ivory,[0,0,0],[2.4,3.4,.035]);for(let i=0;i<14;i++)box(page,metal,[-.15+i%3*.02,1.1-i*.17,.025],[1.65-i%4*.23,.029,.015]);box(page,teal,[-.8,1.42,.025],[.26,.14,.015]);
  archive.update=t=>{const amount=clamp((t-81)/11);sheetBases.forEach((p,i)=>{dummy.position.set(p[0]*(1-amount*.3),p[1],p[2]);dummy.rotation.set(0,Math.sin(i*.37+(t-56)*.11)*.06,0);dummy.scale.set(1.75,2.55,.075);dummy.updateMatrix();sheets.setMatrixAt(i,dummy.matrix);dummy.position.y+=.9;dummy.position.z+=.07;dummy.scale.set(1.2,.045,.012);dummy.updateMatrix();bars.setMatrixAt(i,dummy.matrix);});sheets.instanceMatrix.needsUpdate=true;bars.instanceMatrix.needsUpdate=true;shelfDust.position.y=Math.sin(t*.04);archiveOrb.scale.setScalar(1.15+amount*.7);};

  // IV. A closed acceptance rule. The excluded amber point is beyond its edge.
  const ring=world(0x030910,.0055);ground(ring.scene,250).position.y=-4.45;
  const ringFrame=new THREE.Group();ring.scene.add(ringFrame);ringFrame.position.y=8;
  const closedRing=mesh(keep(new THREE.TorusGeometry(12,.38,16,180)),metal,ringFrame);
  const ringTeal=keep(teal.clone());
  const ringRim=mesh(keep(new THREE.TorusGeometry(11.53,.045,8,180)),ringTeal,ringFrame,[0,0,.12]);
  const ringPlate=mesh(keep(new THREE.CircleGeometry(11.4,128)),keep(new THREE.MeshStandardMaterial({color:0x081c29,metalness:.68,roughness:.34,side:THREE.DoubleSide})),ringFrame,[0,0,-.4]);
  const acceptedPoints=new THREE.InstancedMesh(pointGeo,teal,240);ringFrame.add(acceptedPoints);
  const records=[];const rr=rng(719);for(let i=0;i<240;i++){const a=rr()*TAU,r=Math.sqrt(rr())*10.8;records.push([Math.cos(a)*r,Math.sin(a)*r,rr()*.6]);}
  const gridLines=new THREE.Group();ringFrame.add(gridLines);for(let i=-10;i<=10;i+=2){const half=Math.sqrt(11.1*11.1-i*i);line(gridLines,[[i,-half,.02],[i,half,.02]],0x315d67,.45);line(gridLines,[[-half,i,.02],[half,i,.02]],0x315d67,.45);}
  const rejected=sphere(ring.scene,gold,[19,8,2],.23),rejectedGlow=glow(ring.scene,[19,8,2],0xffb962,3,.52);
  const perfect=sphere(ringFrame,white,[0,0,.5],.34);const perfectGlow=glow(ringFrame,[0,0,1],0x9ce0e2,7,.12);
  box(ring.scene,obsidian,[0,-4.2,0],[32,.4,13]);
  line(ring.scene,[[12.3,8,2],[16.6,8,2]],0x74583c,.35);
  ring.update=t=>{const convergence=ease(clamp((t-100)/12));records.forEach((p,i)=>{const factor=mix(1,.12,convergence);dummy.position.set(p[0]*factor,p[1]*factor,p[2]+.14);dummy.scale.setScalar(.042);dummy.rotation.set(0,0,0);dummy.updateMatrix();acceptedPoints.setMatrixAt(i,dummy.matrix);});acceptedPoints.instanceMatrix.needsUpdate=true;rejectedGlow.quaternion.copy(camera.quaternion);perfectGlow.quaternion.copy(camera.quaternion);ringRim.material.color.set(t>=112?0x5b9da3:0x58e7d5);perfect.scale.setScalar(t>=112?.1:.34+convergence*.24);};

  // V. The film stops rushing. Two chairs, one cup and the same amber window.
  const room=world(0x080c10,.009);room.hemi.intensity=.38;room.key.intensity=.48;room.key.castShadow=false;room.rim.color.setHex(0xeba45a);room.rim.intensity=.85;room.scene.environmentIntensity=.22;
  const plaster=keep(new THREE.MeshStandardMaterial({color:0x928b7d,map:concreteMap,roughness:.96,bumpMap:concrete.bumpMap,bumpScale:.025}));
  const woodMap=noiseTexture('wood');
  const wood=keep(new THREE.MeshStandardMaterial({color:0xab8260,map:woodMap,roughness:.48,metalness:.02,bumpMap:woodMap,bumpScale:.018}));
  box(room.scene,wood,[0,-.18,0],[16,.35,17]);box(room.scene,plaster,[-8,4,0],[.4,8,17]);box(room.scene,plaster,[8,4,0],[.4,8,17]);box(room.scene,plaster,[0,4,-8],[16,8,.35]);
  box(room.scene,plaster,[-5.75,4,8],[4.5,8,.5]);box(room.scene,plaster,[5.75,4,8],[4.5,8,.5]);box(room.scene,plaster,[0,.65,8],[7,1.3,.5]);box(room.scene,plaster,[0,6.9,8],[7,2.2,.5]);
  for(const x of [-3.5,0,3.5])box(room.scene,metal,[x,3.55,8.02],[.12,4.55,.16]);box(room.scene,metal,[0,3.85,8.02],[7,.09,.16]);
  const windowGlass=keep(new THREE.MeshPhysicalMaterial({color:0xc6ba9c,roughness:.15,metalness:.08,transparent:true,opacity:.045,side:THREE.DoubleSide}));box(room.scene,windowGlass,[0,3.5,8],[7,4.5,.035]);
  box(room.scene,wood,[0,1.86,-1.2],[4.1,.22,2.4]);for(let x of [-1.65,1.65])for(let z of [-2.1,-.3])box(room.scene,wood,[x,.9,z],[.12,1.8,.12]);
  function chair(x,z,ry=0){const g=new THREE.Group();room.scene.add(g);g.position.set(x,0,z);g.rotation.y=ry;box(g,wood,[0,1.04,0],[1.22,.15,1.2]);box(g,wood,[0,1.86,-.53],[1.2,1.6,.13]);for(let a of [-.49,.49])for(let b of [-.46,.46])box(g,wood,[a,.5,b],[.09,1,.09]);return g;}
  chair(-2.45,-1,PI/2);chair(2.45,-1,-PI/2);
  const cup=mesh(keep(new THREE.CylinderGeometry(.23,.19,.35,48)),ivory,room.scene,[.05,2.14,-1.1]);mesh(keep(new THREE.TorusGeometry(.19,.035,10,32)),ivory,room.scene,[.27,2.17,-1.1]).rotation.y=PI/2;
  const cupSurface=mesh(keep(new THREE.CircleGeometry(.205,40)),keep(new THREE.MeshStandardMaterial({color:0x191411,roughness:.1})),room.scene,[.05,2.318,-1.1]);cupSurface.rotation.x=-PI/2;
  box(room.scene,ivory,[-.9,1.99,-1.3],[.85,.025,1.25]).rotation.y=.15;
  for(let i=0;i<6;i++)box(room.scene,metal,[-.9,2.006,-1.7+i*.13],[.57,.005,.012]);
  box(room.scene,mutedGold,[-2.7,.12,-4],[.8,.2,.8]);beam(room.scene,[-2.7,.1,-4],[-2.7,4.5,-4],.04,mutedGold);
  mesh(keep(new THREE.ConeGeometry(.65,.65,48,1,true)),keep(new THREE.MeshStandardMaterial({color:0x7d6550,side:THREE.DoubleSide,roughness:.71})),room.scene,[-2.7,4.5,-4]);sphere(room.scene,gold,[-2.7,4.23,-4],.11);
  const lamp=new THREE.PointLight(0xffbd78,16,24,2);lamp.position.set(-2.7,4.1,-4);room.scene.add(lamp);
  const practical=new THREE.SpotLight(0xffd3a0,88,28,.98,.6,2);practical.position.set(-2.7,4.13,-4);practical.target.position.set(.5,.5,0);practical.castShadow=true;practical.shadow.mapSize.set(1536,1536);practical.shadow.bias=-.00005;practical.shadow.normalBias=.009;practical.shadow.radius=2.2;room.scene.add(practical,practical.target);
  // Floorboards and joinery create scale cues while leaving the room uncluttered.
  for(let i=-9;i<=9;i++)box(room.scene,wood,[(i+.5)*.82,.006,0],[.008,.009,16]);
  for(let y of [.14,7.7]){box(room.scene,wood,[0,y,-7.78],[15.8,.12,.08]);box(room.scene,wood,[-7.78,y,0],[.08,.12,16]);box(room.scene,wood,[7.78,y,0],[.08,.12,16]);}
  // No mesh cone inside this small room: the real practical and its shadow
  // map carry the light, avoiding a theatrical triangle through the plaster.
  const roomDust=dust(room.scene,{count:240,spread:15,height:7,size:.018,color:0xffdbb0});
  const steamMat=keep(new THREE.PointsMaterial({color:0xf2d0a0,size:.018,transparent:true,opacity:.28,depthWrite:false}));const steamGeo=keep(new THREE.BufferGeometry());const steamArr=new Float32Array(60*3);steamGeo.setAttribute('position',new THREE.BufferAttribute(steamArr,3));const steam=new THREE.Points(steamGeo,steamMat);room.scene.add(steam);
  const roomBackdrop=new THREE.Group();room.scene.add(roomBackdrop);for(let i=0;i<20;i++){const r=rng(50+i);box(roomBackdrop,metal,[(r()-.5)*60,8+r()*17,34+r()*22],[2+r()*6,15+r()*25,2]);for(let j=0;j<7;j++)box(roomBackdrop,j===2&&i%3===0?gold:teal,[(i-10)*3,3+j*2,31+i%3*2],[.17,.3,.06]);}
  room.update=t=>{roomDust.position.y=Math.sin(t*.04)*.3;for(let i=0;i<60;i++){const p=((i/60+(t-124)*.09)%1+1)%1;steamArr[i*3]=.05+Math.sin(i*2.32+p*6)*.06+p*.06;steamArr[i*3+1]=2.34+p*.64;steamArr[i*3+2]=-1.1+Math.cos(i*1.34+p*5)*.065;}steamGeo.attributes.position.needsUpdate=true;};

  // VI. The acceptance rule physically opens. Amber enters, remains amber;
  // the prism reveals plural paths instead of dissolving everything into teal.
  const prism=world(0x07131d,.0047);ground(prism.scene,400).position.y=-4.45;prism.hemi.intensity=1.65;prism.key.intensity=3.5;
  const prismRoot=new THREE.Group();prism.scene.add(prismRoot);prismRoot.position.y=8;
  const openArc=mesh(keep(new THREE.TorusGeometry(12,.36,16,160,TAU-PI*.24)),metal,prismRoot);openArc.rotation.z=PI*.12;
  const openEdge=mesh(keep(new THREE.TorusGeometry(11.54,.05,8,160,TAU-PI*.24)),teal,prismRoot,[0,0,.12]);openEdge.rotation.z=PI*.12;
  const door=mesh(keep(new THREE.TorusGeometry(12,.36,16,22,PI*.24)),metal,prismRoot);door.rotation.z=-PI*.12;
  const prismMat=keep(new THREE.MeshPhysicalMaterial({color:0xa3dad5,metalness:.45,roughness:.11,transparent:true,opacity:.74,side:THREE.DoubleSide,clearcoat:1,clearcoatRoughness:.12}));
  const diamond=mesh(keep(new THREE.OctahedronGeometry(4.1,0)),prismMat,prismRoot,[0,0,0],[.74,1.6,.74]);
  const wire=mesh(keep(new THREE.OctahedronGeometry(4.13,0)),keep(new THREE.MeshBasicMaterial({color:0x9af0d8,wireframe:true,transparent:true,opacity:.5})),prismRoot,[0,0,0],[.74,1.6,.74]);
  const warmTraveler=sphere(prism.scene,gold,[19,8,2],.23),warmTravelerGlow=glow(prism.scene,[19,8,2],0xffbf79,3,.45);
  const prismPaths=new THREE.Group();prism.scene.add(prismPaths);
  const pathEnds=[];for(let i=0;i<18;i++){const a=(i/18)*TAU;const radius=22+(i%4)*8;const end=[Math.cos(a)*radius,.15,Math.sin(a)*radius];pathEnds.push(end);line(prismPaths,[[0,8,0],[end[0]*.35,4,end[2]*.35],end],i%4===0?0xe1a55f:0x4a9e9d,.57);box(prism.scene,metal,[end[0],.07,end[2]],[4,.14,4]);sphere(prism.scene,i%4===0?gold:teal,[end[0],.27,end[2]],.16);lightShaft(prism.scene,[0,8,0],end,1.5,i%4===0?0xefb879:0x59bcb9,.018);}
  for(let i=0;i<10;i++){const a=i/10*TAU;box(prism.scene,concrete,[Math.cos(a)*42,15,Math.sin(a)*42],[2,30,2]);}
  const prismDust=dust(prism.scene,{count:650,spread:85,height:36,size:.05});
  const pulse=sphere(prism.scene,white,[0,8,0],.32);
  prism.update=t=>{const opening=ease(clamp((t-158)/8));door.position.set(opening*4,0,opening*4);door.rotation.y=-opening*.78;door.rotation.z=-PI*.12;diamond.rotation.y=(t-158)*.045;wire.rotation.y=diamond.rotation.y;const p=ease(clamp((t-166)/10));warmTraveler.position.set(mix(19,2,p),8+Math.sin(p*PI)*.45,mix(2,.5,p));warmTravelerGlow.position.copy(warmTraveler.position);warmTravelerGlow.quaternion.copy(camera.quaternion);prismPaths.scale.setScalar(mix(.05,1,ease(clamp((t-172)/10))));prismDust.position.y=Math.sin(t*.035);pulse.scale.setScalar(.22+clamp((t-174)/16)*.2);};

  // VII. Four physical stations, a single directional walk. Q -> D -> I -> A.
  const workflow=world(0x081420,.006);ground(workflow.scene,400);workflow.key.intensity=4.3;workflow.hemi.intensity=1.45;
  const qArc=mesh(keep(new THREE.TorusGeometry(4.8,.2,12,96,TAU-PI*.32)),metal,workflow.scene,[-27,6,0]);qArc.rotation.z=PI*.16;
  const qEdge=mesh(keep(new THREE.TorusGeometry(4.57,.035,8,96,TAU-PI*.32)),teal,workflow.scene,[-27,6,.12]);qEdge.rotation.z=PI*.16;
  for(let stage=0;stage<4;stage++){const x=-27+stage*18;box(workflow.scene,obsidian,[x,.3,0],[13,.6,13]);box(workflow.scene,mutedGold,[x,.64,6.1],[7,.045,.06]);if(stage<3){box(workflow.scene,metal,[x+9,.26,0],[5,.52,3]);box(workflow.scene,teal,[x+9,.54,0],[5,.045,.07]);}for(let s of [-1,1])box(workflow.scene,concrete,[x+s*7,10,-6.9],[.7,20,.7]);}
  const dataBlocks=new THREE.InstancedMesh(boxGeo,ivory,56);workflow.scene.add(dataBlocks);for(let i=0;i<56;i++){const x=i%7,z=Math.floor(i/7);const h=1.2+((i*7+3)%11)*.38;dummy.position.set(-9+(x-3)*1.1,.8+h/2,(z-3.5)*.9);dummy.scale.set(.4,h,.4);dummy.rotation.set(0,0,0);dummy.updateMatrix();dataBlocks.setMatrixAt(i,dummy.matrix);sphere(workflow.scene,i===17?gold:teal,[-9+(x-3)*1.1,.85+h,(z-3.5)*.9],.06);}
  const workflowDiamond=mesh(keep(new THREE.OctahedronGeometry(3.4,0)),prismMat,workflow.scene,[9,6,0],[.85,1.5,.85]);
  const insightEdges=mesh(keep(new THREE.OctahedronGeometry(3.43,0)),keep(new THREE.MeshBasicMaterial({color:0x9af0d8,wireframe:true,transparent:true,opacity:.55})),workflow.scene,[9,6,0],[.85,1.5,.85]);
  beam(workflow.scene,[5,6,0],[9,6,0],.028,gold);beam(workflow.scene,[9,6,0],[13,7,1],.035,teal);beam(workflow.scene,[9,6,0],[13,5,-1],.035,gold);
  const arrowShape=new THREE.Shape();arrowShape.moveTo(-.9,5);arrowShape.lineTo(.9,5);arrowShape.lineTo(.9,-2);arrowShape.lineTo(2.2,-2);arrowShape.lineTo(0,-5);arrowShape.lineTo(-2.2,-2);arrowShape.lineTo(-.9,-2);arrowShape.closePath();const arrow=mesh(keep(new THREE.ExtrudeGeometry(arrowShape,{depth:.1,bevelEnabled:false})),gold,workflow.scene,[27,.78,0]);arrow.rotation.x=-PI/2;
  for(let i=0;i<8;i++)box(workflow.scene,mutedGold,[27,.2,-10-i*4],[3,.4,2.8]);
  const wDust=dust(workflow.scene,{count:480,spread:105,height:30,size:.06});
  workflow.update=t=>{workflowDiamond.rotation.y=(t-190)*.06;insightEdges.rotation.y=workflowDiamond.rotation.y;wDust.position.y=Math.sin(t*.025);};

  const worlds={eclipse,city,archive,ring,room,prism,workflow,dawn:city};
  for(const w of new Set(Object.values(worlds)))w.scene.traverse(o=>{if(o.isMesh){const mats=Array.isArray(o.material)?o.material:[o.material];if(mats.some(m=>m.isMeshStandardMaterial)){o.castShadow=!mats.some(m=>m.transparent);o.receiveShadow=true;}}});
  // A restrained optical finish: shoulder tone mapping happens in Three, then
  // broad bright-pass halation, subtle fixed grain and lens-edge falloff.
  const target=keep(new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false,type:THREE.HalfFloatType}));
  const postScene=new THREE.Scene();const postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const post=keep(new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{image:{value:target.texture},resolution:{value:new THREE.Vector2(width,height)},time:{value:0},fade:{value:1},warmth:{value:0},exposure:{value:1.2}},vertexShader:'varying vec2 q;void main(){q=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`precision highp float;varying vec2 q;uniform sampler2D image;uniform vec2 resolution;uniform float time;uniform float fade;uniform float warmth;uniform float exposure;
    vec3 bright(vec2 uv){vec3 c=texture2D(image,uv).rgb;return max(c-vec3(.65),vec3(0.));}
    float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+floor(time*24.)*.723)*43758.5453);}
    void main(){vec2 px=1./resolution;vec2 d=q-.5;vec3 c=texture2D(image,q).rgb;vec3 b=vec3(0.);b+=bright(q+px*vec2(7.,0.));b+=bright(q-px*vec2(7.,0.));b+=bright(q+px*vec2(0.,7.));b+=bright(q-px*vec2(0.,7.));b+=bright(q+px*vec2(13.,13.));b+=bright(q-px*vec2(13.,13.));b+=bright(q+px*vec2(-13.,13.));b+=bright(q+px*vec2(13.,-13.));b+=bright(q+px*vec2(29.,0.))*.65;b+=bright(q-px*vec2(29.,0.))*.65;b+=bright(q+px*vec2(0.,29.))*.65;b+=bright(q-px*vec2(0.,29.))*.65;c+=b*.064;c*=exposure;c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);float vig=1.-.5*pow(dot(d*vec2(1.,.8),d*vec2(1.,.8)),.7);c*=vig;c=mix(c,c*vec3(1.045,1.012,.96),warmth);c+=(hash(q*resolution)-.5)*.006;c*=fade;gl_FragColor=vec4(c,1.);
    #include <colorspace_fragment>
    }` }));
  mesh(keep(new THREE.PlaneGeometry(2,2)),post,postScene);
  const look=new THREE.Vector3(),from=new THREE.Vector3(),to=new THREE.Vector3();
  let dead=false;
  function shotAt(t) { return SHOTS.find(s=>t>=s.start&&t<s.end)||SHOTS[t<0?0:SHOTS.length-1]; }
  function render(t) {
    if(dead)throw new Error('Film scene is disposed');
    t=clamp(Number.isFinite(t)?t:0,0,239.999999);
    const shot=shotAt(t),progress=clamp((t-shot.start)/(shot.end-shot.start)),e=ease(progress);
    from.set(...shot.from);to.set(...shot.to);camera.position.lerpVectors(from,to,e);look.set(...shot.look);
    camera.up.set(Math.sin(shot.roll||0),Math.cos(shot.roll||0),0);camera.lookAt(look);camera.fov=shot.fov;camera.updateProjectionMatrix();
    const w=worlds[shot.world];w.update(t,shot.world==='dawn');
    // All billboard transforms are absolute: seek order cannot affect the frame.
    w.scene.traverse(o=>{if(o.userData.billboard)o.quaternion.copy(camera.quaternion);});
    renderer.toneMappingExposure=shot.world==='room'?1.35:shot.world==='dawn'?1.18:1.25;
    post.uniforms.exposure.value=renderer.toneMappingExposure;
    renderer.setRenderTarget(target);renderer.render(w.scene,camera);renderer.setRenderTarget(null);
    post.uniforms.time.value=t;post.uniforms.warmth.value=(shot.world==='room'||shot.world==='dawn')?.65:0;
    // Long opening reveal, a decisive silent reverse cut at 112s, and a final
    // darkening to leave readable space for the coordinator's closing card.
    post.uniforms.fade.value=ease(clamp(t/2.5))*(1-.82*ease(clamp((t-232)/5)));
    renderer.render(postScene,postCamera);
    return shot;
  }
  function dispose(){if(dead)return;dead=true;for(const w of new Set(Object.values(worlds)))w.scene.traverse(o=>o.shadow?.dispose?.());for(const value of disposable)value.dispose?.();renderer.dispose();}
  return {render,dispose,shotAt};
}
