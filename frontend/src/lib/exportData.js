// CSV export (Excel-friendly: BOM + ; delimiter) and print-to-PDF.

function cell(v) {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// sections: [{ title?, columns?: string[], rows: any[][] }]
export function exportCsv(filename, sections) {
  const lines = [];
  for (const sec of sections) {
    if (sec.title) lines.push(cell(sec.title));
    if (sec.columns) lines.push(sec.columns.map(cell).join(";"));
    for (const row of sec.rows || []) lines.push(row.map(cell).join(";"));
    lines.push("");
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function printReport() {
  window.print();
}
