/**
 * Code.gs
 * ฐานข้อมูลตัวชี้วัดระหว่างทางและปลายทาง (หลักสูตรแกนกลางฯ ๒๕๕๑)
 * ผูกกับ Google Sheet (Extensions > Apps Script) ต้องเปิดบริการขั้นสูง Drive API
 */

var CONFIG = {
  SOURCE_FOLDER_ID: '',
  SHEET: {
    INDICATORS: 'indicators',
    STANDARDS: 'standards',
    STRANDS: 'strands',
    SUBJECTS: 'subjects',
    SUMMARY: 'summary_official',
    VALIDATION: 'validation',
    LOG: 'import_log'
  },
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  PROGRESS_KEY: 'IMPORT_DONE_IDS'
};

var VALIDATION_HEADERS = ['subject_code', 'grade', 'official_between', 'parsed_between',
  'official_final', 'parsed_final', 'status'];
var LOG_HEADERS = ['time', 'file', 'subject_code', 'indicators', 'warnings', 'detail'];

/* ---------- เมนู ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ฐานข้อมูลตัวชี้วัด')
    .addItem('1. สร้างชีตและหัวตาราง', 'setupSheets')
    .addItem('2. นำเข้าตัวชี้วัดจาก Google Drive', 'importAll')
    .addItem('3. สร้างรายงานตรวจสอบจำนวน', 'buildValidation')
    .addSeparator()
    .addItem('เริ่มนำเข้าใหม่ทั้งหมด (ล้างความคืบหน้า)', 'resetImport')
    .addToUi();
}

function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, CONFIG.SHEET.INDICATORS, INDICATOR_HEADERS);
  ensureSheet_(ss, CONFIG.SHEET.STANDARDS, STANDARD_HEADERS);
  ensureSheet_(ss, CONFIG.SHEET.STRANDS, STRAND_HEADERS);
  ensureSheet_(ss, CONFIG.SHEET.SUBJECTS, SUBJECT_HEADERS);
  ensureSheet_(ss, CONFIG.SHEET.SUMMARY, SUMMARY_HEADERS);
  ensureSheet_(ss, CONFIG.SHEET.VALIDATION, VALIDATION_HEADERS);
  ensureSheet_(ss, CONFIG.SHEET.LOG, LOG_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/* ---------- นำเข้า ---------- */

function resetImport() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG.PROGRESS_KEY);
  toast_('ล้างความคืบหน้าแล้ว เรียกนำเข้าใหม่ได้');
}

/**
 * อ่านไฟล์ .docx ทุกไฟล์ในโฟลเดอร์ต้นฉบับ แปลงเป็น Google Docs ชั่วคราว แยกข้อมูล แล้วเขียนลงชีต
 * ถ้าใช้เวลาเกินกำหนดจะหยุดและจำความคืบหน้าไว้ เรียกซ้ำเพื่อทำต่อ
 */
function importAll() {
  setupSheets();
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var done = JSON.parse(props.getProperty(CONFIG.PROGRESS_KEY) || '[]');

  var files = [];
  var it = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID).getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (/\.docx$/i.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) { return a.getName().localeCompare(b.getName(), 'th'); });

  var processed = 0;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (done.indexOf(file.getId()) >= 0) continue;
    if (Date.now() - started > CONFIG.MAX_RUNTIME_MS) {
      toast_('หมดเวลารอบนี้ นำเข้าแล้ว ' + done.length + '/' + files.length + ' ไฟล์ กรุณาเรียกนำเข้าอีกครั้ง');
      return;
    }
    var result = parseDriveDocx_(file);
    writeResult_(result);
    done.push(file.getId());
    props.setProperty(CONFIG.PROGRESS_KEY, JSON.stringify(done));
    processed++;
  }
  buildValidation();
  toast_('นำเข้าเสร็จ ' + processed + ' ไฟล์ในรอบนี้ (รวม ' + done.length + '/' + files.length + ')');
}

function parseDriveDocx_(file) {
  var tmp = Drive.Files.copy(
    { name: 'tmp_parse_' + file.getName(), title: 'tmp_parse_' + file.getName(), mimeType: MimeType.GOOGLE_DOCS },
    file.getId()
  );
  try {
    var state = createParseState(file.getName());
    var body = DocumentApp.openById(tmp.id).getBody();
    for (var i = 0; i < body.getNumChildren(); i++) {
      var el = body.getChild(i);
      var type = el.getType();
      if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
        handleParagraph(state, el.asText().getText());
      } else if (type === DocumentApp.ElementType.TABLE) {
        handleTable(state, readTable_(el.asTable()));
      }
    }
    return finalizeParse(state);
  } finally {
    DriveApp.getFileById(tmp.id).setTrashed(true);
  }
}

function readTable_(table) {
  var rows = [];
  for (var r = 0; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    var cells = [];
    for (var c = 0; c < row.getNumCells(); c++) cells.push(row.getCell(c).getText());
    rows.push(cells);
  }
  return rows;
}

/**
 * เขียนผลของหนึ่งกลุ่มสาระลงชีต แทนที่ข้อมูลเดิมของกลุ่มสาระนั้น
 * แถวที่ผู้ใช้ทำเครื่องหมาย reviewed = TRUE จะคงค่าที่แก้ไขด้วยมือไว้ ไม่ถูกทับ
 */
function writeResult_(res) {
  var ss = SpreadsheetApp.getActive();
  var now = new Date();
  var subj = res.subject_code;

  var sh = ss.getSheetByName(CONFIG.SHEET.INDICATORS);
  var existing = readObjects_(sh);
  var kept = {};
  existing.forEach(function (o) {
    if (o.subject_code === subj && (o.reviewed === true || String(o.reviewed).toUpperCase() === 'TRUE')) {
      kept[o.code] = o;
    }
  });
  var fresh = res.indicators.map(function (o) {
    if (kept[o.code]) { var k = kept[o.code]; delete kept[o.code]; return k; }
    o.updated_at = now;
    return o;
  });
  Object.keys(kept).forEach(function (k) { fresh.push(kept[k]); }); // แถวที่เพิ่มเองด้วยมือ
  replaceSubject_(sh, INDICATOR_HEADERS, existing, subj, fresh);

  replaceSubjectSimple_(ss.getSheetByName(CONFIG.SHEET.STANDARDS), STANDARD_HEADERS, subj, res.standards);
  replaceSubjectSimple_(ss.getSheetByName(CONFIG.SHEET.STRANDS), STRAND_HEADERS, subj, res.strands);
  replaceSubjectSimple_(ss.getSheetByName(CONFIG.SHEET.SUMMARY), SUMMARY_HEADERS, subj, res.summary);
  replaceSubjectSimple_(ss.getSheetByName(CONFIG.SHEET.SUBJECTS), SUBJECT_HEADERS, subj, [{
    subject_code: subj,
    subject_name: res.subject_name,
    subject_order: SUBJECTS[subj] ? SUBJECTS[subj].order : '',
    source_file: res.source_file,
    imported_at: now
  }]);

  ss.getSheetByName(CONFIG.SHEET.LOG).appendRow([
    now, res.source_file, subj, res.indicators.length, res.warnings.length,
    res.warnings.slice(0, 20).join('\n')
  ]);
}

function replaceSubject_(sh, headers, existing, subj, fresh) {
  var others = existing.filter(function (o) { return o.subject_code !== subj; });
  var all = others.concat(fresh);
  all.sort(function (a, b) {
    var sa = SUBJECTS[a.subject_code] ? SUBJECTS[a.subject_code].order : 99;
    var sb = SUBJECTS[b.subject_code] ? SUBJECTS[b.subject_code].order : 99;
    return (sa - sb) || (Number(a.grade_order) - Number(b.grade_order)) || (Number(a.doc_order) - Number(b.doc_order));
  });
  writeObjects_(sh, headers, all);
}

function replaceSubjectSimple_(sh, headers, subj, fresh) {
  var existing = readObjects_(sh);
  writeObjects_(sh, headers, existing.filter(function (o) { return o.subject_code !== subj; }).concat(fresh));
}

/* ---------- ตรวจสอบจำนวนกับตารางสรุปของเอกสาร ---------- */

function buildValidation() {
  var ss = SpreadsheetApp.getActive();
  var ind = readObjects_(ss.getSheetByName(CONFIG.SHEET.INDICATORS));
  var sum = readObjects_(ss.getSheetByName(CONFIG.SHEET.SUMMARY));
  var out = [];
  Object.keys(SUBJECTS).forEach(function (s) {
    var i = ind.filter(function (o) { return o.subject_code === s; });
    var m = sum.filter(function (o) { return o.subject_code === s; }).map(function (o) {
      return { grade: o.grade, between: Number(o.between), final: Number(o.final) };
    });
    if (i.length || m.length) out = out.concat(validateCounts(s, i, m));
  });
  var sh = ss.getSheetByName(CONFIG.SHEET.VALIDATION);
  writeObjects_(sh, VALIDATION_HEADERS, out);
  if (out.length) {
    var col = VALIDATION_HEADERS.indexOf('status') + 1;
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ต้องตรวจสอบ').setBackground('#fde2e1')
        .setRanges([sh.getRange(2, col, out.length, 1)]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ตรงกัน').setBackground('#e3f4e6')
        .setRanges([sh.getRange(2, col, out.length, 1)]).build()
    ];
    sh.setConditionalFormatRules(rules);
  }
}

/* ---------- Web API สำหรับหน้าเว็บบน GitHub Pages ---------- */

/**
 * GET ?action=all                 ข้อมูลทุกตาราง
 * GET ?action=indicators&subject=ค&grade=ป.1&type=ปลายทาง&q=เศษส่วน
 * GET ?action=standards | strands | subjects | summary | validation
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'all';
  var ss = SpreadsheetApp.getActive();
  var data;
  try {
    if (action === 'all') {
      data = {
        subjects: readObjects_(ss.getSheetByName(CONFIG.SHEET.SUBJECTS)),
        strands: readObjects_(ss.getSheetByName(CONFIG.SHEET.STRANDS)),
        standards: readObjects_(ss.getSheetByName(CONFIG.SHEET.STANDARDS)),
        summary: readObjects_(ss.getSheetByName(CONFIG.SHEET.SUMMARY)),
        indicators: readObjects_(ss.getSheetByName(CONFIG.SHEET.INDICATORS)).map(publicIndicator_)
      };
    } else if (action === 'indicators') {
      data = filterIndicators_(readObjects_(ss.getSheetByName(CONFIG.SHEET.INDICATORS)), p).map(publicIndicator_);
    } else {
      var map = { standards: 'STANDARDS', strands: 'STRANDS', subjects: 'SUBJECTS', summary: 'SUMMARY', validation: 'VALIDATION' };
      if (!map[action]) throw new Error('ไม่รู้จัก action: ' + action);
      data = readObjects_(ss.getSheetByName(CONFIG.SHEET[map[action]]));
    }
    return json_({ ok: true, generated_at: new Date().toISOString(), data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function filterIndicators_(rows, p) {
  var q = p.q ? searchKey(p.q) : '';
  return rows.filter(function (o) {
    if (p.subject && o.subject_code !== p.subject) return false;
    if (p.grade && o.grade !== p.grade) return false;
    if (p.type && o.type !== p.type) return false;
    if (p.standard && o.standard_code !== p.standard) return false;
    if (q && searchKey(o.code + ' ' + o.text).indexOf(q) < 0) return false;
    return true;
  });
}

function publicIndicator_(o) {
  var out = {};
  INDICATOR_HEADERS.forEach(function (h) {
    if (h === 'reviewed' || h === 'updated_at') return;
    out[h] = o[h];
  });
  return out;
}

/* ---------- เครื่องมือชีต ---------- */

function readObjects_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var headers = values.shift();
  return values.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    headers.forEach(function (h, i) { if (h) o[h] = r[i]; });
    return o;
  });
}

function writeObjects_(sh, headers, objects) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), headers.length)).clearContent();
  if (!objects.length) return;
  var rows = toRows(objects, headers);
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'ฐานข้อมูลตัวชี้วัด', 8); } catch (e) { Logger.log(msg); }
}
