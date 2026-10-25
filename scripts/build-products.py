#!/usr/bin/env python3
"""Builds the regional supermarket product index (public.products) from the
Open Food Facts export, one market at a time: 'de' (Germany, Austria,
Switzerland), 'gb' (United Kingdom), 'us' (United States).

Source: Open Food Facts product database (ODbL 1.0, https://openfoodfacts.org),
the official Parquet export on Hugging Face (openfoodfacts/product-database,
food.parquet). Only the needed columns are read: the file is streamed in
windows of whole row groups, so the 7.9 GB file never sits on disk whole.

The output is a derivative database under ODbL: keep the attribution in
THIRD_PARTY_NOTICES.md and offer the built file on request.

Usage (writes OUTSIDE the repository; nothing here is committed):
  pip install --user duckdb pyarrow
  python3 scripts/build-products.py --out-dir /path/to/scratch/offdata --market gb
  python3 scripts/build-products.py --out-dir DIR --market us --sample 20000   # test sample

Stage 1 caches the projected rows of every market (DE/AT/CH/GB/US) once as
<out-dir>/off-markets-raw.parquet (delete it to refresh from the export).
Stage 2 writes <out-dir>/products-<market>.ndjson.gz and .stats.json.

Each row: market, code, name, brand, brands[], stores[] (canonical chain keys
per market, e.g. "tesco", "sainsburys", "walmart", plus the raw OFF slugs),
basis ('g' | 'ml': whether the per-100 values are per 100 g or per 100 ml —
ml is never treated as g), package_g, package_ml, serving_g, kcal, protein,
carbs, sugars, fat, sat_fat, fiber, salt (per 100 g or ml), category,
nutriscore, popularity, last_modified.
"""
import argparse, collections, gzip, html, json, math, os, pathlib, re, sys, time

DEFAULT_SOURCE = 'https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet'
# Region 'de' serves Germany, Austria and Switzerland (owner decision 2026-10-25).
MARKETS = {
    'de': {'countries': ['en:germany', 'en:austria', 'en:switzerland'], 'names': ('name_de', 'name_main', 'name_en')},
    'gb': {'countries': ['en:united-kingdom'], 'names': ('name_en', 'name_main')},
    'us': {'countries': ['en:united-states'], 'names': ('name_en', 'name_main')},
}
# GS1 prefixes of the market's own barcodes (13-digit form). Scan counts are
# worldwide: a Moroccan water also tagged "United States" has thousands of
# scans from Morocco. Outside DE, a product with a foreign prefix keeps a tenth
# of its scan count for ranking (it stays in the index).
LOCAL_PREFIX = {'gb': ('50',), 'us': tuple(f'{n:03d}' for n in range(0, 140))}
ALL_COUNTRIES = sorted({c for market in MARKETS.values() for c in market['countries']})
NUTRIENTS = {
    'kcal': 'energy-kcal', 'kj': 'energy', 'protein': 'proteins', 'carbs': 'carbohydrates', 'sugars': 'sugars',
    'fat': 'fat', 'sat_fat': 'saturated-fat', 'fiber': 'fiber', 'salt': 'salt', 'polyols': 'polyols', 'alcohol': 'alcohol',
}
VOLUME_UNITS = {'ml', 'l', 'cl', 'dl'}


def resolve_source(source):
    """Hugging Face allows 3000 /resolve/ requests per 5 minutes per client, and
    DuckDB issues one per column-chunk range. Resolve the redirect once and read
    the signed CDN URL, which is not counted against that quota."""
    if not source.startswith('https://huggingface.co/'):
        return source
    import subprocess
    head = subprocess.run(['curl', '-sI', '-A', 'Kandro/1.0 (getkandro.com)', source], capture_output=True, text=True, timeout=60).stdout
    status = head.split(' ', 2)[1] if head.startswith('HTTP') else ''
    location = re.search(r'^location:\s*(\S+)', head, re.I | re.M)
    if status in ('301', '302', '303', '307', '308') and location:
        return location.group(1)
    sys.exit(f'Could not resolve {source} (HTTP {status or "?"}); Hugging Face may be rate limiting, retry in 5 minutes.')


PROJECTED = ['code', 'product_name', 'lang', 'brands', 'stores_tags', 'countries_tags', 'quantity', 'product_quantity',
             'product_quantity_unit', 'serving_quantity', 'serving_size', 'nutrition_data_per', 'categories_tags',
             'nutriscore_grade', 'last_modified_t', 'unique_scans_n', 'obsolete', 'nutriments']


def select_sql(table):
    nutrient_cols = ',\n'.join(
        f"list_filter(nutriments, x -> x.name = '{name}')[1].\"100g\" as n_{key}" for key, name in NUTRIENTS.items())
    countries = ', '.join(f"'{c}'" for c in ALL_COUNTRIES)
    return f"""
        select code,
               list_filter(product_name, x -> x.lang = 'de')[1].text as name_de,
               list_filter(product_name, x -> x.lang = 'main')[1].text as name_main,
               list_filter(product_name, x -> x.lang = 'en')[1].text as name_en,
               lang, brands, stores_tags, countries_tags, quantity, product_quantity, product_quantity_unit,
               serving_quantity, serving_size, nutrition_data_per, categories_tags, nutriscore_grade,
               last_modified_t, unique_scans_n,
               {nutrient_cols}
        from {table}
        where list_has_any(countries_tags, [{countries}])
          and coalesce(obsolete, false) = false
          and nutriments is not null"""


def curl_range(url, start, end, out):
    import subprocess
    for attempt in range(5):
        out.seek(start)
        with subprocess.Popen(['curl', '-sfL', '--retry', '3', '-r', f'{start}-{end}', url], stdout=subprocess.PIPE) as proc:
            written = 0
            while chunk := proc.stdout.read(1 << 20):
                out.write(chunk)
                written += len(chunk)
        if proc.returncode == 0 and written == end - start + 1:
            return
        time.sleep(5 * (attempt + 1))
    sys.exit(f'download of bytes {start}-{end} failed')


def extract_streamed(url, raw_path, window_bytes=512 << 20):
    """Reads the remote file front to back in windows of whole row groups:
    one sequential range request per window (~20 MB/s instead of thousands of
    small column-chunk requests), written into a sparse scratch file next to
    the footer, filtered with DuckDB, then deleted. Peak disk ≈ one window."""
    import duckdb, pyarrow as pa, pyarrow.parquet as pq, subprocess
    size = int(re.search(r'^content-length:\s*(\d+)', subprocess.run(
        ['curl', '-sI', url], capture_output=True, text=True).stdout, re.I | re.M).group(1))
    scratch = str(raw_path) + '.window'
    with open(scratch, 'wb') as out:
        out.truncate(size)
        curl_range(url, size - 8, size - 1, out)
    with open(scratch, 'rb') as handle:
        handle.seek(size - 8)
        footer_len = int.from_bytes(handle.read(4), 'little')
    footer_start = size - 8 - footer_len
    with open(scratch, 'r+b') as out:
        curl_range(url, footer_start, size - 9, out)
    with open(scratch, 'rb') as handle:
        handle.seek(footer_start)
        footer = handle.read()
    meta = pq.ParquetFile(scratch).metadata

    def span(rg):
        group = meta.row_group(rg)
        columns = [group.column(i) for i in range(group.num_columns)]
        starts = [min(c.dictionary_page_offset or c.data_page_offset, c.data_page_offset) for c in columns]
        return min(starts), max(start + c.total_compressed_size for start, c in zip(starts, columns))

    con = duckdb.connect()
    writer = None
    tmp = str(raw_path) + '.part'
    rg, kept, started = 0, 0, time.time()
    while rg < meta.num_row_groups:
        first = rg
        lo, hi = span(rg)
        rg += 1
        while rg < meta.num_row_groups and span(rg)[1] - lo <= window_bytes:
            hi = max(hi, span(rg)[1])
            rg += 1
        with open(scratch, 'wb') as out:  # fresh sparse file: footer + this window only
            out.truncate(size)
        with open(scratch, 'r+b') as out:
            out.seek(footer_start)
            out.write(footer)
            curl_range(url, lo, min(hi, footer_start) - 1, out)
        table = pq.ParquetFile(scratch).read_row_groups(list(range(first, rg)), columns=PROJECTED)
        con.register('window_rows', table)
        batch = con.execute(select_sql('window_rows')).arrow()
        if hasattr(batch, 'read_all'):
            batch = batch.read_all()
        con.unregister('window_rows')
        if writer is None:
            writer = pq.ParquetWriter(tmp, batch.schema, compression='zstd')
        writer.write_table(batch.cast(writer.schema))
        kept += batch.num_rows
        print(f'extract: row groups {rg}/{meta.num_row_groups}, {kept} rows kept, {hi / size:.0%} read, '
              f'{time.time() - started:.0f}s', file=sys.stderr, flush=True)
    writer.close()
    os.remove(scratch)
    os.replace(tmp, raw_path)


# Leaf columns stage 1 needs. Only these column chunks are downloaded
# (~0.55 GB of the 7.9 GB file): nutriments keeps just name and per-100 g.
LEAVES = ['code', 'product_name.list.element.lang', 'product_name.list.element.text', 'lang', 'brands',
          'stores_tags.list.element', 'countries_tags.list.element', 'quantity', 'product_quantity', 'product_quantity_unit',
          'serving_quantity', 'serving_size', 'nutrition_data_per', 'categories_tags.list.element', 'nutriscore_grade',
          'last_modified_t', 'unique_scans_n', 'obsolete', 'nutriments.list.element.name', 'nutriments.list.element.100g']


def fetch_ranges(source, ranges, out, label, workers=16):
    """Downloads [start, end) byte ranges into the sparse file `out` at their
    own offsets: parallel keep-alive HTTPS connections (one TLS handshake per
    worker, not per range), neighbouring ranges (gap < 64 KB) merged into one
    request. Finished ranges are journalled next to `out`, so a rerun resumes.
    An expired signed URL (HTTP 403) is resolved again. Retries each range;
    exits when one keeps failing."""
    import concurrent.futures, http.client, ssl, threading, urllib.parse
    merged = []
    for start, end in sorted(ranges):
        if merged and start - merged[-1][1] < 65536:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    journal_path = f'{out.name}.{label.replace(" ", "")}.done'
    finished = set()
    if os.path.exists(journal_path):
        finished = {int(line) for line in open(journal_path) if line.strip().isdigit()}
    merged = [span for span in merged if span[0] not in finished]
    journal = open(journal_path, 'a')
    state = {'url': resolve_source(source)}

    def split(url):
        parts = urllib.parse.urlsplit(url)
        return parts, parts.path + (f'?{parts.query}' if parts.query else '')
    # python.org builds of Python ship without CA roots; macOS and Linux keep them here.
    cafile = next((path for path in ('/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt') if os.path.exists(path)), None)
    context = ssl.create_default_context(cafile=cafile)
    local = threading.local()
    lock = threading.Lock()
    done = [0, 0]
    total = sum(end - start for start, end in merged)
    started = time.time()

    def one(span):
        start, end = span
        last = None
        for attempt in range(6):
            try:
                parts, target = split(state['url'])
                if getattr(local, 'connection', None) is None or local.host != parts.hostname:
                    local.connection = http.client.HTTPSConnection(parts.hostname, parts.port or 443, context=context, timeout=120)
                    local.host = parts.hostname
                local.connection.request('GET', target, headers={'Range': f'bytes={start}-{end - 1}', 'User-Agent': 'Kandro/1.0 (getkandro.com)'})
                response = local.connection.getresponse()
                body = response.read()
                if response.status in (401, 403):
                    with lock:
                        state['url'] = resolve_source(source)
                if response.status != 206 or len(body) != end - start:
                    raise IOError(f'HTTP {response.status}, {len(body)} of {end - start} bytes')
                with lock:
                    out.seek(start)
                    out.write(body)
                    journal.write(f'{start}\n')
                    journal.flush()
                    done[0] += 1
                    done[1] += len(body)
                    if done[0] % 500 == 0 or done[0] == len(merged):
                        print(f'{label}: {done[0]}/{len(merged)} requests, {done[1] / 1e6:.0f}/{total / 1e6:.0f} MB, '
                              f'{time.time() - started:.0f}s', file=sys.stderr, flush=True)
                return
            except Exception as error:  # noqa: BLE001 - network errors are retried on a fresh connection
                last = error
                try:
                    local.connection.close()
                except Exception:  # noqa: BLE001
                    pass
                local.connection = None
                time.sleep(2 * (attempt + 1))
        sys.exit(f'{label}: bytes {start}-{end} failed: {last}')

    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, merged))
    out.flush()
    journal.close()


def extract_columns(source, raw_path):
    """Two passes over the remote file, column chunks only. Pass 1 reads
    countries_tags of every row group and keeps the groups that hold any
    product of a served market; pass 2 reads the LEAVES of those groups. The
    chunks are written into a sparse file at their real offsets (so pyarrow
    reads it like the original), filtered with DuckDB, then deleted."""
    import duckdb, pyarrow.parquet as pq, subprocess
    url = resolve_source(source)
    size = int(re.search(r'^content-length:\s*(\d+)', subprocess.run(
        ['curl', '-sI', url], capture_output=True, text=True).stdout, re.I | re.M).group(1))
    scratch = str(raw_path) + '.sparse'
    # A rerun after an interruption keeps the downloaded footer.
    resumed = os.path.exists(scratch) and os.path.getsize(scratch) == size
    if resumed:
        with open(scratch, 'rb') as handle:
            handle.seek(size - 4)
            resumed = handle.read(4) == b'PAR1'
    if not resumed:
        with open(scratch, 'wb') as out:
            out.truncate(size)
            curl_range(url, size - 8, size - 1, out)
    with open(scratch, 'rb') as handle:
        handle.seek(size - 8)
        footer_len = int.from_bytes(handle.read(4), 'little')
    if not resumed:
        with open(scratch, 'r+b') as out:
            curl_range(url, size - 8 - footer_len, size - 9, out)
    meta = pq.ParquetFile(scratch).metadata

    def chunks(rg, wanted):
        group = meta.row_group(rg)
        for i in range(group.num_columns):
            column = group.column(i)
            if column.path_in_schema in wanted:
                start = min(column.dictionary_page_offset or column.data_page_offset, column.data_page_offset)
                yield start, start + column.total_compressed_size

    groups = range(meta.num_row_groups)
    with open(scratch, 'r+b') as out:
        fetch_ranges(source, [span for rg in groups for span in chunks(rg, {'countries_tags.list.element'})], out, 'pass 1')
    parquet = pq.ParquetFile(scratch)
    wanted = set(ALL_COUNTRIES)
    keep = [rg for rg in groups
            if any(tag in wanted for tags in parquet.read_row_group(rg, columns=['countries_tags']).column(0).to_pylist() for tag in tags or [])]
    print(f'pass 1: {len(keep)}/{meta.num_row_groups} row groups hold DE/AT/CH/GB/US products', file=sys.stderr, flush=True)
    with open(scratch, 'r+b') as out:
        fetch_ranges(source, [span for rg in keep for span in chunks(rg, set(LEAVES))], out, 'pass 2')
    parquet = pq.ParquetFile(scratch)
    con = duckdb.connect()
    writer = None
    tmp = str(raw_path) + '.part'
    for index in range(0, len(keep), 200):
        table = parquet.read_row_groups(keep[index:index + 200], columns=LEAVES)
        con.register('window_rows', table)
        batch = con.execute(select_sql('window_rows')).arrow()
        if hasattr(batch, 'read_all'):
            batch = batch.read_all()
        con.unregister('window_rows')
        if writer is None:
            writer = pq.ParquetWriter(tmp, batch.schema, compression='zstd')
        writer.write_table(batch.cast(writer.schema))
    writer.close()
    os.remove(scratch)
    for journal in pathlib.Path(scratch).parent.glob(pathlib.Path(scratch).name + '.*.done'):
        journal.unlink()
    os.replace(tmp, raw_path)


def extract(source, raw_path, stream_windows=False):
    import duckdb  # noqa: imported lazily so --help works without it
    started = time.time()
    if source.startswith('http'):
        # Whole-file windows are faster on a fast line; column chunks move a
        # fifteenth of the bytes and suit a slow or shared one (the default).
        if stream_windows:
            extract_streamed(resolve_source(source), raw_path)
        else:
            extract_columns(source, raw_path)
    else:
        tmp = str(raw_path) + '.part'
        table = "read_parquet('" + source.replace("'", "''") + "')"
        duckdb.connect().execute(f"copy ({select_sql(table)}) to '{tmp}' (format parquet, compression zstd)")
        os.replace(tmp, raw_path)
    print(f'extract: {raw_path} in {time.time() - started:.0f}s', file=sys.stderr)


def unescape_html(value):
    # Open Food Facts stores some names HTML-escaped, a few several times over.
    text = str(value or '')
    for _ in range(4):
        decoded = html.unescape(text)
        if decoded == text:
            break
        text = decoded
    return text


def clean_text(value, limit):
    text = re.sub(r'\s+', ' ', unescape_html(value)).strip()
    return text if 2 <= len(text) <= limit else None


def num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def r1(value):
    return None if value is None else round(value, 1)


def mass_basis(row):
    """Mirrors supabase/functions/_shared/off-product.mjs offMassNutrition."""
    basis = str(row['nutrition_data_per'] or '').lower()
    unit = str(row['product_quantity_unit'] or '').lower()
    quantity = str(row['quantity'] or '')
    if re.search(r'ml|\bl\b', basis) or unit in VOLUME_UNITS or re.search(r'\d\s*(ml|cl|dl|l)\b', quantity, re.I):
        return 'ml'
    # US labels: "12 fl oz", "64 FL. OZ (1.89 L)" is a volume, never grams.
    if re.search(r'\d\s*fl\.?\s*oz\b', quantity, re.I):
        return 'ml'
    return 'g'


def package_amounts(row):
    unit = str(row['product_quantity_unit'] or '').lower()
    amount = num(row['product_quantity'])
    quantity = str(row['quantity'] or '')
    if amount is None or not (1 <= amount <= 25000):
        return None, None
    if unit == 'g' or (not unit and re.search(r'\d(?:[.,]\d+)?\s*(g|kg)\b', quantity, re.I)):
        return r1(amount), None
    if unit == 'ml' or (not unit and re.search(r'\d(?:[.,]\d+)?\s*(ml|l|cl)\b', quantity, re.I)):
        return None, r1(amount)
    return None, None


def serving_grams(row):
    label = str(row['serving_size'] or '')
    if not re.search(r'\d(?:[.,]\d+)?\s*g\b', label, re.I) or re.search(r'\d\s*(ml|cl|dl|l)\b|fl\.?\s*oz', label, re.I):
        return None
    grams = num(row['serving_quantity'])
    return r1(grams) if grams is not None and 1 <= grams <= 2000 else None


def split_brands(raw):
    out, seen = [], set()
    for part in unescape_html(raw).split(','):
        brand = re.sub(r'\s+', ' ', part).strip()
        key = brand.lower()
        if brand and len(brand) <= 60 and key not in seen:
            seen.add(key)
            out.append(brand)
    return out[:8]


def plausible(n):
    """Physical bounds plus an Atwater energy check; rejects broken records."""
    for key in ('protein', 'carbs', 'fat', 'sugars', 'sat_fat', 'fiber', 'salt', 'polyols', 'alcohol'):
        if n[key] is not None and not (0 <= n[key] <= 100):
            return 'range'
    if not (0 <= n['kcal'] <= 950):
        return 'range'
    if n['sugars'] is not None and n['sugars'] > n['carbs'] + 0.5:
        return 'sugar_gt_carbs'
    if n['sat_fat'] is not None and n['sat_fat'] > n['fat'] + 0.5:
        return 'satfat_gt_fat'
    if n['protein'] + n['carbs'] + n['fat'] + (n['fiber'] or 0) + (n['salt'] or 0) > 105:
        return 'mass_gt_100'
    simple = 4 * n['protein'] + 4 * n['carbs'] + 9 * n['fat']
    polyols = min(n['polyols'] or 0, n['carbs'])
    # EU labels: fibre 2 kcal/g, polyols 2.4 kcal/g, alcohol 7 kcal/g.
    eu = 4 * n['protein'] + 4 * (n['carbs'] - polyols) + 2.4 * polyols + 9 * n['fat'] + 2 * (n['fiber'] or 0) + 7 * (n['alcohol'] or 0)
    tolerance = 0.15 * n['kcal'] + 10
    if abs(n['kcal'] - simple) > tolerance and abs(n['kcal'] - eu) > tolerance:
        return 'atwater'
    return None


CHAINS = ('aldi', 'lidl', 'rewe', 'edeka', 'kaufland', 'penny', 'netto', 'dm', 'rossmann', 'norma', 'globus', 'tegut', 'real', 'spar', 'billa', 'hofer', 'migros', 'coop')
FOLD = str.maketrans('äöüàáâãåèéêëìíîïòóôõøùúûýÿñç', 'aouaaaaaeeeeiiiiooooouuuyync')


# Canonical store keys per market (public.product_store_words → store): OFF
# slugs of the chain (and its formats) → the key the rpc filters on.
STORE_KEYS = {
    'de': {},
    'gb': {'tesco': 'tesco', 'sainsbury': 'sainsburys', 'asda': 'asda', 'morrisons': 'morrisons', 'marks-spencer': 'ms',
           'marks-and-spencer': 'ms', 'm-s': 'ms', 'waitrose': 'waitrose', 'co-op': 'coop', 'coop': 'coop', 'the-co-operative': 'coop',
           'co-operative': 'coop', 'aldi': 'aldi', 'lidl': 'lidl', 'iceland': 'iceland'},
    'us': {'walmart': 'walmart', 'wal-mart': 'walmart', 'costco': 'costco', 'trader-joe': 'traderjoes', 'whole-foods': 'wholefoods',
           'target': 'target', 'super-target': 'target', 'kroger': 'kroger', 'aldi': 'aldi', 'safeway': 'safeway', 'albertsons': 'albertsons',
           'sam-s-club': 'samsclub', 'sams-club': 'samsclub', 'wegmans': 'wegmans', 'meijer': 'meijer', 'h-e-b': 'heb', 'heb': 'heb', 'publix': 'publix'},
}


def normalize_stores(tags, market='de'):
    """OFF store tags are not uniformly normalised ("Lidl", "lidl", "aldi-sud",
    "sainsbury-s", "trader-joe-s"). Fold like private.product_fold, hyphenate,
    add the chain for branches ("aldi-sud" → also "aldi") and the market's
    canonical key ("sainsbury-s-local" → "sainsburys"), so a store filter
    matches every spelling."""
    out = set()
    keys = STORE_KEYS[market]
    for tag in tags or []:
        slug = re.sub(r'[^a-z0-9]+', '-', str(tag).split(':')[-1].lower().replace('ß', 'ss').translate(FOLD)).strip('-')[:40]
        if not slug:
            continue
        canonical = next((key for prefix, key in keys.items() if slug == prefix or slug.startswith(prefix + '-')), None)
        if canonical:
            out.add(canonical)
        chain = slug.split('-')[0]
        if market == 'de' and chain in CHAINS:
            out.add(chain)
        out.add(slug)
    # Canonical keys first, so the cap of ten never drops them.
    ordered = sorted(out, key=lambda store: (store not in set(keys.values()) and store not in CHAINS, store))
    return ordered[:10]


def tidy_caps(text):
    """US/UK records imported from retailer feeds are often in capitals
    ("GREAT VALUE WHOLE MILK"); shown as "Great Value Whole Milk". Mixed case
    and short brand marks ("M&S", "365") stay as written."""
    if not text or len(text) <= 4 or text != text.upper() or not re.search(r'[A-Z]{3}', text):
        return text
    return re.sub(r"(^|[\s\-/(&])([a-z])", lambda m: m.group(1) + m.group(2).upper(), text.lower())


def local_popularity(market, code, scans):
    prefixes = LOCAL_PREFIX.get(market)
    if not prefixes:
        return scans
    # 8 digits: UPC-E (US, leading 0/1) or EAN-8 (prefix as written).
    local = code[0] in '01' if market == 'us' and len(code) == 8 else code.zfill(13).startswith(prefixes) if len(code) > 8 else code.startswith(prefixes)
    if local:
        return scans
    return scans // 10


def main_category(tags):
    english = [t for t in (tags or []) if isinstance(t, str) and t.startswith('en:') and t not in ('en:null', 'en:undefined')]
    return english[-1][3:].replace('-', ' ')[:60] if english else None


def transform(raw_path, out_dir, market, sample):
    import duckdb
    con = duckdb.connect()
    config = MARKETS[market]
    wanted = ', '.join(f"'{c}'" for c in config['countries'])
    query = f"select * from read_parquet('{raw_path}') where list_has_any(countries_tags, [{wanted}])"
    if sample:
        # Deterministic: the most-scanned products first, like real searches.
        query += f' order by coalesce(unique_scans_n, 0) desc, code limit {int(sample)}'
    cursor = con.execute(query)
    columns = [d[0] for d in cursor.description]
    rejected = collections.Counter()
    brands = collections.Counter()
    stores = collections.Counter()
    kept = with_stores = ml_rows = 0
    seen_codes = set()
    suffix = f'-sample{sample}' if sample else ''
    out_path = pathlib.Path(out_dir) / f'products-{market}{suffix}.ndjson.gz'
    tmp = str(out_path) + '.part'
    with gzip.open(tmp, 'wt', encoding='utf-8', compresslevel=9) as out:
        while True:
            chunk = cursor.fetchmany(20000)
            if not chunk:
                break
            for values in chunk:
                row = dict(zip(columns, values))
                code = str(row['code'] or '')
                if not re.fullmatch(r'\d{7,14}', code):
                    rejected['code'] += 1; continue
                if code in seen_codes:
                    rejected['duplicate'] += 1; continue
                # UK/US shelves are labelled in English; a record with neither an
                # English name nor English as its main language is mostly a
                # foreign product tagged with many countries (scans abroad).
                if market != 'de' and not row['name_en'] and row['lang'] != 'en':
                    rejected['not_english'] += 1; continue
                name = next(filter(None, (clean_text(row[field], 130) for field in config['names'])), None)
                if name and market != 'de':
                    name = tidy_caps(name)
                if not name:
                    rejected['name'] += 1; continue
                n = {key: num(row[f'n_{key}']) for key in NUTRIENTS}
                if n['kcal'] is None and n['kj'] is not None:
                    n['kcal'] = n['kj'] / 4.184
                if any(n[key] is None for key in ('kcal', 'protein', 'carbs', 'fat')):
                    rejected['nutrition_missing'] += 1; continue
                reason = plausible(n)
                if reason:
                    rejected[reason] += 1; continue
                brand_list = split_brands(row['brands'])
                if market != 'de':
                    brand_list = [tidy_caps(brand) for brand in brand_list]
                store_list = normalize_stores(row['stores_tags'], market)
                package_g, package_ml = package_amounts(row)
                basis = mass_basis(row)
                record = {
                    'market': market, 'code': code, 'name': name, 'brand': brand_list[0] if brand_list else None, 'brands': brand_list,
                    'stores': store_list, 'basis': basis, 'package_g': package_g, 'package_ml': package_ml,
                    'serving_g': serving_grams(row) if basis == 'g' else None,
                    'kcal': r1(n['kcal']), 'protein': r1(n['protein']), 'carbs': r1(n['carbs']), 'sugars': r1(n['sugars']),
                    'fat': r1(n['fat']), 'sat_fat': r1(n['sat_fat']), 'fiber': r1(n['fiber']), 'salt': r1(n['salt']),
                    'category': main_category(row['categories_tags']),
                    'nutriscore': row['nutriscore_grade'] if row['nutriscore_grade'] in ('a', 'b', 'c', 'd', 'e') else None,
                    'popularity': local_popularity(market, code, int(row['unique_scans_n'] or 0)),
                    'last_modified': int(row['last_modified_t'] or 0),
                }
                out.write(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n')
                seen_codes.add(code)
                kept += 1
                ml_rows += basis == 'ml'
                if brand_list:
                    brands[brand_list[0]] += 1
                if store_list:
                    with_stores += 1
                    stores.update(store_list)
    os.replace(tmp, out_path)
    stats = {
        'source': 'Open Food Facts (ODbL 1.0), openfoodfacts/product-database food.parquet',
        'built_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'market': market, 'countries': config['countries'],
        'rows': kept, 'rows_ml_basis': ml_rows, 'share_with_store_tags': round(with_stores / kept, 3) if kept else 0,
        'bytes_gz': out_path.stat().st_size, 'rejected': dict(rejected.most_common()),
        'top_brands': brands.most_common(40), 'top_stores': stores.most_common(25),
    }
    (pathlib.Path(out_dir) / f'products-{market}{suffix}.stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=1))
    print(json.dumps({k: stats[k] for k in ('rows', 'rows_ml_basis', 'share_with_store_tags', 'bytes_gz', 'rejected')}, indent=1))
    print(f'wrote {out_path}', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--source', default=DEFAULT_SOURCE, help='food.parquet URL or local path')
    parser.add_argument('--market', choices=sorted(MARKETS), help='de (DE/AT/CH), gb or us')
    parser.add_argument('--sample', type=int, default=0, help='keep only the N most-scanned products')
    parser.add_argument('--extract-only', action='store_true', help='stage 1 only (all markets)')
    parser.add_argument('--stream-windows', action='store_true', help='stage 1 reads the whole file in windows (fast lines)')
    args = parser.parse_args()
    if not args.market and not args.extract_only:
        parser.error('--market is required (or --extract-only)')
    out_dir = pathlib.Path(args.out_dir).resolve()
    repo = pathlib.Path(__file__).resolve().parents[1]
    if out_dir == repo or repo in out_dir.parents:
        sys.exit('Refusing to write the ODbL extract into the repository; choose a scratch directory.')
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_path = out_dir / 'off-markets-raw.parquet'
    if not raw_path.exists():
        extract(args.source, raw_path, args.stream_windows)
    if args.market:
        transform(raw_path, out_dir, args.market, args.sample)


if __name__ == '__main__':
    main()
