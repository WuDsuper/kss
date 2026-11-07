// ตั้งค่าแหล่งข้อมูลของหน้าเว็บ
// ใส่ URL ของ Apps Script Web App (ลงท้าย /exec) เพื่ออ่านข้อมูลสดจาก Google Sheet
// ถ้าเว้นว่าง หน้าเว็บจะอ่านไฟล์ data/indicators.json ในคลัง GitHub แทน
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby1flUNikKTyTu5wWkDRY2VAaVghdWRgdHRSZEy_9wzO6BjorEM5aIfz3Ui9zBHDmuEVA/exec',
  FALLBACK_JSON: 'data/indicators.json',
  TITLE: 'ฐานข้อมูลตัวชี้วัดระหว่างทางและตัวชี้วัดปลายทาง',
  SUBTITLE: 'หลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน พุทธศักราช ๒๕๕๑ (ฉบับปรับปรุง พ.ศ. ๒๕๖๐)'
};
