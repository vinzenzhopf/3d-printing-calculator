"""
Converts the PDF of the Printables "Empty Spool Weight Catalog" (by Scuk,
CC BY-NC-SA 4.0) into src/third-party/printables-spool-weights.json.

Save the model page as PDF (browser: print → save as PDF), then:

    pip install pypdf
    python tools/parse_spool_weight_catalog.py catalog.pdf src/third-party/printables-spool-weights.json

Check the diff afterwards: the table is read from the page text.
"""
import json
import re
import sys

from pypdf import PdfReader

SOURCE = {
    'title': 'Empty Spool Weight Catalog',
    'author': 'Scuk',
    'url': 'https://www.printables.com/model/464663-empty-spool-weight-catalog',
    'license': 'CC BY-NC-SA 4.0',
    'licenseUrl': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
}

WEIGHT = r'~?\s*(?P<lo>\d+)\s*(?:-\s*(?P<hi>\d+))?\s*g'
ROW = re.compile(
    r'(?P<brand>[A-Za-z0-9][\w+.&\'/ ()-]*?)(?:\s+|(?<=\)))(?P<size>\d+(?:\.\d+)?)\s*(?P<unit>kg|g)\s+'
    r'(?P<material>Plastic|Cardboard)(?P<variant>(?:\s*(?:\([^)]*\)|w/ Cardboard(?: Core)?|Core Only))*)\s*'
    rf'{WEIGHT}(?P<note>\s*\([^)]*\))?'
)


def table_text(pdf_path: str) -> tuple[str, str]:
    text = '\n'.join(p.extract_text() for p in PdfReader(pdf_path).pages)
    header = 'Brand Size Spool Material Empty Weight'
    body = text[text.index(header) + len(header):text.index('*Last updated')]
    # Page furniture between the rows.
    for junk in ['Scuk', 'Empty Spool\nWeight Catalog', 'VIEW IN BROWSER', '3D MODEL ONLY', 'Model files']:
        body = body.replace(junk, '\n')
    body = re.sub(r'updated .*?published [\d. ]+', '\n', body)
    body = body.replace('T emp', 'Temp').replace('T ech', 'Tech')
    updated = re.search(r'Last updated on ([\d/]+)', text)
    return re.sub(r'\s+', ' ', body), updated.group(1) if updated else ''


def rows(body: str) -> list[dict]:
    result = []
    for m in ROW.finditer(body):
        size = float(m['size'])
        # "800 kg" is a typo for 800 g in the source.
        grams = size if m['unit'] == 'g' or size >= 100 else size * 1000
        lo, hi = int(m['lo']), int(m['hi']) if m['hi'] else None
        parts = re.findall(r'\(([^)]*)\)|(w/ Cardboard(?: Core)?|Core Only)', f"{m['variant']} {m['note'] or ''}")
        variant = ', '.join(
            (a or b).strip().replace('w/', 'with').replace('cardbard', 'cardboard') for a, b in parts if (a or b).strip()
        )
        result.append({
            'brand': m['brand'].strip(),
            'sizeG': round(grams),
            'spoolType': m['material'].lower(),
            **({'variant': variant} if variant else {}),
            'emptyG': round((lo + hi) / 2) if hi else lo,
            **({'minG': lo, 'maxG': hi} if hi else {}),
        })
    return result


def main() -> None:
    body, updated = table_text(sys.argv[1])
    entries = rows(body)
    source = {**SOURCE, 'updated': updated, 'changes': 'Table converted to JSON; for weight ranges emptyG is the middle.'}
    with open(sys.argv[2], 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n  "source": ' + json.dumps(source, ensure_ascii=False) + ',\n  "entries": [\n')
        f.write(',\n'.join('    ' + json.dumps(r, ensure_ascii=False) for r in entries))
        f.write('\n  ]\n}\n')
    print(f'{len(entries)} entries')


if __name__ == '__main__':
    main()
