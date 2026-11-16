(function(root,factory){
  'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.BookGardenSpz=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  // Format facts checked against nianticlabs/spz commit
  // d5abdee9b37c426a0b66b961c3d43b5857a24f4f, README.md and src/cc/load-spz.cc:
  // https://github.com/nianticlabs/spz/blob/d5abdee9b37c426a0b66b961c3d43b5857a24f4f/README.md
  // https://github.com/nianticlabs/spz/blob/d5abdee9b37c426a0b66b961c3d43b5857a24f4f/src/cc/load-spz.cc
  // v1–3: gzip around a 16-byte LE legacy header. v4: plaintext 32-byte
  // header and independent ZSTD streams, intentionally unsupported here.
  // This local rendering profile accepts SH0–3, flags0/1, fractionalBits0–24.
  // SH4 and extension bit0x2 exist upstream, but are NOT enabled merely because
  // the latest upstream can read them. Spark compatibility must be verified.
  // Narrow compatibility exception: original generated SPZ v2/SH0/frac12 uses
  // bit0x40. Niantic does not define its semantics. Pinned Spark2.4.0 commit
  // ffe210dc0a45d0515a06c9235878108112827d61 rust/spark-lib/src/spz.rs
  // retains flags but only tests0x80 for its LoD/layout/opacity paths; bit0x40
  // is ignored. The unmodified 2M-point artifact (SHA256
  // 0dc4f0f6b10ce47a1aa169d79b4e3190aacf954d2b906072644d6128e8d92131)
  // completed a real decode_to_gsplatarray push/finish with this exact vendored
  // Spark/WASM. Allow only this tested header profile plus existing antialias
  // bit0x01; keep original flags and disclose the ignored bit. No bytes cleared.
  // https://github.com/sparkjsdev/spark/blob/ffe210dc0a45d0515a06c9235878108112827d61/rust/spark-lib/src/spz.rs
  const MAGIC=0x5053474e,HEADER_BYTES=16,HARD_MAX_POINTS=2000000;
  const failure=(code,message)=>Object.assign(new Error(message),{code});
  function aborted(signal){if(!signal?.aborted)return null;const reason=signal.reason;if(reason instanceof Error)return reason;const error=failure('SPZ_ABORTED','SPZ头部检查已取消');error.name='AbortError';return error;}
  function asBytes(value){
    try{if(value instanceof ArrayBuffer)return new Uint8Array(value);if(ArrayBuffer.isView(value)&&value.buffer instanceof ArrayBuffer)return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);}catch{}
    throw failure('SPZ_INPUT','SPZ输入须为有效ArrayBuffer或字节视图');
  }
  function parseHeader(header,maxPoints){
    const view=new DataView(header.buffer,header.byteOffset,HEADER_BYTES),magic=view.getUint32(0,true),version=view.getUint32(4,true),numPoints=view.getUint32(8,true),shDegree=header[12],fractionalBits=header[13],flags=header[14];
    if(magic!==MAGIC)throw failure('SPZ_MAGIC','解压数据不是SPZ头部');
    if(version<1||version>3)throw failure('SPZ_VERSION_UNSUPPORTED','此页面仅验证过SPZ v1至v3的gzip头部；其他版本保持静态');
    if(numPoints===0||numPoints>maxPoints)throw failure('SPZ_POINTS_LIMIT','SPZ点数为空或超过本页'+maxPoints+'点预算');
    if(shDegree>3)throw failure('SPZ_SH_UNSUPPORTED','本页尚未启用此球谐阶数，保持静态');
    if(fractionalBits>24)throw failure('SPZ_FRACTIONAL_BITS','SPZ坐标精度超出本页支持范围');
    const generatedCompatibility=version===2&&shDegree===0&&fractionalBits===12&&(flags===0x40||flags===0x41);
    if((flags&~1)&&!generatedCompatibility)throw failure('SPZ_FLAGS_UNSUPPORTED','本页尚未验证此SPZ扩展标记，保持静态');
    if(header[15]!==0)throw failure('SPZ_HEADER','SPZ保留头字节须为零');
    return Object.freeze({format:'spz',compression:'gzip',version,numPoints,shDegree,fractionalBits,flags,antialiased:!!(flags&1),headerBytes:HEADER_BYTES,inspection:'header-only',integrityVerified:false,maxPoints,...(generatedCompatibility?{ignoredFlags:0x40,compatProfile:'spark-2.4.0-v2-sh0-frac12-marker40'}:{})});
  }
  /**
   * Read only the legacy SPZ header before any Spark/GPU admission.
   * This is NOT a CRC/attribute validator: cancellation after 16 decoded bytes
   * cannot certify corruption later in the gzip member. The caller must still
   * catch complete Spark decoding/rendering failures and retain static mode.
   */
  async function inspectSpz(bytes,options={}){
    if(!options||typeof options!=='object'||Array.isArray(options))throw failure('SPZ_OPTIONS','SPZ检查选项无效');
    const {signal}=options,maxPoints=options.maxPoints===undefined?HARD_MAX_POINTS:options.maxPoints;
    if(!Number.isSafeInteger(maxPoints)||maxPoints<1||maxPoints>HARD_MAX_POINTS)throw failure('SPZ_OPTIONS','点数预算须为1至2000000的整数');
    if(signal&&(!(typeof signal.addEventListener==='function')||!(typeof signal.removeEventListener==='function')||typeof signal.aborted!=='boolean'))throw failure('SPZ_OPTIONS','signal须为AbortSignal');
    const preAborted=aborted(signal);if(preAborted)throw preAborted;
    const input=asBytes(bytes);
    if(input.byteLength<2)throw failure('SPZ_HEADER','SPZ文件为空或头部不完整');
    // Plaintext NGSP is the v4 container, not a legacy gzip stream. Never feed
    // it into a gzip decoder or silently accept v4 for this untested renderer.
    if(input.byteLength>=4&&new DataView(input.buffer,input.byteOffset,input.byteLength).getUint32(0,true)===MAGIC){
      if(input.byteLength<8)throw failure('SPZ_HEADER','SPZ明文头部不完整');
      throw failure('SPZ_VERSION_UNSUPPORTED','不支持明文SPZ/ZSTD版本；此页面仅接受v1至v3 gzip，保持静态');
    }
    if(input[0]!==0x1f||input[1]!==0x8b)throw failure('SPZ_MAGIC','输入不是SPZ gzip文件');
    const Decoder=options.DecompressionStream===undefined?globalThis.DecompressionStream:options.DecompressionStream;
    if(typeof Decoder!=='function'||typeof Blob!=='function'||typeof AbortController!=='function')throw failure('SPZ_DECOMPRESSION_UNAVAILABLE','当前浏览器不能安全检查SPZ，保持静态');
    const controller=new AbortController();let reader=null,pipe=null,onAbort=null,rejectAbort;
    const abortWait=new Promise((_,reject)=>{rejectAbort=reject;});
    // A handler is installed even if setup throws before the first read race.
    abortWait.catch(()=>{});
    try{
      const decoder=new Decoder('gzip');
      if(!decoder?.readable?.getReader||!decoder?.writable)throw failure('SPZ_DECOMPRESSION_UNAVAILABLE','gzip解压器接口不可用');
      reader=decoder.readable.getReader();
      onAbort=()=>{const reason=aborted(signal)||failure('SPZ_ABORTED','SPZ检查已取消');rejectAbort(reason);controller.abort(reason);void reader?.cancel(reason).catch(()=>{});};
      signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
      // Blob.stream provides a bounded-chunk source. Do not use arrayBuffer()
      // on the decompressed stream or collect attribute arrays in this helper.
      pipe=new Blob([input]).stream().pipeTo(decoder.writable,{signal:controller.signal});
      pipe.catch(()=>{});
      const header=new Uint8Array(HEADER_BYTES);let copied=0,reads=0;
      while(copied<HEADER_BYTES){
        if(++reads>32)throw failure('SPZ_HEADER','SPZ头部未在有限读取次数内取得');
        const stop=aborted(signal);if(stop)throw stop;
        const {done,value}=await Promise.race([reader.read(),abortWait]);
        if(done)throw failure('SPZ_HEADER','SPZ解压头部不足16字节');
        if(!(value instanceof Uint8Array))throw failure('SPZ_GZIP','gzip解压器返回了无效字节');
        const length=Math.min(value.byteLength,HEADER_BYTES-copied);header.set(value.subarray(0,length),copied);copied+=length;
      }
      const stop=aborted(signal);if(stop)throw stop;
      return parseHeader(header,maxPoints);
    }catch(error){
      const stop=aborted(signal);if(stop)throw stop;
      if(typeof error?.code==='string'&&error.code.startsWith('SPZ_'))throw error;
      throw failure('SPZ_GZIP','SPZ gzip头部损坏或解压失败，保持静态');
    }finally{
      signal?.removeEventListener('abort',onAbort);
      // Cancel both halves, then release the only reader. Catch rejections from
      // the intentional short read; no background rejected pipe is left live.
      const reason=failure('SPZ_HEADER_DONE','SPZ有限头部读取结束');
      controller.abort(reason);
      const cancellation=reader?reader.cancel(reason).catch(()=>{}):Promise.resolve();
      await Promise.allSettled([cancellation,pipe||Promise.resolve()]);
      if(reader)try{reader.releaseLock();}catch{}
    }
  }
  return Object.freeze({inspectSpz,HARD_MAX_POINTS,HEADER_BYTES});
});
