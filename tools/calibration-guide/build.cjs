const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const ui = 'tools/calibration-ui/';
const api = 'apps/vision-api/app/';
const chapters = [];
function chapter(id, group, title, intro, steps, files, question, answer, caution) {
  chapters.push({ id, group, title, intro, steps, files: files.map(([p, match, count = 24]) => {
    const text = fs.readFileSync(path.join(root, p), 'utf8').split(/\r?\n/);
    const index = text.findIndex(line => line.includes(match));
    if (index < 0) throw new Error(`${p}: missing ${match}`);
    return { path: p, line: index + 1, code: text.slice(index, index + count).join('\n') };
  }), question, answer, caution });
}
chapter('overview', 'เริ่มต้น', 'ภาพรวมงานที่ต้องอธิบาย', 'Calibration คือการเชื่อมภาพจากกล้องกับพื้นที่บนพื้น ส่วน Lot Model คือแผนผังสถานที่ที่ใช้แสดงผล ทั้งสองส่วนเชื่อมกัน แต่มีหน้าที่คนละอย่าง', [
  ['หน้าเว็บ', 'React รับภาพ การคลิกจุด การแก้แถว และการแก้แผนผัง ส่งข้อมูลไปให้ API'],
  ['Vision API', 'Python ตรวจภาพ ตรวจ geometry แปลงพิกัด คำนวณพื้นที่และช่องว่าง'],
  ['LIFF', 'อ่านข้อมูลที่เผยแพร่และแสดงแผนผังให้นักศึกษา ไม่คำนวณว่าที่ไหนจอดได้เอง']
], [[ui+'components/dashboard/DashboardClient.tsx', 'export function', 20]], 'Calibration กับ Lot Model ต่างกันอย่างไร?', 'Calibration เชื่อมพิกัดภาพกับระนาบพื้น ส่วน Lot Model เก็บแผนผังและ landmark สำหรับแสดงสถานที่ การเปลี่ยนมุมดู 3D ไม่ได้สร้างหลักฐานว่าพื้นที่ว่าง', 'คู่มือนี้อธิบายส่วนที่คุณระบุว่ารับผิดชอบ และโค้ดที่เชื่อมต่อ ไม่ใช่การยืนยันผู้เขียนทุกไฟล์');
chapter('image', 'Calibration', '01 · เริ่มจากภาพหนึ่งภาพ', 'หน้า Parking เริ่มโดยไม่มีภาพ ผู้ใช้ต้องเลือกภาพหรือวิดีโอก่อน จึงมีข้อมูลให้วิเคราะห์', [
  ['เก็บ state', 'file เก็บไฟล์ที่เลือก ส่วน previewUrl เก็บ URL ชั่วคราวสำหรับแสดงภาพ'],
  ['แสดงตัวอย่าง', 'URL.createObjectURL สร้าง URL ในเบราว์เซอร์ ไม่ใช่การอัปโหลดภาพไป API'],
  ['Analyze', 'เมื่อวิเคราะห์จึงส่งภาพผ่านเส้นทาง proxy ไป Python ผลลัพธ์กลับมาอยู่ใน state และส่งต่อให้ component แสดงผล']
], [[ui+'components/camera/ImageAnalyzer.tsx','export function',28],[ui+'lib/lotModelEditorDevProxy.ts','export function lotModelEditorMiddleware',24]], 'ทำไมเปิด Parking ครั้งแรกไม่มีรูป?', 'previewUrl เริ่มเป็น null และไม่มีโค้ดโหลดรูปทดสอบให้อัตโนมัติ ต้องเลือกไฟล์ก่อน ภาพใน test-data มีไว้ให้สคริปต์ทดสอบ', 'ภาพที่ใช้ Calibration ต้องตรงกับความละเอียดและมุมกล้องที่นำไปวิเคราะห์');
chapter('roi', 'Calibration', '02 · ROI และแถวเสมือน', 'ROI คือขอบเขตในภาพที่จะวิเคราะห์ แถวคือพื้นที่ย่อยที่ช่วยจัดรถและหาช่องว่าง ไม่ใช่ช่องจอดที่ตีเส้นไว้', [
  ['วาด polygon', 'คลิกจุดต่อกันเพื่อกำหนด Parking ROI และแถวในภาพ'],
  ['บันทึก', 'หน้าเว็บส่งโครงสร้างไป API เพื่อตรวจและบันทึก ไม่ใช่เพียงวาดเส้นบนหน้าจอ'],
  ['ใช้ในการวิเคราะห์', 'ตำแหน่งรถและหลักฐาน mask ถูกนำไปพิจารณาว่าเกี่ยวข้องกับแถวใด']
], [[ui+'components/setup/ParkingAreaSetup.tsx','export function',24],[ui+'components/setup/CalibrationCanvas.tsx','import',18]], 'ROI กับ row ต่างกันอย่างไร?', 'ROI คือขอบเขตรวมของพื้นที่จอด ส่วน row คือบริเวณย่อยภายในพื้นที่สำหรับวิเคราะห์ ID ของ row เป็นรหัส geometry ภายใน ไม่ใช่หมายเลขช่องจอดจริง', 'อย่าแปลพื้นที่นอก ROI ว่าเป็นที่ว่าง ระบบไม่มีหลักฐานจากบริเวณนั้น');
chapter('points', 'Calibration', '03 · จุด P บอกระยะจริงได้อย่างไร', 'จุด P จับคู่ตำแหน่งที่คลิกในภาพกับพิกัดบนพื้นหน่วยเมตร ระยะจริงมาจากการวัดหรือข้อมูลที่ผู้ดูแลระบุ', [
  ['ฝั่งภาพ', 'image_x และ image_y ระบุจุดในภาพอ้างอิง'],
  ['ฝั่งพื้น', 'ground_x_m และ ground_y_m ระบุพิกัดเมตรในระบบอ้างอิงที่เลือก'],
  ['ที่มาของตัวเลข', 'MEASURED คือข้อมูลวัดจริง ESTIMATED คือข้อมูลประมาณ พร้อมบันทึกความไม่แน่นอนและที่มา'],
  ['คำนวณ map', 'ต้องมีอย่างน้อย 4 จุดที่จัดวางเหมาะสมและไม่อยู่บนเส้นเดียวกัน ก่อนคำนวณ Homography']
], [[ui+'components/setup/GroundMapSetup.tsx','export function',24],[api+'services/ground_plane_calibration_service.py','    def save',22]], 'ระบบรู้ได้อย่างไรว่าในภาพห่างกัน 4 เมตร?', 'เพราะเราใส่พิกัดพื้นของจุดอ้างอิง เช่น (0,0) และ (4,0) ระบบไม่ได้รู้หน่วยเมตรจากภาพเอง', 'ใส่ระยะที่กะมาแล้วเลือก MEASURED ไม่ทำให้ข้อมูลกลายเป็นการวัดจริง');
chapter('homography', 'Calibration', '04 · Homography แปลงภาพเป็นพื้น', 'Homography คือ matrix 3×3 ที่เชื่อมระนาบภาพกับระนาบพื้น ใช้จุด P เป็นข้อมูลสำหรับคำนวณ', [
  ['สร้าง matrix', 'calculate_homography รับคู่จุดภาพกับจุดพื้น สร้างการแปลงแบบ projective'],
  ['ฉายจุด', 'นำ (x,y,1) คูณ matrix แล้วหารด้วยพิกัดตัวท้ายเพื่อได้ตำแหน่งพื้น'],
  ['ตรวจผล', 'บริการตรวจความเหมาะสมของข้อมูลและความสัมพันธ์กับ ROI/แถว ไม่ใช้ matrix ที่ไม่ผ่านการตรวจ'],
  ['แปลงกลับ', 'inverse matrix ใช้ฉาย geometry บนพื้นกลับไปวาดทับภาพ']
], [[api+'services/ground_plane_homography_service.py','def transform_point',20],[api+'services/ground_plane_homography_service.py','def calculate_homography',21]], 'ทำไมไม่ใช้จำนวนพิกเซลต่อเมตรค่าเดียวทั้งภาพ?', 'มุมกล้องทำให้ของไกลดูเล็กและของใกล้ดูใหญ่ สเกลจึงเปลี่ยนตามตำแหน่ง Homography ช่วยคำนวณบนระนาบพื้นตามตำแหน่งนั้น', 'การแปลงนี้ไม่ใช่การสร้างโมเดล 3D ของรถ และไม่ทำให้จุดบนกระจกหรือเบาะกลายเป็นจุดบนพื้นจริง');
chapter('dimensions', 'Calibration', '05 · ขนาดแถวและการตรวจความถูกต้อง', 'นอกจากจุด P ระบบยังรับความยาวและความกว้างของแถว พร้อมที่มาและความไม่แน่นอน เพื่อตรวจ geometry ที่ใช้วิเคราะห์', [
  ['อ่านแถวที่มี', 'โหลด row IDs จาก Parking Calibration ก่อนรับขนาดของแต่ละแถว'],
  ['ใส่ขนาดเมตร', 'เก็บ length_m และ width_m ของแถว ไม่ใช่ขนาด pixel'],
  ['ตรวจและบันทึก', 'ตรวจแหล่งที่มาและข้อมูลที่จำเป็น ก่อนส่งให้ backend เก็บไว้ใช้ตรวจแผนที่พื้น']
], [[ui+'components/setup/PhysicalDimensionsSetup.tsx','export function',25],[ui+'lib/groundProvenance.ts','export function',22]], 'เปลี่ยนจุด P แล้วใช้ผลคำนวณเดิมต่อได้ไหม?', 'ต้องคำนวณและตรวจ Calibration ให้ตรงกับค่าปัจจุบันก่อน ผลที่มาจากข้อมูลเดิมไม่ควรถูกถือว่าใช้ได้กับ geometry ใหม่', 'ความละเอียดภาพ มุมกล้อง จุด P และแถวต้องสอดคล้องกัน');
chapter('seg', 'หาที่ว่าง', '06 · Seg ให้ทั้งกรอบและรูปร่างรถ', 'YOLO-seg ให้ Bounding box, confidence และ polygon ของ mask ส่วนจุดสีเหลืองคำนวณจากกึ่งกลางขอบล่างของกรอบ', [
  ['Bounding box', 'x,y คือมุมซ้ายบน width,height คือขนาดกรอบ ในข้อมูลนี้ใช้สัดส่วนของภาพ'],
  ['Mask', 'polygon บอกบริเวณรูปร่างรถที่มองเห็น ใช้เป็นหลักฐานภาพประกอบการวิเคราะห์'],
  ['จุดสีเหลือง', 'x = bbox.x + width/2 และ y = bbox.y + height เป็นจุดอ้างอิงโดยประมาณ ไม่ใช่ล้อที่ AI ตรวจพบ'],
  ['โมเดล', 'ค่าเริ่มต้นใน parking_inference_settings.py ชี้ไป YOLO26n-seg checkpoint แต่ environment อาจเปลี่ยนตัวที่โหลดได้']
], [[api+'services/segmentation_experiment_service.py','    def __init__',22],[ui+'components/parking/SegmentationExperiment.tsx','data-segmentation-bbox',4]], 'Bounding box ต่างจาก mask อย่างไร?', 'กรอบเป็นสี่เหลี่ยมครอบวัตถุ ส่วน mask ตามรูปร่างที่ตรวจพบ รถเอียงหรือกระจกยื่นทำให้ความกว้างกรอบไม่ตรงกับความกว้างตัวรถ', 'การไม่ตรวจพบรถไม่ใช่หลักฐานว่าบริเวณนั้นว่าง');
chapter('width', 'หาที่ว่าง', '07 · แปลงขอบกรอบ Seg เป็นเมตรโดยตรง', 'ระบบแปลงจุดซ้ายและขวาของขอบล่าง Bounding box ผ่าน Homography แล้ววัดระยะระหว่างพิกัดพื้นทั้งสอง ไม่ใช้ช่วง ±16 px หรือคูณขยายสเกลตรงกลางอีกแล้ว', [
  ['เลือกสองจุด', 'ซ้าย = (bbox.x, bbox.y + bbox.height) ขวา = (bbox.x + bbox.width, bbox.y + bbox.height) ทั้งคู่ใช้พิกัดสัดส่วนภาพ'],
  ['ตรวจขอบเขต', 'กรอบต้องอยู่ในภาพ matrix ต้องใช้ได้ และขอบล่างต้องไม่ตัดผ่าน projective horizon ซึ่งทำให้ระยะบนพื้นไม่จำกัด'],
  ['แปลงเป็นเมตร', 'transform_point แปลงสองจุดผ่าน Homography เดียวกับ Calibration โดยไม่ต้องแปลงสัดส่วนภาพเป็น pixel ก่อน'],
  ['วัดระยะ', 'math.dist(left_ground, right_ground) ได้ระยะประมาณเป็นเมตร รับเฉพาะค่าจำกัดที่มากกว่า 0 และไม่เกิน 3 เมตร']
], [[api+'services/motorcycle_width_estimation.py','def estimate_width_m',28],[api+'services/segmentation_gap_service.py','        estimated_widths =',10]], 'ยังต้องใช้ ±16 px หาสเกลไหม?', 'ไม่ต้องแล้ว โค้ดใช้ขอบซ้าย–ขวาของกรอบที่ระดับล่างเดียวกัน แปลงเป็นพิกัดพื้นแล้ววัดระยะโดยตรง ถ้าคำนวณไม่ได้ ส่วนเรียกใช้ยัง fallback ไปขนาดอ้างอิง', 'เป็นความกว้างกรอบที่ประมาณบนระนาบพื้น ไม่ใช่การวัดความกว้างตัวรถหรือกระจกจริง รถเอียงและความสูงยังทำให้คลาดเคลื่อนได้');
chapter('gaps', 'หาที่ว่าง', '08 · ช่องว่างเกิดจากโค้ดส่วนไหน', 'analyze_segmentation_gaps รวม Calibration, แถว, รถและ mask เพื่อประเมินช่องว่าง ส่วนพื้นที่ที่ดูว่างในภาพยังต้องผ่านเงื่อนไขอื่นก่อน', [
  ['โหลด Calibration', 'ตรวจให้ข้อมูลพื้นและขนาดภาพตรงกับรอบวิเคราะห์'],
  ['จัดรถเข้าแถว', 'ใช้จุดอ้างอิงและหลักฐานภาพ เลี่ยงการเลือกแถวที่กำกวมเป็นผลที่แน่นอน'],
  ['สร้าง geometry', 'สร้างพื้นที่รถตาม reference dimensions แล้วใช้ geometry เพื่อหาพื้นที่/ช่วงที่เหลือ'],
  ['วัดและประเมิน', 'evaluate_gap_geometry ตรวจความกว้าง ระยะเผื่อ การบัง ความไม่แน่นอน และสร้างผลลัพธ์ให้หน้าเว็บ']
], [[api+'services/segmentation_gap_service.py','def analyze_segmentation_gaps',23],[api+'services/segmentation_gap_service.py','        result = evaluate_gap_geometry',12]], 'พื้นที่เหลือมาก แปลว่าจอดได้เสมอไหม?', 'ไม่เสมอ พื้นที่รวมอาจกระจายเป็นช่องแคบหรือมีรถบัง ต้องดูรูปทรง ความกว้างและข้อจำกัดที่โค้ดประเมิน ผล preview ด้านความกว้างยังไม่ใช่หลักฐานว่าขี่เข้าไปจอดได้ครบทุกเงื่อนไข', 'อย่าสรุปว่าระบบตรวจทางเข้าออกหรือความลึกครบ ถ้าโหมดปัจจุบันประเมินเพียงความกว้าง');
chapter('uncertain', 'หาที่ว่าง', '09 · การบังและความไม่แน่นอน', 'ว่างเชิงเรขาคณิต กับมีหลักฐานว่าจอดได้ เป็นคนละเรื่อง รถอาจบังพื้น และภาพอาจเก่าหรือ Calibration ใช้ไม่ได้', [
  ['AVAILABLE', 'สถานะพร้อมใช้งานต้องมีหลักฐานตามสัญญา backend ไม่ใช่เพียง browser วาดสีเขียว'],
  ['ALMOST_AVAILABLE', 'คำแนะนำว่าอาจต้องขยับรถ ไม่ใช่คำรับรองให้เคลื่อนรถของผู้อื่น'],
  ['UNKNOWN', 'ข้อมูลไม่พอ เก่า ถูกบัง หรือไม่ผ่านการตรวจ ต้องไม่ตีความเป็นว่าง'],
  ['UNMONITORED', 'พื้นที่นอกการติดตาม ไม่มีคำอ้างเรื่องที่ว่าง']
], [[ui+'components/parking/GapOcclusionInspector.tsx','export function',20],[api+'services/uncertainty_service.py','def ',24]], 'ทำไมจึงต้องมี UNKNOWN?', 'เพื่อแยกไม่มีหลักฐานออกจากว่าง ถ้าใช้ภาพเก่าหรือมองไม่เห็นพื้น การแสดงว่าว่างอาจทำให้ผู้ใช้ขี่เข้าไปแล้วจอดไม่ได้', 'สีและชื่อในหน้าทดลองอาจเป็นสถานะเฉพาะการวิเคราะห์ ต้องดู mapping ไป API ก่อนอธิบายว่าเป็นสถานะใช้งานจริง');
chapter('shared', 'หาที่ว่าง', '10 · Calibration กับ LIFF ใช้โค้ดเดียวกันไหม', 'ทั้งเส้นทาง operator แบบ Segmentation และ worker เรียก analyze_segmentation_gaps ร่วมกัน แต่ข้อมูลนำเข้า เวลา และขั้นตอนแสดงผลต่างกัน', [
  ['Calibration', 'classifier.py เรียก detector แล้ว analyze_segmentation_gaps ส่งผลกลับหน้า Parking'],
  ['Worker', 'frame_analysis_service.py วิเคราะห์ภาพ แล้ว build_segmentation_state_publish เพื่อส่ง state เข้า API'],
  ['LIFF', 'อ่าน parking-state และนำไปแสดง มีการแปลงสู่พิกัด lot และนโยบายความสดของข้อมูล'],
  ['เงื่อนไขเปรียบเทียบ', 'ต้องเทียบภาพ โมเดล พารามิเตอร์ Calibration และเวลาเดียวกัน ไม่เช่นนั้นผลอาจต่าง']
], [[api+'classifier.py','async def analyze_segmentation_primary',23],[api+'services/frame_analysis_service.py','def analyze_segmentation_frame',30]], 'อธิบายว่าใช้โค้ดเดียวกันได้ไหม?', 'ได้ โดยเจาะจงว่าใช้แกนคำนวณช่องว่าง analyze_segmentation_gaps ร่วมกัน หน้าเว็บและขั้นตอนรับภาพไม่ใช่โค้ดชุดเดียวทั้งหมด', 'การย้ายหรือย่อแผนผังสำหรับแสดงผลไม่ควรเปลี่ยนระยะกายภาพที่ใช้วิเคราะห์');
chapter('lot', 'Lot Model Editor', '11 · แผนผังสถานที่และ landmark', 'Lot Model เป็นแผนผังคงที่ของสถานที่ ประกอบด้วย outline, parking_areas และ landmarks ไม่ใช่โมเดลที่สร้างรูปทรงจริงจากกล้องหนึ่งภาพ', [
  ['Outline', 'ขอบเขตของลานที่ใช้เป็นกรอบของแผนผัง'],
  ['Parking areas / ROI', 'polygon ของพื้นที่ที่กล้องรับผิดชอบ ต้องอยู่ในขอบลานและไม่ทับกันอย่างผิดเงื่อนไข'],
  ['Landmark', 'สิ่งอ้างอิง เช่น อาคาร ต้นไม้ ทางเดิน ทางเข้า ช่วยให้ผู้ใช้เทียบแผนที่กับสถานที่'],
  ['2D / 3D', 'แก้พิกัดและคุณสมบัติผ่าน canvas ดู preview 3D จาก geometry เดียวกัน']
], [[ui+'components/lot-model/LotModelEditor.tsx','function definitionOnly',6],[ui+'lib/lotModelEditor.ts','export function newLandmark',22]], 'ทำไมต้องมี landmark?', 'ช่วยให้ผู้ใช้รู้ว่าตำแหน่งในแผนที่ตรงกับส่วนไหนของสถานที่จริง แต่ landmark ไม่ได้ให้หลักฐานว่าตรงนั้นมีที่จอดว่าง', 'แยกค่าประมาณของแผนผังออกจากข้อมูลสำรวจ อย่าอธิบายว่าภาพ 3D คือการสร้างรถจริงจากกล้อง');
chapter('edit', 'Lot Model Editor', '12 · ย้าย หมุน ย่อขยาย และ Undo', 'การแก้รูปทรงคือการแก้จุดพิกัดในข้อมูล React ส่วน canvas เป็นผู้วาดข้อมูลนั้นออกมา', [
  ['ย้าย', 'moveLandmark ปรับตำแหน่งและจุด polygon ตามระยะที่เปลี่ยน'],
  ['หมุน', 'rotatePolygonObject ใช้ sin/cos หมุนทุกจุดรอบตำแหน่งอ้างอิงของวัตถุ'],
  ['ย่อขยาย', 'scalePolygonObject ขยายระยะจากศูนย์กลางด้วย factor เดียว รักษารูปร่างและวง polygon'],
  ['Undo / Redo', 'history มี past, present, future เปลี่ยนข้อมูลที่แสดงโดยยังไม่จำเป็นต้องบันทึก server']
], [[ui+'lib/lotModelEditor.ts','export function rotatePolygonObject',24],[ui+'components/lot-model/LotModelEditor.tsx','interface History',16]], 'กดหมุนบนจอแล้วข้อมูลเปลี่ยนอย่างไร?', 'ฟังก์ชันคำนวณพิกัดใหม่ของทุกจุดรอบศูนย์กลาง แล้วคืน object ใหม่ให้ state React canvas จึงวาดตามข้อมูลใหม่ ไม่ได้หมุนเพียงภาพหน้าจอ', 'uniform display scale เป็นการปรับการแสดงแผนผัง ไม่ใช่การวัดพื้นที่จริงใหม่');
chapter('save', 'Lot Model Editor', '13 · Save draft ต่างจาก Activate', 'บันทึกฉบับร่างเพื่อแก้ต่อได้ ส่วน Activate คือเปิดเวอร์ชันให้ LIFF ใช้ ระบบตรวจ revision เพื่อป้องกันการเขียนทับงานเก่า', [
  ['Save draft', 'ส่ง definition, expected_revision และ base_version ผ่าน proxy ไป backend'],
  ['ตรวจ API', 'ตรวจสิทธิ์และ validate geometry พร้อมตรวจความสอดคล้องของเวอร์ชัน'],
  ['Activate', 'ต้องบันทึกก่อน เปิดใช้ draft ที่ตรวจแล้วเป็น lot-model version ใหม่'],
  ['ผลกับ LIFF', 'LIFF ยังอ่าน active version เดิมจนกว่าจะ activate และโหลดข้อมูลใหม่']
], [[ui+'components/lot-model/LotModelEditor.tsx','  async function save()',26],[api+'lot_model_editor.py','def validate_definition',26],[ui+'lib/lotModelProxy.ts','export',25]], 'ทำไมต้องแยก Save กับ Activate?', 'เพื่อให้ปรับและตรวจฉบับร่างก่อนเผยแพร่แก่ผู้ใช้จริง expected_revision และ base_version ช่วยตรวจว่ากำลังแก้จากข้อมูลเก่าหรือไม่ ถ้าไม่ตรงต้องโหลดใหม่', 'คู่มือนี้เป็นเว็บอ่านโค้ด การกดตัวอย่างในคู่มือไม่บันทึกหรือเปลี่ยนแผนผังจริง');
chapter('review', 'เตรียมอธิบาย', '14 · ตามข้อมูลตั้งแต่คลิกจนถึงผลลัพธ์', 'เวลาอธิบายให้เริ่มจากปัญหา ตามด้วยข้อมูลเข้า ฟังก์ชันสำคัญ ผลลัพธ์ และข้อจำกัด ไม่ต้องท่องทุกบรรทัด', [
  ['ตั้งค่าพื้น', 'ภาพ → ROI/แถว → จุด P/ระยะเมตร → คำนวณและตรวจ Homography'],
  ['หาที่ว่าง', 'ภาพ → YOLO-seg → bbox/mask → พิกัดพื้นและแถว → geometry/ช่องว่าง → แสดงผล'],
  ['แก้แผนผัง', 'เลือก site → โหลด draft/active model → แก้ landmark/ROI → Save draft → Activate → LIFF'],
  ['ขอบเขตงาน', 'อธิบาย frontend ที่คุณทำ และ backend ที่เชื่อมต่อ แยกจากความรับผิดชอบเรื่อง training, Label, Route และ Mobile Camera ที่ไม่ได้รวมเป็นบทเฉพาะ']
], [[ui+'components/setup/SetupWorkspace.tsx','import',20]], 'ถ้าอาจารย์ถามว่า AI รู้ระยะจริงได้อย่างไร จะตอบว่าอะไร?', 'AI ตรวจตำแหน่งรถในภาพ ส่วนหน่วยเมตรมาจาก Calibration ที่เราป้อนคู่จุดภาพกับพิกัดพื้น การประมาณความกว้างแปลงขอบล่างซ้าย–ขวาของกรอบผ่าน Homography แล้ววัดระยะ ไม่ใช่ AI วัดความกว้างจริงโดยตรง', 'ตัวอย่างในคู่มือใช้ค่าจำลองเพื่ออธิบาย ไม่ใช่ผลวัดความแม่นยำของระบบ');
let revision = 'local';
try {
  revision = cp.execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const state = cp.spawnSync('git', ['diff', '--quiet', '--', 'apps/vision-api/app', 'tools/calibration-ui'], { cwd: root });
  if (state.status === 1) revision += ' + local changes';
} catch {}
fs.mkdirSync(path.join(__dirname, 'dist'), {recursive:true});
fs.writeFileSync(path.join(__dirname, 'dist/content.js'), 'window.GUIDE = '+JSON.stringify({revision, chapters})+';\n');
for (const file of ['index.html','style.css','syntax.js','screens.js','app.js']) fs.copyFileSync(path.join(__dirname,file),path.join(__dirname,'dist',file));
console.log(`Built ${chapters.length} chapters with ${chapters.reduce((n,c)=>n+c.files.length,0)} verified source excerpts (${revision})`);
