#!/usr/bin/env python3
"""Builds the German supermarket product index (public.products_de) from the
Open Food Facts export.

Source: Open Food Facts product database (ODbL 1.0, https://openfoodfacts.org),
the official Parquet export on Hugging Face (openfoodfacts/product-database,
food.parquet). Only the needed columns are read, through DuckDB httpfs, so the
7.9 GB file is never downloaded whole (~0.7 GB of column chunks).

The output is a derivative database under ODbL: keep the attribution in
THIRD_PARTY_NOTICES.md and offer the built file on request.

Usage (writes OUTSIDE the repository; nothing here is committed):
  pip install --user duckdb
  python3 scripts/build-products-de.py --out-dir /path/to/scratch/offdata
  python3 scripts/build-products-de.py --out-dir DIR --countries dach   # + AT/CH
  python3 scripts/build-products-de.py --out-dir DIR --sample 20000     # test sample

Stage 1 caches the projected German/Austrian/Swiss rows as
<out-dir>/off-dach-raw.parquet (delete it to refresh from the export).
Stage 2 writes <out-dir>/products-de.ndjson.gz and products-de.stats.json.

Each row: code, name, brand, brands[], stores[], basis ('g' | 'ml': whether
the per-100 values are per 100 g or per 100 ml — ml is never treated as g),
package_g, package_ml, serving_g, kcal, protein, carbs, sugars, fat, sat_fat,
fiber, salt (per 100 g or ml), category, nutriscore, popularity, last_modified.
"""
import argparse, collections, gzip, html, json, math, os, pathlib, re, sys, time

DEFAULT_SOURCE = 'https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet'
COUNTRY_SETS = {'de': ['en:germany'], 'dach': ['en:germany', 'en:austria', 'en:switzerland']}
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
             'nutriscore_grade', 'last_modified_t', 'unique_scans_n', 'popularity_key', 'obsolete', 'nutriments']


def select_sql(table):
    nutrient_cols = ',\n'.join(
        f"list_filter(nutriments, x -> x.name = '{name}')[1].\"100g\" as n_{key}" for key, name in NUTRIENTS.items())
    countries = ', '.join(f"'{c}'" for c in COUNTRY_SETS['dach'])
    return f"""
        select code,
               list_filter(product_name, x -> x.lang = 'de')[1].text as name_de,
               list_filter(product_name, x -> x.lang = 'main')[1].text as name_main,
               list_filter(product_name, x -> x.lang = 'en')[1].text as name_en,
               lang, brands, stores_tags, countries_tags, quantity, product_quantity, product_quantity_unit,
               serving_quantity, serving_size, nutrition_data_per, categories_tags, nutriscore_grade,
               last_modified_t, unique_scans_n, popularity_key,
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


def extract(source, raw_path):
    import duckdb  # noqa: imported lazily so --help works without it
    started = time.time()
    if source.startswith('http'):
        extract_streamed(resolve_source(source), raw_path)
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
    if not re.search(r'\d(?:[.,]\d+)?\s*g\b', label, re.I) or re.search(r'\d\s*(ml|cl|dl|l)\b', label, re.I):
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


def normalize_stores(tags):
    """OFF store tags are not uniformly normalised ("Lidl", "lidl", "aldi-sud").
    Fold like private.product_fold, hyphenate, and add the chain for branches
    ("aldi-sud" → also "aldi") so a store filter matches every spelling."""
    out = set()
    for tag in tags or []:
        slug = re.sub(r'[^a-z0-9]+', '-', str(tag).split(':')[-1].lower().replace('ß', 'ss').translate(FOLD)).strip('-')[:40]
        if not slug:
            continue
        out.add(slug)
        chain = slug.split('-')[0]
        if chain in CHAINS:
            out.add(chain)
    return sorted(out)[:10]


def main_category(tags):
    english = [t for t in (tags or []) if isinstance(t, str) and t.startswith('en:')]
    return english[-1][3:].replace('-', ' ')[:60] if english else None


def transform(raw_path, out_dir, countries, sample):
    import duckdb
    con = duckdb.connect()
    wanted = ', '.join(f"'{c}'" for c in COUNTRY_SETS[countries])
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
    out_path = pathlib.Path(out_dir) / f'products-de{suffix}.ndjson.gz'
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
                name = clean_text(row['name_de'], 130) or clean_text(row['name_main'], 130) or clean_text(row['name_en'], 130)
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
                store_list = normalize_stores(row['stores_tags'])
                package_g, package_ml = package_amounts(row)
                basis = mass_basis(row)
                record = {
                    'code': code, 'name': name, 'brand': brand_list[0] if brand_list else None, 'brands': brand_list,
                    'stores': store_list, 'basis': basis, 'package_g': package_g, 'package_ml': package_ml,
                    'serving_g': serving_grams(row) if basis == 'g' else None,
                    'kcal': r1(n['kcal']), 'protein': r1(n['protein']), 'carbs': r1(n['carbs']), 'sugars': r1(n['sugars']),
                    'fat': r1(n['fat']), 'sat_fat': r1(n['sat_fat']), 'fiber': r1(n['fiber']), 'salt': r1(n['salt']),
                    'category': main_category(row['categories_tags']),
                    'nutriscore': row['nutriscore_grade'] if row['nutriscore_grade'] in ('a', 'b', 'c', 'd', 'e') else None,
                    'popularity': int(row['unique_scans_n'] or 0),
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
        'built_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'countries': COUNTRY_SETS[countries],
        'rows': kept, 'rows_ml_basis': ml_rows, 'share_with_store_tags': round(with_stores / kept, 3) if kept else 0,
        'bytes_gz': out_path.stat().st_size, 'rejected': dict(rejected.most_common()),
        'top_brands': brands.most_common(40), 'top_stores': stores.most_common(25),
    }
    (pathlib.Path(out_dir) / f'products-de{suffix}.stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=1))
    print(json.dumps({k: stats[k] for k in ('rows', 'rows_ml_basis', 'share_with_store_tags', 'bytes_gz', 'rejected')}, indent=1))
    print(f'wrote {out_path}', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--source', default=DEFAULT_SOURCE, help='food.parquet URL or local path')
    parser.add_argument('--countries', choices=sorted(COUNTRY_SETS), default='de')
    parser.add_argument('--sample', type=int, default=0, help='keep only the N most-scanned products')
    args = parser.parse_args()
    out_dir = pathlib.Path(args.out_dir).resolve()
    repo = pathlib.Path(__file__).resolve().parents[1]
    if out_dir == repo or repo in out_dir.parents:
        sys.exit('Refusing to write the ODbL extract into the repository; choose a scratch directory.')
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_path = out_dir / 'off-dach-raw.parquet'
    if not raw_path.exists():
        extract(args.source, raw_path)
    transform(raw_path, out_dir, args.countries, args.sample)


if __name__ == '__main__':
    main()
