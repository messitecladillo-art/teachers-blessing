'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {activityByDay,scopedNotes,noteHeading}=require('../study-records.js');
test('seven-day activity counts actual local-day events and excludes old/future/duplicate rows',()=>{
  const now=new Date(2026,10,17,12).getTime(),today=new Date(2026,10,17,10).toISOString(),yesterday=new Date(2026,10,16,8).toISOString();
  const days=activityByDay([{id:'a',createdAt:today},{id:'a',createdAt:today},{id:'b',createdAt:yesterday},{id:'old',createdAt:new Date(2026,10,9).toISOString()},{id:'future',createdAt:new Date(now+1000).toISOString()},{id:'bad',createdAt:'invalid'}],now);
  assert.equal(days.length,7);assert.equal(days[6].label,'11/17');assert.equal(days[6].count,1);assert.equal(days[5].count,1);assert.equal(days.reduce((sum,day)=>sum+day.count,0),2);
});
test('empty activity produces genuine zero counts rather than a sample series',()=>{assert.deepEqual(activityByDay([],Date.now()).map(day=>day.count),[0,0,0,0,0,0,0]);assert.throws(()=>activityByDay([],NaN),RangeError);});
test('note filters retain only the current owner and explicit book/chapter references',()=>{
  const notes=[{id:'a',userId:'A',textbookId:'b1',chapterId:'c1'},{id:'b',userId:'B',textbookId:'b1',chapterId:'c1'},{id:'c',userId:'A',knowledgePointId:'p1'},{id:'d',userId:'A',textbookId:'b2'}],points=[{id:'p1',chapterId:'c1'}];
  assert.deepEqual(scopedNotes(notes,{userId:'A',bookId:'b1',chapterId:'c1',points}).map(note=>note.id),['a','c']);assert.deepEqual(scopedNotes(notes,{userId:'A',bookId:'missing',points:[]}),[]);
});
test('note headings come only from existing user text and remain plain data',()=>{
  assert.equal(noteHeading({note:'\n## 我的理解\n后文'}),'我的理解');assert.equal(noteHeading({note:''}),'未添加标题的笔记');assert.equal(noteHeading({note:'<img onerror=alert(1)>'}),'<img onerror=alert(1)>');assert.equal(noteHeading({note:'长'.repeat(100)}).length,70);
});
