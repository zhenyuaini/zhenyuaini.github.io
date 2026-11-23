"""Cross-check API observations against the CFTC's independent annual ZIP export."""
import csv
import hashlib
import io
import json
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

data = json.loads(Path('data/market-history/cot.json').read_text(encoding='utf-8'))
year = data['history'][-1]['date'][:4]
url = f'https://www.cftc.gov/files/dea/history/fut_fin_txt_{year}.zip'
request = urllib.request.Request(url, headers={'User-Agent': 'ZYResearch public-data verification'})
with urllib.request.urlopen(request, timeout=45) as response:
    archive = response.read()
with zipfile.ZipFile(io.BytesIO(archive)) as files:
    name = next(name for name in files.namelist() if name.lower().endswith('.txt'))
    rows = [{k.lower().strip(): v.strip() for k, v in row.items()}
            for row in csv.DictReader(io.StringIO(files.read(name).decode('utf-8-sig'))) ]
index = {row['report_date_as_yyyy-mm-dd']: row for row in rows
         if row['cftc_contract_market_code'] == '13874A'}
verified = []
for point in data['history']:
    if not point['date'].startswith(year):
        continue
    row = index.get(point['date'])
    if row is None:
        raise ValueError(f"Annual archive missing {point['date']}")
    for field, column in [('long', 'lev_money_positions_long_all'),
                          ('short', 'lev_money_positions_short_all'),
                          ('openInterest', 'open_interest_all')]:
        if point[field] != int(row[column]):
            raise ValueError(f"CFTC API/archive mismatch: {point['date']} {field}")
    verified.append(point['date'])
if data['history'][-1]['date'] not in verified or len(verified) < 1:
    raise ValueError('Latest CFTC observation was not independently verified')
audit = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'status': 'matched',
         'reportType': 'TFF Futures Only', 'contractCode': '13874A',
         'latestDate': verified[-1], 'matchedWeeks': len(verified),
         'archiveUrl': url, 'archiveSha256': hashlib.sha256(archive).hexdigest(),
         'apiSource': data['sourceUrl']}
Path('data/source-audit/cftc-crosscheck.json').write_text(json.dumps(audit), encoding='utf-8')
print(json.dumps(audit))
