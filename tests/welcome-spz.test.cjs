const test=require('node:test');
const assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib');
const {inspectSpz}=require('../welcome-spz.js');

function header({version=2,numPoints=100,shDegree=0,fractionalBits=12,flags=0,magic=0x5053474e,reserved=0}={}){const data=Buffer.alloc(16);data.writeUInt32LE(magic,0);data.writeUInt32LE(version,4);data.writeUInt32LE(numPoints,8);data[12]=shDegree;data[13]=fractionalBits;data[14]=flags;data[15]=reserved;return data;}
const gzip=options=>gzipSync(Buffer.concat([header(options),Buffer.alloc(300)]));
const code=expected=>error=>error.code===expected;

test('real synthetic gzip SPZ v1–3 exposes only header facts and explicit unverified integrity',async()=>{
  for(const version of [1,2,3]){const raw=gzip({version,numPoints:2000000,shDegree:3,flags:1});const meta=await inspectSpz(raw);assert.deepEqual(meta,{format:'spz',compression:'gzip',version,numPoints:2000000,shDegree:3,fractionalBits:12,flags:1,antialiased:true,headerBytes:16,inspection:'header-only',integrityVerified:false,maxPoints:2000000});}
});

test('only the actual fixed-decoder verified v2/SH0/frac12 marker40 profile may retain the reserved bit',async()=>{
  for(const flags of [0x40,0x41]){const input=gzip({version:2,numPoints:2000000,shDegree:0,fractionalBits:12,flags}),before=Buffer.from(input),meta=await inspectSpz(input);assert.equal(meta.flags,flags);assert.equal(meta.ignoredFlags,0x40);assert.equal(meta.compatProfile,'spark-2.4.0-v2-sh0-frac12-marker40');assert.equal(meta.antialiased,flags===0x41);assert.equal(meta.numPoints,2000000);assert.equal(meta.integrityVerified,false);assert.deepEqual(input,before);}
  for(const options of [{version:1},{version:3},{shDegree:1},{shDegree:2},{shDegree:3},{fractionalBits:11},{fractionalBits:13},{flags:0x42},{flags:0x43},{flags:0x80},{flags:0xc0},{flags:0xff}])await assert.rejects(inspectSpz(gzip({version:2,shDegree:0,fractionalBits:12,flags:0x40,...options})),code('SPZ_FLAGS_UNSUPPORTED'));
  await assert.rejects(inspectSpz(gzip({numPoints:2000001,flags:0x40})),code('SPZ_POINTS_LIMIT'));
});

test('reads byte views at their actual offsets without changing the compressed input',async()=>{
  const raw=gzip({numPoints:321,shDegree:2}),wrapped=Buffer.concat([Buffer.from('not-the-header'),raw,Buffer.from('suffix')]),before=Buffer.from(wrapped),view=new DataView(wrapped.buffer,wrapped.byteOffset+14,raw.length),meta=await inspectSpz(view);assert.equal(meta.numPoints,321);assert.equal(meta.shDegree,2);assert.deepEqual(wrapped,before);
  const standalone=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);assert.equal((await inspectSpz(standalone)).numPoints,321);
});

test('invalid legacy headers fail before renderer admission, including count and unverified feature budgets',async t=>{
  const cases=[['SPZ_MAGIC',{magic:0x12345678}],['SPZ_VERSION_UNSUPPORTED',{version:0}],['SPZ_VERSION_UNSUPPORTED',{version:4}],['SPZ_VERSION_UNSUPPORTED',{version:0xffffffff}],['SPZ_POINTS_LIMIT',{numPoints:0}],['SPZ_POINTS_LIMIT',{numPoints:2000001}],['SPZ_POINTS_LIMIT',{numPoints:0xffffffff}],['SPZ_SH_UNSUPPORTED',{shDegree:4}],['SPZ_SH_UNSUPPORTED',{shDegree:255}],['SPZ_FRACTIONAL_BITS',{fractionalBits:25}],['SPZ_FLAGS_UNSUPPORTED',{flags:2}],['SPZ_FLAGS_UNSUPPORTED',{flags:128}],['SPZ_HEADER',{reserved:1}]];
  for(const [expected,options]of cases)await t.test(expected+JSON.stringify(options),()=>assert.rejects(inspectSpz(gzip(options)),code(expected)));
  await assert.rejects(inspectSpz(gzip({numPoints:101}),{maxPoints:100}),code('SPZ_POINTS_LIMIT'));
  assert.equal((await inspectSpz(gzip({numPoints:100}),{maxPoints:100})).maxPoints,100);
});

test('plaintext v4 and non-gzip or short inputs never invoke the gzip decoder',async()=>{
  let constructors=0;class NeverDecoder{constructor(){constructors++;throw new Error('must not reach');}}
  const v4=Buffer.concat([header({version:4}),Buffer.alloc(16)]);await assert.rejects(inspectSpz(v4,{DecompressionStream:NeverDecoder}),code('SPZ_VERSION_UNSUPPORTED'));
  for(const raw of [Buffer.alloc(0),Buffer.from([0x1f]),Buffer.from('SPZ?'),header({version:2})])await assert.rejects(inspectSpz(raw,{DecompressionStream:NeverDecoder}),e=>e.code.startsWith('SPZ_'));
  assert.equal(constructors,0);
});

test('no decompressor or invalid options cannot silently bypass a header check',async()=>{
  await assert.rejects(inspectSpz(gzip(),{DecompressionStream:null}),code('SPZ_DECOMPRESSION_UNAVAILABLE'));
  await assert.rejects(inspectSpz(gzip(),{DecompressionStream:class{constructor(){throw new Error('gzip unavailable');}}}),code('SPZ_GZIP'));
  for(const maxPoints of [0,-1,2.5,Infinity,NaN,2000001,'2000000',null])await assert.rejects(inspectSpz(gzip(),{maxPoints}),code('SPZ_OPTIONS'));
  for(const value of [undefined,null,{},'bytes',new Uint8Array(new SharedArrayBuffer(16))])await assert.rejects(inspectSpz(value),code('SPZ_INPUT'));
  await assert.rejects(inspectSpz(gzip(),{signal:{aborted:false}}),code('SPZ_OPTIONS'));
});

test('real gzip corruption and truncated decompressed headers fail without a success DTO',async()=>{
  const raw=gzip(),badCrc=Buffer.from(raw);badCrc[badCrc.length-8]^=0xff;
  for(const bytes of [Buffer.from([0x1f,0x8b,0xff,0xff]),raw.subarray(0,10),badCrc])await assert.rejects(inspectSpz(bytes),code('SPZ_GZIP'));
  for(const n of [0,1,8,15])await assert.rejects(inspectSpz(gzipSync(header().subarray(0,n))),code('SPZ_HEADER'));
});

test('streaming inspection keeps exactly 16 decoded header bytes and cancels instead of collecting attributes',async()=>{
  const state={cancelled:false,format:null,pulls:0,writes:0},decoded=Buffer.concat([header({numPoints:99}),Buffer.alloc(1024*1024)]);
  class InstrumentedDecoder{constructor(format){state.format=format;this.readable=new ReadableStream({pull(controller){state.pulls++;if(state.pulls===1)controller.enqueue(decoded);else throw new Error('must cancel before reading attributes');},cancel(){state.cancelled=true;}});this.writable=new WritableStream({write(){state.writes++;}});}}
  const meta=await inspectSpz(gzip(),{DecompressionStream:InstrumentedDecoder});assert.equal(meta.numPoints,99);assert.equal(meta.headerBytes,16);assert.equal(meta.integrityVerified,false);assert.equal(state.format,'gzip');assert.equal(state.cancelled,true);assert.ok(state.pulls<=2);
});

test('split header bytes are accumulated only until complete, and empty-output loops are bounded',async()=>{
  const input=header({version:3,numPoints:88}),state={cancelled:false,reads:0};
  class SplitDecoder{constructor(){this.readable=new ReadableStream({pull(c){const i=state.reads++;if(i<input.length)c.enqueue(input.subarray(i,i+1));},cancel(){state.cancelled=true;}});this.writable=new WritableStream();}}
  assert.equal((await inspectSpz(gzip(),{DecompressionStream:SplitDecoder})).numPoints,88);assert.equal(state.cancelled,true);assert.ok(state.reads<=17);
  let zeroCancelled=false;class EmptyDecoder{constructor(){this.readable=new ReadableStream({pull(c){c.enqueue(new Uint8Array());},cancel(){zeroCancelled=true;}});this.writable=new WritableStream();}}
  await assert.rejects(inspectSpz(gzip(),{DecompressionStream:EmptyDecoder}),code('SPZ_HEADER'));assert.equal(zeroCancelled,true);
});

test('pre-aborted and pending-read abort preserve cancellation and close both pipe and reader',async()=>{
  let constructors=0;class NeverDecoder{constructor(){constructors++;}}
  const pre=new AbortController();pre.abort(new Error('synthetic pre-abort'));await assert.rejects(inspectSpz(gzip(),{signal:pre.signal,DecompressionStream:NeverDecoder}),/synthetic pre-abort/);assert.equal(constructors,0);
  const state={cancelled:false,aborted:false,closed:false};let ready;const reading=new Promise(resolve=>ready=resolve);
  class PendingDecoder{constructor(){this.readable=new ReadableStream({pull(){ready();},cancel(){state.cancelled=true;}});this.writable=new WritableStream({abort(){state.aborted=true;},close(){state.closed=true;}});}}
  const controller=new AbortController(),pending=inspectSpz(gzip(),{signal:controller.signal,DecompressionStream:PendingDecoder});await reading;controller.abort(new Error('synthetic pending-abort'));await assert.rejects(pending,/synthetic pending-abort/);assert.equal(state.cancelled,true);assert.equal(state.aborted||state.closed,true);
});

test('UMD browser build installs only the documented namespace without a renderer',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),context={};vm.runInNewContext(fs.readFileSync(require.resolve('../welcome-spz.js'),'utf8'),context);assert.equal(typeof context.BookGardenSpz.inspectSpz,'function');assert.deepEqual(Object.keys(context),['BookGardenSpz']);
});
