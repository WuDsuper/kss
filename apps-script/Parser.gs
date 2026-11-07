/**
 * Parser.gs
 * ตัวแยกข้อมูลตัวชี้วัดระหว่างทาง/ปลายทาง จากตารางในเอกสารของ สพฐ.
 * เป็นฟังก์ชันล้วน ไม่เรียกบริการของ Google จึงใช้ได้ทั้งใน Apps Script และ Node.js (สำหรับทดสอบ)
 *
 * โครงสร้างเอกสารต้นฉบับ
 *   ย่อหน้า "ชั้นประถมศึกษาปีที่ ..." / "ชั้นมัธยมศึกษาปีที่ ..."
 *   ย่อหน้า "สาระที่ n ชื่อสาระ"
 *   ตาราง 3 คอลัมน์: กลุ่มที่ | ตัวชี้วัดระหว่างทาง | ตัวชี้วัดปลายทาง
 *   แถวมาตรฐานเป็นเซลล์ผสาน ขึ้นต้นด้วย "มาตรฐาน"
 *   ตารางสรุปต้นไฟล์: ชั้น | ตัวชี้วัดทั้งหมด | ระหว่างทาง | ปลายทาง | หมายเหตุ
 */

var THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

var SUBJECTS = {
  'ท': { order: 1, name: 'ภาษาไทย' },
  'ค': { order: 2, name: 'คณิตศาสตร์' },
  'ว': { order: 3, name: 'วิทยาศาสตร์และเทคโนโลยี' },
  'ส': { order: 4, name: 'สังคมศึกษา ศาสนา และวัฒนธรรม' },
  'พ': { order: 5, name: 'สุขศึกษาและพลศึกษา' },
  'ศ': { order: 6, name: 'ศิลปะ' },
  'ง': { order: 7, name: 'การงานอาชีพ' },
  'ต': { order: 8, name: 'ภาษาต่างประเทศ' }
};

var TYPE_BETWEEN = 'ระหว่างทาง';
var TYPE_FINAL = 'ปลายทาง';

var INDICATOR_HEADERS = [
  'code', 'code_th', 'subject_code', 'subject_name', 'strand_no', 'strand_name',
  'standard_code', 'grade', 'grade_order', 'seq', 'type', 'group_no', 'group_key',
  'text', 'doc_order', 'source_file', 'reviewed', 'note', 'updated_at'
];
var STANDARD_HEADERS = ['standard_code', 'standard_code_th', 'subject_code', 'strand_no', 'text'];
var STRAND_HEADERS = ['strand_key', 'subject_code', 'strand_no', 'strand_name'];
var SUBJECT_HEADERS = ['subject_code', 'subject_name', 'subject_order', 'source_file', 'imported_at'];
var SUMMARY_HEADERS = ['subject_code', 'grade', 'grade_order', 'total', 'between', 'final'];

/* ---------- เครื่องมือข้อความ ---------- */

function toArabic(s) {
  return String(s == null ? '' : s).replace(/[๐-๙]/g, function (d) {
    return String(THAI_DIGITS.indexOf(d));
  });
}

function toThaiDigits(s) {
  return String(s == null ? '' : s).replace(/[0-9]/g, function (d) {
    return THAI_DIGITS.charAt(Number(d));
  });
}

function cleanText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u000b\r\n\t ​]+/g, ' ')
    .replace(/\\([<>\-])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** คีย์สำหรับค้นหา: ตัดช่องว่าง แปลงเลขไทยเป็นอารบิก */
function searchKey(s) {
  return toArabic(cleanText(s)).replace(/\s+/g, '').toLowerCase();
}

function gradeOrder(grade) {
  var g = toArabic(grade).replace(/\s+/g, '');
  var m = g.match(/^(ป|ม)\.(\d)(?:[-–](\d))?$/);
  if (!m) return 99;
  var n = Number(m[2]);
  if (m[1] === 'ป') return n;
  if (m[3]) return 10; // ม.4-6
  return 6 + n;
}

/* ---------- รูปแบบรหัสตัวชี้วัด เช่น ค ๑.๑ ป.๑/๑ หรือ ท ๑.๑ ม.๔-๖/๑ ---------- */

var CODE_PATTERN =
  '([ทควสพศงต])\\s*([0-9๐-๙]{1,2})\\s*\\.\\s*([0-9๐-๙]{1,2})\\s*' +
  '(ป|ม)\\s*\\.\\s*([0-9๐-๙](?:\\s*[-–]\\s*[0-9๐-๙])?)\\s*\\/\\s*([0-9๐-๙]{1,2})';

function findCodes(text) {
  var re = new RegExp(CODE_PATTERN, 'g');
  var out = [];
  var m;
  while ((m = re.exec(text)) !== null) {
    var a = toArabic(m[2]), b = toArabic(m[3]);
    var grade = m[4] + '.' + toArabic(m[5]).replace(/\s+/g, '').replace('–', '-');
    var seq = toArabic(m[6]);
    var code = m[1] + ' ' + a + '.' + b + ' ' + grade + '/' + seq;
    out.push({
      index: m.index,
      length: m[0].length,
      code: code,
      code_th: toThaiDigits(code),
      subject_code: m[1],
      standard_code: m[1] + ' ' + a + '.' + b,
      strand_no: Number(a),
      grade: grade,
      grade_order: gradeOrder(grade),
      seq: Number(seq)
    });
  }
  return out;
}

/* ---------- สถานะระหว่างอ่านเอกสาร ---------- */

function createParseState(sourceFile) {
  return {
    sourceFile: sourceFile || '',
    gradeHeading: '',
    strandNo: '',
    strandName: '',
    group: '',
    lastText: {},
    lastInd: {},
    seen: {},
    indicators: [],
    standards: {},
    strandNames: {},
    summary: [],
    warnings: []
  };
}

function resetContext_(state) {
  state.group = '';
  state.lastText = {};
  state.lastInd = {};
}

/** ส่งข้อความย่อหน้า (นอกตาราง) เข้ามาทีละย่อหน้า */
function handleParagraph(state, rawText) {
  var text = cleanText(rawText);
  if (!text) return;
  var g = text.match(/ชั้น(ประถม|มัธยม)ศึกษาปีที่\s*([0-9๐-๙](?:\s*[-–]\s*[0-9๐-๙])?)/);
  if (g) {
    state.gradeHeading = (g[1] === 'ประถม' ? 'ป.' : 'ม.') + toArabic(g[2]).replace(/\s+/g, '');
    state.strandNo = '';
    state.strandName = '';
    resetContext_(state);
    return;
  }
  var s = text.match(/^สาระที่\s*([0-9๐-๙]+)\s*(.*)$/);
  if (s) {
    state.strandNo = Number(toArabic(s[1]));
    state.strandName = cleanText(s[2]);
    if (state.strandName && !state.strandNames[state.strandNo]) {
      state.strandNames[state.strandNo] = state.strandName;
    }
    resetContext_(state);
  }
}

/** ส่งตารางเข้ามาเป็นอาร์เรย์ของแถว แต่ละแถวเป็นอาร์เรย์ข้อความในเซลล์ */
function handleTable(state, rows) {
  if (!rows || !rows.length) return;
  var first = rows[0].map(cleanText).join('|');
  if (first.indexOf('ตัวชี้วัดทั้งหมด') >= 0) {
    parseSummaryTable_(state, rows);
    return;
  }
  for (var r = 0; r < rows.length; r++) {
    parseIndicatorRow_(state, rows[r].map(cleanText));
  }
}

function parseSummaryTable_(state, rows) {
  for (var r = 1; r < rows.length; r++) {
    var c = rows[r].map(cleanText);
    var g = toArabic(c[0]).replace(/\s+/g, '');
    if (!/^(ป|ม)\.\d/.test(g)) continue;
    state.summary.push({
      grade: g,
      grade_order: gradeOrder(g),
      total: Number(toArabic(c[1])) || 0,
      between: Number(toArabic(c[2])) || 0,
      final: Number(toArabic(c[3])) || 0
    });
  }
}

function parseIndicatorRow_(state, cells) {
  if (!cells.length) return;
  if (cells[0] === 'กลุ่มที่' || (cells[1] === 'ตัวชี้วัดระหว่างทาง')) return;

  var stdCell = '';
  cells.forEach(function (c) {
    if (/^มาตรฐาน/.test(c) && c.length > stdCell.length) stdCell = c;
  });
  if (stdCell) {
    parseStandards_(state, stdCell);
    return;
  }

  if (cells.length === 2) cells = [''].concat(cells);
  var g = toArabic(cells[0]).replace(/\s+/g, '');
  if (/^\d+$/.test(g)) state.group = Number(g);

  processCell_(state, 1, cells[1] || '');
  processCell_(state, 2, cells[2] || '');
}

function parseStandards_(state, text) {
  text.split(/มาตรฐาน\s*/).forEach(function (part) {
    var p = cleanText(part);
    var m = p.match(/^([ทควสพศงต])\s*([0-9๐-๙]+)\s*\.\s*([0-9๐-๙]+)\s*(.*)$/);
    if (!m) return;
    var code = m[1] + ' ' + toArabic(m[2]) + '.' + toArabic(m[3]);
    var prev = state.standards[code];
    if (!prev || prev.text.length < m[4].length) {
      state.standards[code] = {
        standard_code: code,
        standard_code_th: toThaiDigits(code),
        subject_code: m[1],
        strand_no: Number(toArabic(m[2])),
        text: cleanText(m[4])
      };
    }
  });
}

function processCell_(state, col, text) {
  if (!text || /^[-–—]+$/.test(text)) return;
  if (state.lastText[col] === text) return; // เซลล์ผสานแนวตั้งที่ถูกทำซ้ำ
  state.lastText[col] = text;

  var codes = findCodes(text);
  if (!codes.length) {
    appendContinuation_(state, col, text);
    return;
  }
  var prefix = cleanText(text.slice(0, codes[0].index));
  if (prefix && !/^[-–—]+$/.test(prefix)) appendContinuation_(state, col, prefix);

  for (var i = 0; i < codes.length; i++) {
    var c = codes[i];
    var end = i + 1 < codes.length ? codes[i + 1].index : text.length;
    var seg = cleanText(text.slice(c.index + c.length, end));
    var rec = state.seen[c.code];
    if (rec) {
      if (seg.length > rec.text.length && seg.indexOf(rec.text) === 0) rec.text = seg;
      state.lastInd[col] = rec;
      continue;
    }
    rec = {
      code: c.code,
      code_th: c.code_th,
      subject_code: c.subject_code,
      standard_code: c.standard_code,
      strand_no: c.strand_no,
      grade: c.grade,
      grade_order: c.grade_order,
      seq: c.seq,
      type: col === 1 ? TYPE_BETWEEN : TYPE_FINAL,
      group_no: state.group,
      heading_grade: state.gradeHeading,
      heading_strand_no: state.strandNo,
      text: seg,
      doc_order: state.indicators.length + 1,
      source_file: state.sourceFile
    };
    if (state.gradeHeading && state.gradeHeading !== c.grade) {
      state.warnings.push('รหัส ' + c.code + ' อยู่ใต้หัวข้อชั้น ' + state.gradeHeading);
    }
    state.seen[c.code] = rec;
    state.indicators.push(rec);
    state.lastInd[col] = rec;
  }
}

function appendContinuation_(state, col, text) {
  var rec = state.lastInd[col];
  if (!rec) {
    state.warnings.push('ข้อความไม่มีรหัสและหาตัวชี้วัดก่อนหน้าไม่พบ: ' + text.slice(0, 60));
    return;
  }
  if (rec.text.indexOf(text) >= 0) return;
  rec.text = rec.text ? rec.text + ' ' + text : text;
}

/* ---------- สรุปผลหลังอ่านจบหนึ่งเอกสาร ---------- */

function finalizeParse(state) {
  var count = {};
  state.indicators.forEach(function (r) { count[r.subject_code] = (count[r.subject_code] || 0) + 1; });
  var subject = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0] || '';
  var subjectName = SUBJECTS[subject] ? SUBJECTS[subject].name : '';

  var indicators = state.indicators.map(function (r) {
    var strandNo = r.strand_no;
    return {
      code: r.code,
      code_th: r.code_th,
      subject_code: r.subject_code,
      subject_name: SUBJECTS[r.subject_code] ? SUBJECTS[r.subject_code].name : '',
      strand_no: strandNo,
      strand_name: state.strandNames[strandNo] || '',
      standard_code: r.standard_code,
      grade: r.grade,
      grade_order: r.grade_order,
      seq: r.seq,
      type: r.type,
      group_no: r.group_no,
      group_key: [r.subject_code, r.grade, r.heading_strand_no || strandNo, r.group_no].join('|'),
      text: r.text,
      doc_order: r.doc_order,
      source_file: r.source_file,
      reviewed: '',
      note: ''
    };
  });

  var strands = Object.keys(state.strandNames).map(function (no) {
    return {
      strand_key: subject + '|' + no,
      subject_code: subject,
      strand_no: Number(no),
      strand_name: state.strandNames[no]
    };
  });

  var standards = Object.keys(state.standards).map(function (k) { return state.standards[k]; });
  var summary = state.summary.map(function (s) {
    return {
      subject_code: subject, grade: s.grade, grade_order: s.grade_order,
      total: s.total, between: s.between, final: s.final
    };
  });

  return {
    subject_code: subject,
    subject_name: subjectName,
    source_file: state.sourceFile,
    indicators: indicators,
    standards: standards,
    strands: strands,
    summary: summary,
    validation: validateCounts(subject, indicators, summary),
    warnings: state.warnings
  };
}

/** เทียบจำนวนที่แยกได้กับตารางสรุปของเอกสาร */
function validateCounts(subject, indicators, summary) {
  var parsed = {};
  indicators.forEach(function (r) {
    var p = parsed[r.grade] || (parsed[r.grade] = { between: 0, final: 0 });
    if (r.type === TYPE_BETWEEN) p.between++; else p.final++;
  });
  var grades = {};
  summary.forEach(function (s) { grades[s.grade] = s; });
  Object.keys(parsed).forEach(function (g) { if (!grades[g]) grades[g] = null; });

  return Object.keys(grades).sort(function (a, b) { return gradeOrder(a) - gradeOrder(b); }).map(function (g) {
    var s = grades[g];
    var p = parsed[g] || { between: 0, final: 0 };
    var ok = s && s.between === p.between && s.final === p.final;
    return {
      subject_code: subject,
      grade: g,
      official_between: s ? s.between : '',
      parsed_between: p.between,
      official_final: s ? s.final : '',
      parsed_final: p.final,
      status: s ? (ok ? 'ตรงกัน' : 'ต้องตรวจสอบ') : 'ไม่มีในตารางสรุป'
    };
  });
}

function toRows(objects, headers) {
  return objects.map(function (o) {
    return headers.map(function (h) { return o[h] == null ? '' : o[h]; });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toArabic: toArabic, toThaiDigits: toThaiDigits, cleanText: cleanText, searchKey: searchKey,
    gradeOrder: gradeOrder, findCodes: findCodes, createParseState: createParseState,
    handleParagraph: handleParagraph, handleTable: handleTable, finalizeParse: finalizeParse,
    validateCounts: validateCounts, toRows: toRows, SUBJECTS: SUBJECTS,
    INDICATOR_HEADERS: INDICATOR_HEADERS
  };
}
