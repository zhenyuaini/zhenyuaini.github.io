// Public reading edition uses document navigation on a static host.
window.addEventListener('click',event=>{const a=event.target.closest?.('a');if(!a||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||a.target==='_blank'||a.hasAttribute('download'))return;const url=new URL(a.href,location.href);if(url.origin===location.origin&&url.pathname!==location.pathname){event.preventDefault();event.stopImmediatePropagation();location.assign(url.href);}},true);
// Static hosting adapter. Public data only; credentials never enter the browser.
(()=>{
 const companion=document.createElement('link');companion.rel='stylesheet';companion.href='/public-overrides.css';document.head.append(companion);
 const nativeFetch=window.fetch.bind(window);
 const symbols=['sh000001','sh000300','sz399006','sh000688','sh000905','hkHSTECH','usIXIC','sh688008','sh603986','sz300308','sz300394','sz002409','sh688766','sz000636','sh600183'];
 const routes=new Set(['market-quotes','etf-rotation','watchlist-daily','etf-quality','turnover-estimate','turnover-signal-log','publish-weekly-review',...symbols.slice(0,7).map(s=>'index-candles/'+s),...['vix','cot','sp500'].map(s=>'market-history/'+s)]);
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
 let inFlight,lastQuote,lastAt=0,quoteMode='';
 const clock=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'});
 function updateStatus(text){const el=document.getElementById('public-data-status');if(el)el.textContent=text;}
 async function snapshot(route,options={}){
  const r=await nativeFetch('/data/'+route+'.json?v='+Math.floor(Date.now()/60000),options);
  if(!r.ok)throw Error('数据尚未发布');
  const data=await r.json();if(data.error)throw Error(data.error);return data;
 }
 function liveQuotes(){
  if(lastQuote&&Date.now()-lastAt<45000)return Promise.resolve(lastQuote);
  if(inFlight)return inFlight;
  inFlight=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.charset='gb18030';script.referrerPolicy='no-referrer';
   const finish=()=>{clearTimeout(timer);script.remove();};
   const timer=setTimeout(()=>{finish();reject(Error('报价源超时'));},10000);
   for(const symbol of symbols)delete window['v_'+symbol];
   script.onerror=()=>{finish();reject(Error('报价源不可用'));};
   script.onload=async()=>{
    finish();
    try{
     const quotes={};
     const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'});
     for(const symbol of symbols){
      const f=String(window['v_'+symbol]??'').split('~');
      const ts=f[30]?.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2}) ?(\d{2}):?(\d{2}):?(\d{2})$/);
      if(!ts||f[2]?.replace(/^\./,'')!==symbol.slice(2)||!(Number(f[3])>0))continue;
      const [,y,m,d,h,mi,se]=ts;const local=`${y}-${m}-${d}T${h}:${mi}:${se}`;
      const offset=symbol.startsWith('us')?ny.formatToParts(new Date(local+'Z')).find(p=>p.type==='timeZoneName')?.value.slice(3):'+08:00';
      if(!offset||!Number.isFinite(Date.parse(local+offset)))continue;
      const amount=symbol==='hkHSTECH'?Number(f[37])*10000:Number(f[35]?.split('/')[2]);
      quotes[symbol]={price:Number(f[3]),changePercent:f[32]?.trim()&&Number.isFinite(Number(f[32]))?Number(f[32]):null,turnover:amount>0?amount:null,quotedAt:local+offset};
     }
     if(!Object.keys(quotes).length)throw Error('报价格式异常');
     // Retain a previous-day comparison only when its date matches the quote.
     try{const saved=await snapshot('market-quotes');for(const [symbol,q]of Object.entries(quotes)){
      const old=saved.quotes?.[symbol];if(!old)continue;
      const date=q.quotedAt.slice(0,10),oldDate=old.quotedAt.slice(0,10);
      if(oldDate===date&&old.previousDate<date&&old.previousTurnover>0){q.previousDate=old.previousDate;q.previousTurnover=old.previousTurnover;}
      else if(oldDate<date&&old.turnover>0){q.previousDate=oldDate;q.previousTurnover=old.turnover;}
     }}catch{}
     quoteMode='live';lastAt=Date.now();lastQuote={quotes};
     updateStatus('免费行情 · 每分钟请求 · 来源报价可能延迟 · 最近读取 '+clock.format(lastAt));
     resolve(lastQuote);
    }catch(error){reject(error);}
   };
   script.src='https://qt.gtimg.cn/q='+symbols.join(',')+'&_='+Date.now();document.head.append(script);
  }).finally(()=>{inFlight=null;});return inFlight;
 }
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url??String(input),location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(input,options);
  const route=url.pathname.slice(5).replace(/\/$/,'');
  if(!routes.has(route)||(options.method??input?.method??'GET').toUpperCase()!=='GET')return json({error:'公开站点不提供此接口'},404);
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  try{
   let data;
   if(route==='market-quotes'){
    try{data=await liveQuotes();}catch{data=await snapshot(route,options);quoteMode='archive';updateStatus('报价源暂不可用 · 展示云端存档，数据日期以数字旁标注为准');}
   }else data=await snapshot(route,options);
   if(route==='etf-quality'&&url.searchParams.get('date')&&data.date!==url.searchParams.get('date'))return json({error:'对应日期的 ETF 质量数据待更新'},503);
   if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
   return json(data);
  }catch(error){if(error.name==='AbortError')throw error;return json({error:'数据暂不可用，等待云端发布'},503);}
 };
 function mountStatus(){
  if(location.pathname.startsWith('/research/handbook'))return;
  if(document.getElementById('public-data-status'))return;
  const el=document.createElement('div');el.id='public-data-status';el.setAttribute('role','status');el.style.cssText='padding:8px 18px;background:#edf3f8;color:#425e76;font:12px/1.7 system-ui;text-align:center';
  el.textContent='免费云端数据 · 行情每分钟请求 · 日线与 ETF 收盘后更新 · 数据日期见各模块';document.body.prepend(el);
  snapshot('status').then(s=>{if(!quoteMode)updateStatus('免费云端数据 · 最近发布核对 '+clock.format(new Date(s.checkedAt))+' · 数据日期与缺失项见各模块');}).catch(()=>updateStatus('云端发布状态暂不可用 · 请按各模块数据日期判断'));
 }
 document.addEventListener('DOMContentLoaded',()=>{setTimeout(mountStatus,2500);setInterval(mountStatus,60000);});
})();
