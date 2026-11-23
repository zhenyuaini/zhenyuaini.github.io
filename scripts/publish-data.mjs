import {mkdir,readFile,writeFile} from 'node:fs/promises';
const origin='https://zy-research-lab-2jwhxpli.edgeone.dev';
const indices=['sh000001','sh000300','sz399006','sh000688','sh000905','hkHSTECH','usIXIC'];
const routes=['market-quotes','etf-rotation','watchlist-daily','turnover-estimate','turnover-signal-log','publish-weekly-review',...indices.map(s=>'index-candles/'+s),...['vix','sp500','cot'].map(s=>'market-history/'+s)];
const results=[];
for(let start=0;start<routes.length;start+=4) await Promise.all(routes.slice(start,start+4).map(async route=>{
 const path='data/'+route+'.json';
 try{
  const response=await fetch(origin+'/api/'+route,{signal:AbortSignal.timeout(100000)});
  if(!response.ok) throw Error('HTTP '+response.status);
  const data=await response.json();
  if(data.error) throw Error(String(data.error));
  await mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});
  await writeFile(path,JSON.stringify(data));
  results.push({route,status:'updated',publishedAt:new Date().toISOString(),asOf:data.asOf??data.checkedAt??null});
 }catch(error){
  let retained=false;try{await readFile(path);retained=true;}catch{}
  results.push({route,status:retained?'retained':'missing',error:String(error)});
 }
}));
await mkdir('data',{recursive:true});
try {
 const rotation=JSON.parse(await readFile('data/etf-rotation.json','utf8'));
 const r=await fetch(origin+'/api/etf-quality?date='+rotation.asOf,{signal:AbortSignal.timeout(100000)});
 if(!r.ok) throw Error('HTTP '+r.status);
 const quality=await r.json();if(quality.error)throw Error(quality.error);
 await writeFile('data/etf-quality.json',JSON.stringify(quality));
 results.push({route:'etf-quality',status:'updated',asOf:rotation.asOf,publishedAt:new Date().toISOString()});
} catch(error){results.push({route:'etf-quality',status:'missing',error:String(error)});}
// Publish new automatically generated weekly articles, including their hashed assets.
try {
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
await writeFile('data/status.json',JSON.stringify({checkedAt:new Date().toISOString(),origin,results},null,2));
console.log(JSON.stringify(results));
if(!results.some(r=>r.status==='updated')) process.exitCode=1;
