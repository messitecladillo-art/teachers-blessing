import test from 'node:test';
import assert from 'node:assert/strict';
import {researchLessonFields} from '../learning/research-lesson.mjs';
const artifact={id:'research',sources:[{id:'a',url:'https://www.bilibili.com/video/BVSelfAuthored?p=2',title:'Synthetic reference'}]};
test('lesson citations tolerate only known tracking parameters on the same referenced content',()=>{assert.deepEqual(researchLessonFields({externalSourceIds:['a'],content:'[来源](https://www.bilibili.com/video/BVSelfAuthored?p=2&utm_source=search&spm_id_from=index)'},artifact).externalSourceIds,['a']);});
test('citation normalization must not admit a different content parameter or undeclared source',()=>{for(const data of [{externalSourceIds:['a'],content:'https://www.bilibili.com/video/BVSelfAuthored?p=3'},{externalSourceIds:[],content:artifact.sources[0].url},{externalSourceIds:['x'],content:artifact.sources[0].url}])assert.throws(()=>researchLessonFields(data,artifact),{code:'LESSON_EXTERNAL_CITATION'});});
