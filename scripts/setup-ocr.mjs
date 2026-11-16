import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target=path.join(root,'.local','learning','ocr-langs');
const commit='87416418657359cb625c412a48b6e1d6d41c29bd';
const models=[
  {language:'eng',sha256:'7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',bytes:4113088},
  {language:'chi_sim',sha256:'a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730',bytes:2469156},
];
await mkdir(target,{recursive:true});
const records=[];
for(const model of models){
  const url=`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${commit}/${model.language}.traineddata`;
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`OCR language download failed: HTTP ${response.status}`);
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length!==model.bytes||createHash('sha256').update(data).digest('hex')!==model.sha256)throw new Error('OCR language integrity check failed');
  await writeFile(path.join(target,model.language+'.traineddata'),data,{mode:0o600});
  records.push({...model,url,commit,license:'Apache-2.0'});
  console.log(`OCR language ready: ${model.language}`);
}
await writeFile(path.join(target,'sources.json'),JSON.stringify(records,null,2)+'\n');
