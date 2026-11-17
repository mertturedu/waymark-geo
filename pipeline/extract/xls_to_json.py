import json
import sys

import xlrd

book = xlrd.open_workbook(sys.argv[1], on_demand=True, logfile=sys.stderr)
sheet = book.sheet_by_index(0)
rows = []
for r in range(sheet.nrows):
    rows.append([str(c.value).strip() if c.ctype != xlrd.XL_CELL_NUMBER else (str(int(c.value)) if c.value == int(c.value) else str(c.value)) for c in sheet.row(r)])
json.dump(rows, sys.stdout, ensure_ascii=False)
