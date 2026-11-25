import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;
const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; ZY Research Lab; https://zhenyuaini.github.io/about/)' };
const secHeaders = { 'User-Agent': 'Mozilla/5.0', From: 'zy-research-lab@users.noreply.github.com' };
const localDay = (date, timeZone = 'Asia/Shanghai') => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const offset = (day, days) => new Date(Date.parse(day + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
const asCurrency = n => (n / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' 亿美元';
const secUrl = (cik, accession, document) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${document}`;
const sourceKey = href => href.match(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\//)?.[0] ?? href;

async function load(url, options, decode) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return decode === 'json' ? response.json() : response.text();
}

export function selectFact(records, filing) {
  if (!Array.isArray(records)) return null;
  const valid = records.filter(row => row.accn === filing.accession && row.end === filing.end &&
    row.filed === filing.date && iso(row.start) && row.start < row.end && Number.isFinite(row.val) &&
    (Date.parse(row.end) - Date.parse(row.start)) / DAY <= 380)
    .sort((a, b) => filing.form === '10-K' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start));
  const row = valid.find(row => {
    const days = (Date.parse(row.end) - Date.parse(row.start)) / DAY + 1;
    return filing.form === '10-K' ? days >= 350 : days >= 75;
  });
  if (!row) return null;
  const days = (Date.parse(row.end) - Date.parse(row.start)) / DAY + 1;
  return { start: row.start, end: row.end, value: row.val, period: days <= 105 ? '单季' : days >= 350 ? '全年' : '财年累计' };
}

function secFilings(recent, cik, start, end) {
  if (!Array.isArray(recent?.filingDate) || recent.filingDate.length === 0) throw new Error('Empty filing index');
  return recent.filingDate.flatMap((date, i) => {
    const form = recent.form?.[i];
    const accession = recent.accessionNumber?.[i];
    const document = recent.primaryDocument?.[i];
    const periodEnd = recent.reportDate?.[i];
    const items = recent.items?.[i] || '';
    if (!iso(date) || date < start || date > end || !/^(10-Q|10-K|8-K)$/.test(form) ||
        !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^[a-z\d_.-]+\.html?$/i.test(document)) return [];
    if (form === '8-K' && !/(?:^|[,; ]+)(1\.01|1\.02|2\.01|2\.02|2\.03|2\.04|7\.01|8\.01)(?:$|[,; ]+)/.test(items)) return [];
    return [{ date, form, accession, end: periodEnd, title: form + (form === '8-K' ? ' · 事项 ' + items : ' 定期报告'),
      href: secUrl(cik, accession, form === '8-K' ? accession + '-index.htm' : document) }];
  }).slice(0, 12);
}

async function scanEdgarSearch(cik, start, end) {
  const endpoint = 'https://efts.sec.gov/LATEST/search-index?ciks=' + cik + '&forms=10-Q,10-K,8-K&startdt=' + start + '&enddt=' + end;
  const index = await load(endpoint, { headers: secHeaders }, 'json');
  if (index.timed_out || !Array.isArray(index.hits?.hits)) throw new Error('Invalid EDGAR search');
  const seen = new Set();
  return index.hits.hits.flatMap(hit => {
    const row = hit?._source;
    const [, document] = (hit?._id || '').split(':');
    if (!row?.ciks?.includes(cik) || !iso(row.file_date) || row.file_date < start || row.file_date > end ||
        !/^(10-Q|10-K|8-K)$/.test(row.form) || !/^\d{10}-\d{2}-\d{6}$/.test(row.adsh) ||
        !/^[a-z\d_.-]+\.html?$/i.test(document) || seen.has(row.adsh)) return [];
    if (row.form !== '8-K' && row.sequence !== 1) return [];
    seen.add(row.adsh);
    return [{ date: row.file_date, end: row.period_ending, accession: row.adsh, form: row.form, title: row.form + ' 公开申报',
      href: secUrl(cik, row.adsh, row.form === '8-K' ? row.adsh + '-index.htm' : document) }];
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
}

const tags = {
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  cash: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
};

async function scanSec(company, start, end) {
  const { cik, id } = company;
  let filings;
  let origin = 'SEC 近期申报目录';
  try {
    const index = await load('https://data.sec.gov/submissions/CIK' + cik + '.json?latest=1', { headers: secHeaders }, 'json');
    if (Number(index.cik) !== Number(cik)) throw new Error('Issuer mismatch');
    filings = secFilings(index.filings?.recent, cik, start, end);
  } catch (error) {
    try {
      filings = await scanEdgarSearch(cik, start, end);
      origin = 'SEC EDGAR 申报检索';
    } catch {
      return { id, status: '待核验', detail: `SEC 披露源不可用（${error.message}），保留旧证据。`, events: [] };
    }
  }

  const events = filings.map(({ date, title, href }) => ({ date, title, href }));
  const filing = filings.find(doc => doc.form !== '8-K');
  if (!filing) return { id, status: '已检索', detail: '已查 ' + origin + '。', events };
  try {
    const raw = await load('https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json', { headers: secHeaders }, 'json');
    if (Number(raw.cik) !== Number(cik)) throw new Error('Issuer mismatch');
    const us = raw.facts?.['us-gaap'] ?? {};
    const updates = {};
    for (const [key, candidates] of Object.entries(tags)) {
      const value = candidates.map(tag => selectFact(us[tag]?.units?.USD, filing)).find(Boolean);
      if (!value) continue;
      const label = key === 'capex' ? '集团固定资产购置现金支出 · 不含未付租赁' : '集团经营现金流 · 项目回款未单列';
      updates[key] = [{ text: asCurrency(value.value), kind: '实绩', date: filing.date,
        detail: `${value.start} 至 ${value.end} · ${value.period} · ${label}`, href: filing.href, label: 'SEC ' + filing.form }];
    }
    return { id, status: '已检索', detail: Object.keys(updates).length ? '已核对 SEC 报表现金流字段。其余公告内容待判读。' : '发现新财报，标准现金流字段未匹配。', events, updates };
  } catch {
    return { id, status: '部分覆盖', detail: '已查 SEC 申报列表。报表指标暂无法机器核对。', events };
  }
}

async function scanCn(company, start, end) {
  const { id, ticker, org } = company;
  try {
    const query = new URLSearchParams({
      pageNum: '1', pageSize: '50', column: 'szse', tabName: 'fulltext', plate: '',
      stock: ticker + ',' + org, seDate: start + '~' + end, searchkey: '',
      secid: '', category: '', trade: '', sortName: '', sortType: '', isHLtitle: 'false',
    });
    const result = await load('https://www.cninfo.com.cn/new/hisAnnouncement/query',
      { method: 'POST', body: query, headers: { ...headers, Referer: company.overview, Accept: 'application/json' } }, 'json');
    if (!Array.isArray(result.announcements) && result.totalAnnouncement !== 0) throw new Error('Invalid issuer index');
    const events = (result.announcements ?? []).flatMap(row => {
      const path = /^finalpage\/(\d{4}-\d{2}-\d{2})\/\d+\.pdf$/i.exec(row.adjunctUrl);
      const title = row.announcementTitle?.replace(/<[^>]*>/g, '').trim();
      if (row.secCode !== ticker || !path || path[1] < start || path[1] > end || !title ||
        !/报告(?:全文)?$|经营情况|投资者关系活动|投资者活动|订单|合同|项目|授信|融资|验收|投产|产能|回款|业绩|终止/i.test(title) ||
        /回购|理财|受托|股权激励|利润分配|法律意见书|审计|减持/.test(title)) return [];
      return [{ href: 'https://static.cninfo.com.cn/' + path[0], date: path[1], title }];
    }).slice(0, 12);
    return { id, status: '已检索', detail: '已查巨潮资讯公告目录。新公告正文待判读。', events };
  } catch (error) {
    return { id, status: '待核验', detail: `巨潮公告源不可用（${error.message}），保留旧证据。`, events: [] };
  }
}

async function priceHistory(symbol, now) {
  const dayNY = localDay(now, 'America/New_York');
  const noonNY = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit' }).format(now));
  const raw = await load('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1mo&interval=1d',
    { headers }, 'json');
  const row = raw.chart?.result?.[0];
  const closes = row?.indicators?.quote?.[0]?.close;
  if (row?.meta.symbol !== symbol || !Array.isArray(closes)) throw new Error('Invalid index');
  return new Map(row.timestamp.flatMap((date, index) => {
    const day = localDay(new Date(date * 1000), 'America/New_York');
    return Number.isFinite(closes[index]) && closes[index] > 0 && (day < dayNY || day === dayNY && noonNY >= 17) ? [[day, closes[index]]] : [];
  }));
}

async function fredPrices(id) {
  const csv = await load('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + id, {}, 'text');
  const [head, ...lines] = csv.trim().split(/\r?\n/);
  if (!/^(observation_date|DATE)$/.test(head.split(',')[0]) || head.split(',')[1] !== id) throw new Error('Invalid FRED series');
  return new Map(lines.flatMap(line => {
    const [date, value] = line.split(',');
    const close = Number(value);
    return iso(date) && Number.isFinite(close) && close > 0 ? [[date, close]] : [];
  }));
}

export function marketReturns(chips, broad, asOf) {
  const dates = [...chips.keys()].filter(date => broad.has(date) && date <= asOf).sort();
  const end = dates.at(-1);
  const start = dates.at(-11);
  if (!start || !end || end < offset(asOf, -5)) throw new Error('Insufficient or stale market data');
  const change = prices => Math.round((prices.get(end) / prices.get(start) - 1) * 10_000) / 100;
  return { start, end, sox: change(chips), broad: change(broad) };
}

async function marketData(now, asOf) {
  try {
    const [chips, broad] = await Promise.all(['NASDAQSOX', 'SP500'].map(fredPrices));
    return { ...marketReturns(chips, broad, asOf), soxUrl: 'https://fred.stlouisfed.org/series/NASDAQSOX',
      broadUrl: 'https://fred.stlouisfed.org/series/SP500' };
  } catch {
    const [chips, broad] = await Promise.all(['^SOX', '^GSPC'].map(symbol => priceHistory(symbol, now)));
    return { ...marketReturns(chips, broad, asOf), soxUrl: 'https://finance.yahoo.com/quote/%5ESOX/history/',
      broadUrl: 'https://finance.yahoo.com/quote/%5EGSPC/history/' };
  }
}

export function classify(companies, market, asOf) {
  const validSince = offset(asOf, -90);
  const evidence = companies.flatMap(company => (company.signals ?? []).flatMap(signal => {
    const source = company.sources[signal.source];
    if (!source || source[0] < validSince || source[0] > asOf || signal.resolved) return [];
    if (signal.kind === 'demand' && !signal.project) return [];
    return [{ name: company.name, kind: signal.kind, label: signal.label, date: source[0], href: source[2], project: signal.project }];
  }));
  const delays = new Set(evidence.filter(row => row.kind === 'delay').map(row => row.name)).size;
  const verifiedDemand = evidence.filter(row => row.kind === 'demand');
  const distinctOrders = new Map();
  for (const row of verifiedDemand) if (!distinctOrders.has(row.project)) distinctOrders.set(row.project, row.name);
  const demand = new Set(distinctOrders.values()).size;
  const marketPressure = Boolean(market && market.sox < 0 && market.sox - market.broad <= -3);
  const lead = demand >= 2 ? 'demand' : delays >= 1 ? 'delay' : marketPressure ? 'valuation' : 'unknown';
  return { lead, demand, delays, marketPressure, evidence };
}

async function readPrevious(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.history)) throw new Error('Unrecognized snapshot format');
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { history: [] };
  }
}

export async function update(baselineFile, outputFile, now = new Date()) {
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  if (baseline.version !== 1 || baseline.companies.length !== 8 || new Set(baseline.companies.map(c => c.id)).size !== 8) {
    throw new Error('Eight distinct issuers are required');
  }
  const previous = await readPrevious(outputFile);
  const asOf = localDay(now);
  // Include the prior cutoff day so late filings after the last run remain visible.
  const start = offset(asOf, -7);
  const [coverage, market] = await Promise.all([
    Promise.all(baseline.companies.map(company => company.cik ? scanSec(company, start, asOf) : scanCn(company, start, asOf))),
    marketData(now, asOf).catch(() => null),
  ]);
  // Carry the latest reported figures across weeks. Source dates stay unchanged.
  const priorMetrics = previous.history[0]?.metrics ?? {};
  const metrics = { ...priorMetrics };
  for (const company of coverage) {
    metrics[company.id] = { ...priorMetrics[company.id], ...company.updates };
    delete company.updates;
    const reviewed = Object.values(baseline.companies.find(row => row.id === company.id).sources);
    company.events = company.events.map(event => {
      const source = reviewed.find(source => sourceKey(source[2]) === sourceKey(event.href));
      return source ? { ...event, title: source[1], href: source[2], reviewed: true } : { ...event, reviewed: false };
    });
  }
  const snapshot = { asOf, start, checkedAt: now.toISOString(), coverage, market, metrics,
    signals: classify(baseline.companies, market, asOf) };
  const history = [snapshot, ...previous.history.filter(row => row.asOf !== asOf)].sort((a, b) => b.asOf.localeCompare(a.asOf)).slice(0, 26);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify({ version: 1, history }, null, 2) + '\n');
  console.log(JSON.stringify({ asOf, market, coverage: coverage.map(({ id, status, events }) => [id, status, events.length]), lead: snapshot.signals.lead }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? 'data';
  await update(root + '/ai-chain-baseline.json', root + '/ai-chain-weekly.json');
}
