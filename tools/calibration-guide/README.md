# ParkMap Calibration code guide

คู่มือภาษาไทยสำหรับ Calibration, Segmentation และ Lot Model Editor

```powershell
node tools/calibration-guide/build.cjs
node tools/calibration-guide/serve.cjs
```

เปิด http://127.0.0.1:3012 และหยุด server ด้วย Ctrl+C

`build.cjs` อ่าน source ที่เลือกจาก repository ตรวจชื่อฟังก์ชัน แล้วสร้าง
`dist/content.js` พร้อมโค้ดจริง เลขบรรทัด และ Git revision ขณะ build
อัปเดตคู่มือเมื่อ source เปลี่ยนโดย build ใหม่ คำอธิบายบทเรียนต้องทบทวนเองด้วย

เว็บ static ไม่มี API ที่เปลี่ยน Calibration จริง ไม่มีข้อมูลกล้องหรือ credentials
ตัวอย่าง width และ rotation เป็นข้อมูลจำลอง ไม่ใช่เครื่องมือวัดหรือประเมิน accuracy
ช่องฝึกตอบอยู่ในหน่วยความจำของหน้าเว็บเท่านั้น

## Manual checks

- เปิดทุกบทและตรวจ path/เลขบรรทัดกับ source snapshot
- ค้นหา bbox, lot และชื่อไฟล์ เลือกบทและใช้ Back/Forward
- บท width: เปลี่ยนความกว้าง/ตำแหน่งกรอบ แล้วตรวจว่าพิกัดพื้นซ้าย–ขวาและระยะเปลี่ยนตาม Homography จำลอง
- บท edit: เลื่อนมุมหมุนแล้ว landmark หมุนรอบจุดกลาง
- ซ้อมตอบ: ซ่อน code เปิดแนวตอบและกลับโหมดอ่านได้
- ตรวจหน้าจอมือถือและ keyboard navigation
