import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExerciseSet } from '../learning/services.mjs';

test('actual-provider exact option text is normalized without guessing or relaxing citations',()=>{
  const raw={questions:[{type:'choice',stem:'What does a fraction describe?',options:['Equal parts of a whole','Unequal parts of a whole'],answer:'Equal parts of a whole',explanation:'The self-authored source states equal parts.',sourceIds:['source-owned']}]};
  const [question]=validateExerciseSet(raw,{type:'choice',count:1,sourceIds:['source-owned']});
  assert.equal(question.answer,'A');assert.equal(question.options[0].text,'Equal parts of a whole');
  raw.questions[0].answer='approximately equal parts';assert.throws(()=>validateExerciseSet(raw,{type:'choice',count:1,sourceIds:['source-owned']}),error=>error.code==='MODEL_SCHEMA');
  raw.questions[0].answer='A';raw.questions[0].sourceIds=['source-other'];assert.throws(()=>validateExerciseSet(raw,{type:'choice',count:1,sourceIds:['source-owned']}),error=>error.code==='MODEL_CITATION');
});
