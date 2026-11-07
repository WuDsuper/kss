// ทดสอบ Parser.gs ด้วยแถวจริงจากเอกสารคณิตศาสตร์ (รัน: node tests/parser.test.js)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../apps-script/Parser.gs'), 'utf8');
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const P = ctx.module.exports;

const STD11 = 'มาตรฐาน ค ๑.๑ เข้าใจความหลากหลายของการแสดงจำนวน ระบบจำนวน การดำเนินการของจำนวน';
const STD21_22 = 'มาตรฐาน ค ๒.๑ เข้าใจพื้นฐานเกี่ยวกับการวัด และนำไปใช้มาตรฐาน ค ๒.๒ เข้าใจและวิเคราะห์รูปเรขาคณิต และนำไปใช้';
const HDR = ['กลุ่มที่', 'ตัวชี้วัดระหว่างทาง', 'ตัวชี้วัดปลายทาง'];
const F1 = 'ค ๑.๑ ป.๑/๓ เรียงลำดับจำนวนนับไม่เกิน ๑๐๐ และ ๐ ตั้งแต่๓ ถึง ๕ จำนวนค ๑.๑ ป.๑/๕ แสดงวิธีหาคำตอบของโจทย์ปัญหาการบวก';

function run(mergedAsEmpty) {
  const s = P.createParseState('2. คณิตศาสตร์.docx');
  const rep = (t) => (mergedAsEmpty ? '' : t);
  P.handleTable(s, [
    ['ชั้น', 'ตัวชี้วัดทั้งหมด', 'ตัวชี้วัดระหว่างทาง', 'ตัวชี้วัดปลายทาง', 'หมายเหตุ'],
    ['ป.๑', '๑๐', '๓', '๗', ''],
    ['ป.๔', '๒๒', '๑๒', '๑๐', '']
  ]);
  P.handleParagraph(s, 'ชั้นประถมศึกษาปีที่ ๑');
  P.handleParagraph(s, 'สาระที่ ๑ จำนวนและพีชคณิต');
  P.handleTable(s, [
    HDR,
    [STD11, rep(STD11), rep(STD11)],
    ['๑', 'ค ๑.๑ ป.๑/๑ บอกจำนวนของสิ่งต่าง ๆ', F1],
    [rep('๑'), 'ค ๑.๑ ป.๑/๒ เปรียบเทียบจำนวนนับไม่เกิน ๑๐๐ และ ๐', rep(F1)],
    [rep('๑'), 'ค ๑.๑ ป.๑/๔ หาค่าของตัวไม่ทราบค่า', rep(F1)],
    ['๒', '\\-', 'ค ๑.๒ ป.๑/๑ ระบุจำนวนที่หายไป ในแบบรูป']
  ]);
  P.handleParagraph(s, 'สาระที่ ๒ การวัดและเรขาคณิต');
  P.handleTable(s, [HDR, ['๓', '-', 'ค ๒.๑ ป.๑/๑ วัดและเปรียบเทียบ ความยาว']]);

  // ป.๔ สาระ ๒: ข้อความปลายทางถูกตัดข้ามแถว และระหว่างทางซ้ำจากเซลล์ผสาน
  P.handleParagraph(s, 'ชั้นประถมศึกษาปีที่ ๔');
  P.handleParagraph(s, 'สาระที่ ๒ การวัดและเรขาคณิต');
  const B = 'ค ๒.๒ ป.๔/๑ จำแนกชนิดของมุม';
  P.handleTable(s, [
    HDR,
    [STD21_22, rep(STD21_22), rep(STD21_22)],
    ['๕', 'ค ๒.๑ ป.๔/๒ วัดและสร้างมุม โดยใช้โพรแทรกเตอร์', 'ค ๒.๑ ป.๔/๓ แสดงวิธีหาคำตอบ'],
    [rep('๕'), B, 'ของโจทย์ปัญหาเกี่ยวกับความยาว'],
    [rep('๕'), rep(B), 'รอบรูปและพื้นที่ของรูปสี่เหลี่ยม'],
    [rep('๕'), rep(B), 'มุมฉาก'],
    [rep('๕'), rep(B), 'ค ๒.๒ ป.๔/๒ สร้างรูปสี่เหลี่ยมมุมฉาก'],
    [rep('๕'), rep(B), 'เมื่อกำหนดความยาวของด้าน']
  ]);
  return P.finalizeParse(s);
}

for (const merged of [false, true]) {
  const out = run(merged);
  const by = Object.fromEntries(out.indicators.map((r) => [r.code, r]));
  const label = merged ? 'เซลล์ผสานเป็นค่าว่าง' : 'เซลล์ผสานถูกทำซ้ำ';

  assert.strictEqual(out.subject_code, 'ค', label);
  assert.strictEqual(out.indicators.length, 11, label + ' จำนวน');
  assert.strictEqual(by['ค 1.1 ป.1/3'].type, 'ปลายทาง');
  assert.strictEqual(by['ค 1.1 ป.1/5'].group_no, 1);
  assert.ok(by['ค 1.1 ป.1/3'].text.endsWith('ถึง ๕ จำนวน'), 'แยกสองรหัสในเซลล์เดียว');
  assert.strictEqual(by['ค 1.1 ป.1/4'].type, 'ระหว่างทาง');
  assert.strictEqual(by['ค 1.1 ป.1/4'].group_key, 'ค|ป.1|1|1');
  assert.strictEqual(by['ค 2.1 ป.1/1'].strand_name, 'การวัดและเรขาคณิต');
  assert.strictEqual(
    by['ค 2.1 ป.4/3'].text,
    'แสดงวิธีหาคำตอบ ของโจทย์ปัญหาเกี่ยวกับความยาว รอบรูปและพื้นที่ของรูปสี่เหลี่ยม มุมฉาก',
    label + ' ต่อข้อความข้ามแถว'
  );
  assert.strictEqual(by['ค 2.2 ป.4/2'].text, 'สร้างรูปสี่เหลี่ยมมุมฉาก เมื่อกำหนดความยาวของด้าน');
  assert.strictEqual(by['ค 2.2 ป.4/1'].text, 'จำแนกชนิดของมุม');
  assert.strictEqual(by['ค 2.2 ป.4/1'].code_th, 'ค ๒.๒ ป.๔/๑');
  assert.strictEqual(out.standards.length, 3);
  assert.strictEqual(out.standards.find((x) => x.standard_code === 'ค 2.2').strand_no, 2);
  const v1 = out.validation.find((v) => v.grade === 'ป.1');
  assert.deepStrictEqual([v1.parsed_between, v1.parsed_final], [3, 4]);
  assert.strictEqual(v1.status, 'ต้องตรวจสอบ'); // ทดสอบแค่บางส่วนของ ป.1 จึงไม่ครบ ๗
  console.log('ผ่าน:', label, '| ตัวชี้วัด', out.indicators.length, '| คำเตือน', out.warnings.length);
}

// รหัสระดับ ม.๔-๖ และการแปลงเลข
const c = P.findCodes('ท ๑.๑ ม.๔-๖/๑๒ อ่านออกเสียง');
assert.strictEqual(c[0].code, 'ท 1.1 ม.4-6/12');
assert.strictEqual(c[0].grade_order, 10);
assert.strictEqual(P.searchKey('ค ๑.๑ ป.๑/๑'), P.searchKey('ค1.1 ป.1/1'));
console.log('ผ่านทั้งหมด');
