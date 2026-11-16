/** Fixed registered kernel subprocess. One bounded UTF-8 JSON input, one receipt, no provider calls. */
import { executeWorkflowNode, WorkflowKernelError } from '../lib/workflow-kernel.ts';
import { rejectDuplicateMembers } from '../../../packages/evi-x-shared/src/questionnaire.ts';

const INPUT_LIMIT=6*1024*1024;
const OUTPUT_LIMIT=12*1024*1024;
let bytes=0;
const chunks=[];
try {
  for await(const chunk of process.stdin) {
    bytes+=chunk.length;
    if(bytes>INPUT_LIMIT)throw new WorkflowKernelError('input_limit','执行输入超过 6 MiB。');
    chunks.push(chunk);
  }
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  if(!raw.trim())throw new WorkflowKernelError('invalid_input','执行输入为空。');
  // Existing questionnaire duplicate-field check has a deliberately small depth limit;
  // dataset rows add one level, but only genuine JSON objects can name input members.
  rejectDuplicateMembers(raw);
  const receipt=await executeWorkflowNode(JSON.parse(raw));
  const serialized=JSON.stringify(receipt);
  if(Buffer.byteLength(serialized,'utf8')>OUTPUT_LIMIT)throw new WorkflowKernelError('output_limit','执行输出超过 12 MiB。');
  process.stdout.write(serialized+'\n');
}catch(error){
  const code=error instanceof WorkflowKernelError?error.code:'kernel_error';
  process.stdout.write(JSON.stringify({error:{code,message:error instanceof Error?error.message:'执行失败。'}})+'\n');
  process.exitCode=2;
}
