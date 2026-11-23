const urls=[
'https://publicreporting.cftc.gov/resource/gpe5-46if.json?$where=cftc_contract_market_code=%2713874A%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=2',
'https://www.cftc.gov/files/dea/history/fut_fin_txt_2026.zip',
'https://fundf10.eastmoney.com/jbgk_512800.html',
'https://fundf10.eastmoney.com/jbgk_515880.html',
'https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=930713&startDate=20260801&endDate=20261123',
'https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=931160&startDate=20260801&endDate=20261123'
];await Promise.all(urls.map(async url=>{try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(35000)});const s=await r.text();console.log(JSON.stringify({url,status:r.status,bytes:s.length,preview:url.includes('resource/')?s.slice(0,6500):s.slice(0,150)}));}catch(e){console.log(JSON.stringify({url,error:e.message}));}}));