import {mkdir,readFile,writeFile} from 'node:fs/promises';
const origin='https://zy-research-lab-2jwhxpli.edgeone.dev';
const indices=['sh000001','sh000300','sz399006','sh000688','sh000905','hkHSTECH','usIXIC'];
const routes=['market-quotes','etf-rotation','watchlist-daily','etf-quality','turnover-estimate','turnover-signal-log','publish-weekly-review',...indices.map(s=>'index-candles/'+s),...['vix','sp500','sp500-crowding'].map(s=>'market-history/'+s)];
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
await writeFile('data/status.json',JSON.stringify({checkedAt:new Date().toISOString(),origin,results},null,2));
console.log(JSON.stringify(results));
if(!results.some(r=>r.status==='updated')) process.exitCode=1;
