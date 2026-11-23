import {readFile,writeFile,mkdir} from 'node:fs/promises';
const checkedAt=new Date().toISOString();
const headers={'User-Agent':'ZYResearch/1.0 public financial data reader',Referer:'https://fundf10.eastmoney.com/'};
async function source(url,kind='json'){
 let error;
 for(let attempt=0;attempt<3;attempt++)try{
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  return kind==='json'?await response.json():await response.text();
 }catch(e){error=e;}
 throw error;
}
export function profile(html,code,cutoff){
 if(!new RegExp('<title>[^<]*'+code).test(html))throw Error('Fund identity mismatch');
 const cell=name=>html.match(new RegExp('<th[^>]*>\\s*'+name+'\\s*</th>\\s*<td[^>]*>\\s*([^<]+)'))?.[1];
 const match=cell('净资产规模')?.match(/([\d,.]+)\s*(亿|万)?元[^\d]*(\d{4})年(\d{1,2})月(\d{1,2})日/);
 const date=match?[match[3],match[4].padStart(2,'0'),match[5].padStart(2,'0')].join('-'):'';
 const value=match?Number(match[1].replaceAll(',',''))*(match[2]==='亿'?1e8:match[2]==='万'?1e4:1):NaN;
 const rate=name=>{const m=cell(name)?.match(/([\d.]+)\s*%/);return m?Number(m[1]):NaN;};
 const management=rate('管理费率'),custody=rate('托管费率');
 return {size:value>0&&Number.isFinite(value)&&date<=cutoff?{value,date}:null,fees:[management,custody].every(v=>Number.isFinite(v)&&v>=0&&v<5)?{management,custody,total:Number((management+custody).toFixed(4))}:null};
}
export function tracking(bars,nav){
 const days=bars.slice(-61);if(days.length<61||!nav.has(days[0].date))return null;
 const deltas=[];
 for(let i=1;i<days.length;i++){
  const b=days[i],prev=days[i-1],change=nav.get(b.date)?.change;
  if(!Number.isFinite(change)||change<=-100||!(prev.close>0&&b.close>0))return null;
  deltas.push(change-(b.close/prev.close-1)*100);
 }
 const mean=deltas.reduce((a,b)=>a+b,0)/deltas.length;
 return {value:Math.sqrt(deltas.reduce((a,b)=>a+(b-mean)**2,0)/(deltas.length-1)*252),start:days[1].date,date:days.at(-1).date,sessions:60,indexSource:'csi'};
}
export function cotPoints(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('Empty CFTC data');
 const points=new Map();
 for(const row of rows){
  if(row.cftc_contract_market_code!=='13874A'||row.futonly_or_combined!=='FutOnly')throw Error('CFTC contract/report mismatch');
  const date=String(row.report_date_as_yyyy_mm_dd).slice(0,10);
  const integer=k=>/^\d+$/.test(String(row[k]??''))?Number(row[k]):NaN;
  const long=integer('lev_money_positions_long'),short=integer('lev_money_positions_short'),openInterest=integer('open_interest_all');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||![long,short,openInterest].every(Number.isSafeInteger)||openInterest<=0||long>openInterest||short>openInterest)throw Error('Invalid CFTC observation');
  if(points.has(date))throw Error('Duplicate CFTC reporting date');
  const where=`cftc_contract_market_code='13874A' AND futonly_or_combined='FutOnly' AND report_date_as_yyyy_mm_dd='${date}T00:00:00.000'`;
  points.set(date,{date,long,short,openInterest,value:(long-short)/openInterest*100,sourceUrl:'https://publicreporting.cftc.gov/resource/gpe5-46if.json?'+new URLSearchParams({'$where':where})});
 }
 return [...points.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
const provenance=(label,url,status='fresh')=>({label,url,checkedAt,status});
export function mergeQuality(fresh,previous){
 for(const [code,q]of Object.entries(fresh.funds))for(const key of ['size','fees','premium','tracking']){
  const old=previous?.funds?.[code];
  if(!q[key]&&old?.[key]&&(!old[key].date||old[key].date<=fresh.date)){
   q[key]=old[key];q.provenance??={};
   if(old.provenance?.[key])q.provenance[key]={...old.provenance[key],status:'retained'};
  }
 }
 return fresh;
}
export async function enrichQuality(){
 const quality=JSON.parse(await readFile('data/etf-quality.json','utf8'));
 const universe=JSON.parse(await readFile('scripts/fund-universe.json','utf8'));
 await mkdir('data/source-audit/etf',{recursive:true});
 const pending=[...universe];
 await Promise.all(Array.from({length:4},async()=>{
  for(let fund=pending.shift();fund;fund=pending.shift()){
   const q=quality.funds[fund.code]??{size:null,fees:null,premium:null,tracking:null};q.provenance??={};
   const errors=[];
   for(const url of [fund.profile,`https://fundf10.eastmoney.com/jjfl_${fund.code}.html`])try{
    const p=profile(await source(url,'text'),fund.code,quality.date);
    for(const key of ['size','fees'])if(p[key]){q[key]=p[key];q.provenance[key]=provenance('天天基金 · 基金档案',url);}
    if(q.provenance.size?.status==='fresh'&&q.provenance.fees?.status==='fresh')break;
   }catch(e){errors.push(String(e));}
   // Missing tracking series are recalculated from the actual tracked index, never a sector proxy.
   if(!fund.crossBorder&&(!q.tracking||q.tracking.date!==quality.date))try{
    const start=new Date(Date.parse(quality.date)-200*86400000).toISOString().slice(0,10);
    const url='https://www.csindex.com.cn/csindex-home/perf/index-perf?'+new URLSearchParams({indexCode:fund.indexCode,startDate:start.replaceAll('-',''),endDate:quality.date.replaceAll('-','')});
    const data=await source(url);
    if(data.code!=='200'||!Array.isArray(data.data))throw Error('CSI schema');
    const bars=data.data.filter(r=>r.indexCode===fund.indexCode&&r.indexNameCnAll===fund.index&&/^\d{8}$/.test(r.tradeDate)).map(r=>({date:r.tradeDate.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),close:Number(r.close)})).filter(r=>r.date<=quality.date&&r.close>0).sort((a,b)=>a.date.localeCompare(b.date));
    const navUrl=`https://fund.eastmoney.com/pingzhongdata/${fund.code}.js`;
    const script=await source(navUrl,'text');if(script.match(/var fS_code\s*=\s*"(\d+)"/)?.[1]!==fund.code)throw Error('NAV identity mismatch');
    const rows=JSON.parse(script.match(/var Data_netWorthTrend\s*=\s*(\[[^;]+\]);/)?.[1]??'[]');
    const nav=new Map(rows.slice(-250).map(r=>[new Date(r.x+8*3600000).toISOString().slice(0,10),{nav:r.y,change:r.equityReturn}]));
    const calculated=tracking(bars,nav);if(!calculated||calculated.date!==quality.date)throw Error('Incomplete aligned tracking window');
    q.tracking=calculated;q.provenance.tracking=provenance('中证指数 · 原始日线',url);
    await writeFile(`data/source-audit/etf/${fund.code}.json`,JSON.stringify({code:fund.code,checkedAt,indexSource:url,navSource:navUrl,formula:'sample_sd(fund_total_return - index_price_return) * sqrt(252)',window:bars.slice(-61).map(b=>({...b,nav:nav.get(b.date)}))}));
   }catch(e){errors.push(String(e));}
   // Preserve source links for every reading, including fields supplied by the existing cloud API.
   const fallback={size:fund.profile,fees:fund.profile,premium:fund.nav,tracking:q.tracking?.indexSource==='tencent'?fund.rawIndex:fund.indexSource};
   for(const key of ['size','fees','premium','tracking'])if(q[key]&&!q.provenance[key])q.provenance[key]=provenance(key==='tracking'?'指数与基金净值':'原始数据',fallback[key]);
   q.checkedAt=checkedAt;quality.funds[fund.code]=q;
   if(errors.length)console.log(JSON.stringify({fund:fund.code,notes:errors}));
  }
 }));
 quality.checkedAt=checkedAt;
 await writeFile('data/etf-quality.json',JSON.stringify(quality));
 const coverage=Object.fromEntries(['size','fees','premium','tracking'].map(key=>[key,Object.values(quality.funds).filter(q=>q[key]).length]));
 console.log(JSON.stringify({qualityDate:quality.date,coverage}));return coverage;
}
export async function enrichCot(){
 const now=new Date(),start=`${now.getUTCFullYear()-5}-01-01T00:00:00.000`;
 const query=new URLSearchParams({'$where':`cftc_contract_market_code='13874A' AND futonly_or_combined='FutOnly' AND report_date_as_yyyy_mm_dd >= '${start}'`,'$select':'report_date_as_yyyy_mm_dd,cftc_contract_market_code,futonly_or_combined,open_interest_all,lev_money_positions_long,lev_money_positions_short,market_and_exchange_names','$order':'report_date_as_yyyy_mm_dd ASC','$limit':'500'});
 const url='https://publicreporting.cftc.gov/resource/gpe5-46if.json?'+query;
 const rows=await source(url),history=cotPoints(rows);
 if(history.length<200||Date.parse(history.at(-1).date)>Date.now())throw Error('Invalid CFTC coverage');
 await mkdir('data/market-history',{recursive:true});await mkdir('data/source-audit',{recursive:true});
 const data={history,checkedAt,asOf:history.at(-1).date,sourceUrl:url,sourceName:'CFTC 官方公开 API',contractCode:'13874A',reportType:'TFF Futures Only',dateBasis:'报告持仓日，非网页更新时间',formula:'(leveraged_money_long - leveraged_money_short) / open_interest * 100'};
 await writeFile('data/market-history/cot.json',JSON.stringify(data));await writeFile('data/source-audit/cftc.json',JSON.stringify({checkedAt,sourceUrl:url,rows}));
 console.log(JSON.stringify({cot:history.length,asOf:data.asOf,latest:history.at(-1)}));return data;
}
if(process.argv[1]?.endsWith('enrich-data.mjs')){
 const results=await Promise.allSettled([enrichQuality(),enrichCot()]);
 let status=JSON.parse(await readFile('data/status.json','utf8'));
 for(let i=0;i<results.length;i++){
  const route=i===0?'etf-quality':'market-history/cot',r=results[i];
  const old=status.results.find(x=>x.route===route);status.results=status.results.filter(x=>x.route!==route);
  status.results.push(r.status==='fulfilled'?{route,status:'updated',publishedAt:checkedAt,asOf:i===0?JSON.parse(await readFile('data/etf-quality.json','utf8')).date:r.value.asOf}:{...old,route,status:old?.publishedAt?'retained':'missing',error:String(r.reason)});
  if(r.status==='rejected'){console.error(route,String(r.reason));process.exitCode=1;}
 }
 await writeFile('data/status.json',JSON.stringify(status,null,2));
}
