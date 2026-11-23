import assert from 'node:assert/strict';
const host=process.env.PUBLIC_ORIGIN??'https://zhenyuaini.github.io';
async function json(route){const r=await fetch(host+'/data/'+route+'.json?verify='+Date.now(),{redirect:'error',signal:AbortSignal.timeout(25000)});assert.equal(r.status,200,route);return r.json();}
const [quotes,rotation,watch,quality,log,publication]=await Promise.all(['market-quotes','etf-rotation','watchlist-daily','etf-quality','turnover-signal-log','publish-weekly-review'].map(json));
assert.equal(Object.keys(quotes.quotes).length,15);
for(const q of Object.values(quotes.quotes)){assert(q.price>0);assert(Number.isFinite(Date.parse(q.quotedAt)));}
assert(rotation.latest.rows.length>=20);assert.equal(Object.keys(watch.histories).length,8);
assert.equal(quality.date,rotation.asOf);assert.equal(Object.keys(quality.funds).length,22);for(const [code,q]of Object.entries(quality.funds))for(const key of ['size','fees','premium','tracking'])assert(q[key],code+' '+key+' missing');
assert.equal(log.latest.rows.length,20);assert(log.increased<=log.paired&&log.paired<=log.triggered);
for(const symbol of ['sh000001','sh000300','sz399006','sh000688','sh000905','hkHSTECH','usIXIC']){
 const d=await json('index-candles/'+symbol);assert(d.bars.length>=500,symbol);
 for(const b of d.bars){assert(b.low>0&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)&&b.volume>=0,symbol);}
}
for(const id of ['vix','sp500','cot']){const d=await json('market-history/'+id);assert(d.history.length>=200,id);}
const r=await fetch(host+publication.latest.href+'/',{redirect:'error'});assert.equal(r.status,200);assert((await r.text()).includes(publication.latest.title));
console.log(JSON.stringify({anonymousAccess:true,quotes:15,etfRows:rotation.latest.rows.length,qualityFunds:22,watchlist:8,indexHistories:7,dataDate:rotation.asOf,monitor:{days:log.days,triggered:log.triggered,paired:log.paired,increased:log.increased},weekly:publication.latest.href}));

const cot=await json('market-history/cot');for(const p of cot.history){assert.equal(p.value,(p.long-p.short)/p.openInterest*100);assert(p.sourceUrl.includes('13874A'));}console.log(JSON.stringify({qualityCoverage:'22/22 x 4 fields',cftcWeeks:cot.history.length,cftcAsOf:cot.asOf}));
