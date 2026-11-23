import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {mergeQuality} from './enrich-data.mjs';
const origin='https://zy-research-lab-2jwhxpli.edgeone.dev';
const indices=['sh000001','sh000300','sz399006','sh000688','sh000905','hkHSTECH','usIXIC'];
const quick=process.env.QUICK==='1';
const routes=quick?['market-quotes','turnover-estimate','turnover-signal-log']:['market-quotes','etf-rotation','watchlist-daily','turnover-estimate','turnover-signal-log','publish-weekly-review',...indices.map(s=>'index-candles/'+s),...['vix','sp500','cot'].map(s=>'market-history/'+s)];
const results=[];
async function hkCandles(){
 const url='https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=124.HSTECH&klt=101&fqt=0&lmt=800&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56';
 for(let attempt=0;attempt<3;attempt++)try{
  const r=await fetch(url+'&_='+Date.now(),{headers:{Referer:'https://quote.eastmoney.com/','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(25000)});
  const d=await r.json();if(d.rc!==0||d.data?.code!=='HSTECH'||!Array.isArray(d.data.klines))throw Error('HK schema');
  const bars=d.data.klines.map(s=>{const [date,...numbers]=s.split(',');const [open,close,high,low,volume]=numbers.map(Number);return {date,open,close,high,low,volume};}).filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&[b.open,b.close,b.high,b.low,b.volume].every(Number.isFinite)&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.volume>=0);
  if(bars.length<60)throw Error('Insufficient HK bars');
  return {bars,volumeUnit:'股',source:'东方财富',sourceUrl:url};
 }catch(error){if(attempt===2)throw error;}
}
for(let start=0;start<routes.length;start+=4) await Promise.all(routes.slice(start,start+4).map(async route=>{
 const path='data/'+route+'.json';
 try{
  const response=await fetch(origin+'/api/'+route,{signal:AbortSignal.timeout(100000)});
  if(!response.ok&&route!=='index-candles/hkHSTECH') throw Error('HTTP '+response.status);
  const data=response.ok?await response.json():await hkCandles();
  if(data.error) throw Error(String(data.error));
  if(route==='market-quotes'&&!Object.keys(data.quotes??{}).length)throw Error('Empty quotes');
  if(route==='etf-rotation'&&!(data.latest?.rows?.length>0))throw Error('Empty rotation');
  if(route==='watchlist-daily'&&Object.keys(data.histories??{}).length!==8)throw Error('Incomplete watchlist');
  if(route.startsWith('index-candles/')&&!(data.bars?.length>=60))throw Error('Insufficient candles');
  await mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});
  await writeFile(path,JSON.stringify(data));
  results.push({route,status:'updated',publishedAt:new Date().toISOString(),asOf:data.asOf??data.checkedAt??null});
 }catch(error){
  let retained=false;try{await readFile(path);retained=true;}catch{}
  results.push({route,status:retained?'retained':'missing',error:String(error)});
 }
}));
await mkdir('data',{recursive:true});
if(!quick)try {
 const rotation=JSON.parse(await readFile('data/etf-rotation.json','utf8'));
 const r=await fetch(origin+'/api/etf-quality?date='+rotation.asOf,{signal:AbortSignal.timeout(100000)});
 if(!r.ok) throw Error('HTTP '+r.status);
 const quality=await r.json();if(quality.error)throw Error(quality.error);
 try{mergeQuality(quality,JSON.parse(await readFile('data/etf-quality.json','utf8')));}catch{}
 await writeFile('data/etf-quality.json',JSON.stringify(quality));
 results.push({route:'etf-quality',status:'updated',asOf:rotation.asOf,publishedAt:new Date().toISOString()});
} catch(error){let retained=false;try{await readFile('data/etf-quality.json');retained=true;}catch{}results.push({route:'etf-quality',status:retained?'retained':'missing',error:String(error)});}
// Publish new automatically generated weekly articles, including their hashed assets.
if(!quick)try {
 const publication=JSON.parse(await readFile('data/publish-weekly-review.json','utf8'));
 const href=publication.latest?.href;
 if(/^\/research\/review\/\d{4}-\d{2}-\d{2}$/.test(href)){
  const r=await fetch(origin+href,{signal:AbortSignal.timeout(100000)});if(!r.ok)throw Error('HTTP '+r.status);
  let html=await r.text();if(!html.includes('<html'))throw Error('Invalid article');
  const assets=[...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)(?:\?[^" ]*)?"/g)].map(m=>m[1]))];
  for(const path of assets){
   try{await readFile('.'+path);}catch{const asset=await fetch(origin+path,{signal:AbortSignal.timeout(30000)});if(!asset.ok)throw Error('Asset '+asset.status);await mkdir('.'+path.slice(0,path.lastIndexOf('/')),{recursive:true});await writeFile('.'+path,Buffer.from(await asset.arrayBuffer()));}
  }
  html=html.replaceAll(origin,'https://zhenyuaini.github.io').replace('<head>','<head><script src="/pages-runtime.js"></script>');
  await mkdir('.'+href,{recursive:true});await writeFile('.'+href+'/index.html',html);
  results.push({route:href,status:'updated',publishedAt:new Date().toISOString()});
 }
}catch(error){results.push({route:'weekly-article',status:'missing',error:String(error)});}
let previous=[];try{previous=JSON.parse(await readFile('data/status.json','utf8')).results??[];}catch{}
const merged=[...previous.filter(p=>!results.some(r=>r.route===p.route)),...results.map(r=>{const old=previous.find(p=>p.route===r.route);return r.status==='retained'?{...old,...r}:r;})];
await writeFile('data/status.json',JSON.stringify({checkedAt:new Date().toISOString(),origin,results:merged},null,2));
console.log(JSON.stringify(results));
if(!results.some(r=>r.status==='updated')) process.exitCode=1;
