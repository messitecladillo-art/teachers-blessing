'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bayesResult,reviewSummary}=require('../study-studio.js');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,actual+' vs '+expected);
test('Bayes teaching example computes prior, total evidence and posterior from the actual inputs',()=>{
  const value=bayesResult({prior:.1,sensitivity:.95,falsePositive:.02});near(value.diseasePositive,.095);near(value.healthyPositive,.018);near(value.positive,.113);near(value.posterior,95/113);
  near(bayesResult({prior:.01,sensitivity:.95,falsePositive:.05}).posterior,19/118);
});
test('Bayes boundaries distinguish a zero posterior from undefined conditioning evidence',()=>{
  assert.equal(bayesResult({prior:0,sensitivity:1,falsePositive:.2}).posterior,0);
  assert.equal(bayesResult({prior:1,sensitivity:.2,falsePositive:1}).posterior,1);
  assert.equal(bayesResult({prior:.5,sensitivity:0,falsePositive:0}).posterior,null);
  assert.equal(bayesResult({prior:1,sensitivity:0,falsePositive:1}).posterior,null);
  assert.equal(bayesResult({prior:.4,sensitivity:0,falsePositive:1}).posterior,0);
});
test('probability tree mass and conditional multiplication remain valid across a finite grid',()=>{
  for(const prior of [0,.01,.1,.5,.99,1])for(const sensitivity of [0,.01,.1,.5,.99,1])for(const falsePositive of [0,.01,.1,.5,.99,1]){
    const value=bayesResult({prior,sensitivity,falsePositive});near(value.diseasePositive+value.healthyPositive+value.diseaseNegative+value.healthyNegative,1);
    if(value.positive===0)assert.equal(value.posterior,null);else{assert.ok(value.posterior>=0&&value.posterior<=1);near(value.posterior*value.positive,value.diseasePositive);}
  }
});
test('invalid probabilities are rejected rather than evaluated, coerced or silently clamped',()=>{
  for(const invalid of [NaN,Infinity,-Infinity,-.01,1.01,'0.2',null,undefined])for(const key of ['prior','sensitivity','falsePositive'])assert.throws(()=>bayesResult({...{prior:.1,sensitivity:.95,falsePositive:.02},[key]:invalid}),RangeError);
});
test('review progress uses actual current scheduled items and each local-day rating once',()=>{
  const now=new Date(2026,10,17,12).getTime(),today=new Date(2026,10,17,10).toISOString(),yesterday=new Date(2026,10,16,10).toISOString();
  const result=reviewSummary([
    {status:'scheduled',dueAt:new Date(now-1000).toISOString(),history:[{rating:'good',at:today},{rating:'easy',at:today}]},
    {status:'scheduled',dueAt:new Date(now+1000).toISOString(),history:[{rating:'hard',at:yesterday}]},
    {status:'scheduled',stale:true,dueAt:new Date(now-1000).toISOString(),history:[{rating:'good',at:today}]},
    {status:'cancelled',dueAt:new Date(now-1000).toISOString(),history:[{rating:'good',at:today}]}
  ],now);assert.deepEqual(result,{total:2,due:1,reviewed:1,ratio:.5});
});
test('empty review scope has no invented progress and postponement is not a rating',()=>{
  assert.deepEqual(reviewSummary([],Date.now()),{total:0,due:0,reviewed:0,ratio:null});
  const now=Date.now(),at=new Date(now).toISOString();assert.equal(reviewSummary([{status:'scheduled',dueAt:at,history:[{rating:'',at},{rating:'postponed',at}]}],now).reviewed,0);
});
