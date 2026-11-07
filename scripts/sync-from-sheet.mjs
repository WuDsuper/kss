// ดึงข้อมูลจาก Apps Script Web App มาเก็บเป็นไฟล์ในคลัง (JSON และ CSV)
// ใช้: SHEET_API_URL="https://script.google.com/macros/s/xxx/exec" node scripts/sync-from-sheet.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const API = process.env.SHEET_API_URL;
if (!API) {
  console.error('กรุณากำหนดตัวแปร SHEET_API_URL');
  process.exit(1);
}

const res = await fetch(`${API}${API.includes('?') ? '&' : '?'}action=all`, { redirect: 'follow' });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const payload = await res.json();
if (!payload.ok) throw new Error(payload.error || 'API ตอบกลับไม่สำเร็จ');

const data = payload.data;
if (!data.indicators?.length) throw new Error('ไม่มีข้อมูลตัวชี้วัด ไม่บันทึกทับไฟล์เดิม');

await mkdir('data/csv', { recursive: true });
await writeFile('data/indicators.json', JSON.stringify({ ok: true, generated_at: payload.generated_at, data }, null, 1));

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
for (const [name, rows] of Object.entries(data)) {
  if (!Array.isArray(rows) || !rows.length) continue;
  const cols = Object.keys(rows[0]);
  const csv = '﻿' + [cols.map(q).join(',')].concat(rows.map((r) => cols.map((c) => q(r[c])).join(','))).join('\n');
  await writeFile(`data/csv/${name}.csv`, csv);
}
console.log(`บันทึกแล้ว: ตัวชี้วัด ${data.indicators.length} รายการ`);
