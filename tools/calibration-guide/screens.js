/* Accessible SVG teaching screens. All coordinates and values are illustrative. */
(function(root){
  'use strict';
  const examples = {
    overview:['ภาพรวมหน้าทำงาน','หน้า Setup กำหนด geometry ส่วน Parking วิเคราะห์ภาพ และ Lot Model Editor แก้แผนผัง','workspace'],
    image:['เลือกภาพก่อนวิเคราะห์','① เลือกไฟล์ → ② ดูภาพตัวอย่าง → ③ กด Analyze เพื่อส่งภาพให้ Python','image'],
    roi:['ROI กับแถวเสมือนอยู่ตรงไหน','กรอบฟ้าคือขอบเขตวิเคราะห์ แถบม่วง R1–R3 คือพื้นที่ย่อยสำหรับจัดรถ ไม่ใช่ช่องจอดที่ตีเส้น','rows'],
    points:['จับคู่จุด P ในภาพกับพื้น','P1–P4 เป็นจุดอ้างอิงบนพื้น ผู้ดูแลป้อนพิกัดเมตรของจุดเดียวกัน ไม่ใช่จุดที่ AI เดาระยะให้','points'],
    homography:['จุดภาพเดียวกัน ไปอยู่บนพื้นตรงไหน','ภาพมุมกล้องเป็นสี่เหลี่ยมคางหมู เมื่อใช้ matrix แปลงบนระนาบพื้นจะได้พิกัดเมตร ตัวอย่างนี้เป็นเพียงภาพอธิบาย','homography'],
    dimensions:['ขนาดแถวไม่ใช่ขนาดกรอบภาพ','ใส่ความยาว/ความกว้างหน่วยเมตร พร้อมที่มา ตัวเลขในภาพจำลองนี้ไม่ใช่ค่าที่สำรวจจริง','dimensions'],
    seg:['กรอบ Mask และจุดสีเหลือง','เส้นประฟ้าเป็น Bounding box พื้นที่เขียวอมฟ้าคือ mask และจุดเหลืองคือกึ่งกลางขอบล่างของกรอบ','seg'],
    width:['ตำแหน่งที่ใช้ประมาณความกว้าง','ใช้จุดซ้าย–ขวาที่ขอบล่างของ Bounding box แปลงเป็นพิกัดพื้น แล้ววัดระยะเมตรทั้งช่วงโดยตรง','width'],
    gaps:['รถอยู่ตรงไหน ช่องว่างอยู่ตรงไหน','ดูภาพกล้องเทียบกับแผนภาพบนพื้น ช่องว่างเชิงเรขาคณิตต้องผ่านการประเมินก่อนนำไปใช้เป็นสถานะที่จอด','gaps'],
    uncertain:['มองไม่เห็น ไม่ได้แปลว่าว่าง','บริเวณแรเงาหลังรถคือพื้นซึ่งอาจถูกบัง จึงไม่ควรอนุมานว่าพื้นนั้นว่าง','occlusion'],
    shared:['สองเส้นทาง เรียกแกนคำนวณร่วมกัน','Calibration ส่งภาพที่เลือก ส่วน worker รับภาพจากแหล่งข้อมูล ทั้งสองเรียก analyze_segmentation_gaps แล้วแสดงผลคนละทาง','shared'],
    lot:['องค์ประกอบของ Lot Model Editor','ขอบลาน ROI อาคารและต้นไม้เป็นข้อมูลแผนผังคงที่ แยกจากข้อมูลรถที่ตรวจได้ในแต่ละเฟรม','lot'],
    edit:['เลือกวัตถุแล้วแก้คุณสมบัติ','แผงขวาแสดงพิกัด ขนาด และมุมของ landmark ที่เลือก การปรับค่าจะเปลี่ยน geometry ใน state','edit'],
    save:['บันทึกฉบับร่าง กับเปิดใช้จริง','Save draft เก็บงานไว้แก้ต่อ ส่วน Activate สร้างเวอร์ชันที่ LIFF ใช้ ภาพนี้แสดงลำดับแนวคิด ไม่ได้เรียก API จริง','save'],
    review:['เส้นทางที่ใช้เล่าโค้ด','เล่าจากข้อมูลเข้า ตามด้วยจุดที่เปลี่ยนข้อมูล ฟังก์ชันสำคัญ และผลที่ส่งต่อให้ผู้ใช้','shared'],
  };
  const text=(x,y,value,size=13,color='#37584d')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${value}</text>`;
  const box=(x,y,w,h,fill,stroke='#c1cdbd',radius=5)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
  function car(x,y){return `<g transform="translate(${x} ${y})"><ellipse cx="0" cy="0" rx="10" ry="24" fill="#42645d"/><rect x="-5" y="-16" width="10" height="29" rx="4" fill="#79958a"/><path d="M-14 -12H14" stroke="#263f39" stroke-width="3"/></g>`}
  function camera(mode){
    let out=box(28,76,536,305,'#e0e6d7');
    for(let y=120;y<370;y+=43)out+=`<path d="M28 ${y}H564" stroke="#cbd5c1"/>`;
    out+=`<path d="M150 105L440 105L530 350L60 350Z" fill="#f2f0dc" stroke="#b9c4ae"/>`;
    const roi=`<polygon points="150,105 440,105 530,350 60,350" fill="#48b7dc" fill-opacity=".08" stroke="#1584b2" stroke-width="3"/>`;
    const rows=`<g stroke="#8d65b1" fill="#9e78ba" fill-opacity=".15" stroke-width="2"><polygon points="155,122 436,122 454,174 135,174"/><polygon points="124,198 463,198 482,251 105,251"/><polygon points="92,276 493,276 513,333 71,333"/></g>${text(166,153,'R1',13,'#6e4490')}${text(141,230,'R2',13,'#6e4490')}${text(112,308,'R3',13,'#6e4490')}`;
    out+=`<g data-demo-roi>${roi}</g><g data-demo-rows>${rows}</g>`;
    if(mode==='points'||mode==='homography'){
      [[150,105,'P1'],[440,105,'P2'],[530,350,'P3'],[60,350,'P4']].forEach(([x,y,label])=>{out+=`<circle cx="${x}" cy="${y}" r="6" fill="#e6b738" stroke="#7c6528"/>${text(x+10,y-10,label,14,'#624a19')}`});
    } else if(!['dimensions','rows'].includes(mode)){
      [[240,150],[290,150],[350,225],[210,300],[270,300],[330,300]].forEach(([x,y])=>out+=car(x,y));
    }
    if(['seg','width','occlusion'].includes(mode)){
      out+=`<g data-demo-mask><path d="M230 127L247 126L256 148L248 174L232 173L222 148Z" fill="#34c8b8" fill-opacity=".65" stroke="#198c87" stroke-width="2"/></g><g data-demo-bbox><rect x="218" y="120" width="44" height="60" fill="none" stroke="#287ac1" stroke-dasharray="5 3" stroke-width="2"/></g><circle cx="240" cy="180" r="5" fill="#e9bd30" stroke="#554d25"/>${text(280,151,'bbox + mask',12)}<path d="M266 149H277" stroke="#287ac1"/>`;
    }
    if(mode==='width')out+=`<path d="M218 108H262M218 104V112M262 104V112" stroke="#287ac1" stroke-width="2"/>${text(188,96,'ความกว้างกรอบในภาพ',11)}<path d="M218 180H262" stroke="#a3691d" stroke-width="2"/><circle cx="218" cy="180" r="4" fill="#edb943"/><circle cx="262" cy="180" r="4" fill="#edb943"/>${text(165,211,'ซ้าย → Homography ← ขวา',11,'#87601d')}`;
    if(mode==='occlusion')out+=`<path d="M219 120L201 80H280L260 120Z" fill="url(#unknown-hatch)" stroke="#a4773d"/>${text(296,97,'พื้นอาจถูกบัง',13,'#926123')}`;
    if(mode==='gaps')out+=`<rect x="183" y="199" width="74" height="52" fill="#c5d7a6" stroke="#738d4d" stroke-width="2"/>${text(185,192,'ช่วงที่ต้องประเมิน',11)}`;
    return out;
  }
  function panel(title,lines){return box(585,76,245,305,'#fff')+text(605,106,title,14)+lines.map((s,i)=>text(605,140+i*29,s,12)).join('')}
  function lot(mode){let out=box(28,76,536,305,'#edf0e5')+`<polygon points="70 100 460 100 520 350 80 350" fill="#dce2cf" stroke="#879d83" stroke-width="2"/><polygon points="120 180 420 180 450 320 120 320" fill="#d2e4e8" stroke="#238db0" stroke-width="3"/>`;
    out+=`<g transform="rotate(-10 246 136)">${box(154,108,184,55,'#d3bfa4','#8d755c')}${text(210,140,'อาคาร',14)}</g>`;
    [[95,150],[485,215],[470,315]].forEach(([x,y])=>out+=`<circle cx="${x}" cy="${y}" r="17" fill="#91b17c" stroke="#557f52"/><circle cx="${x}" cy="${y}" r="4" fill="#56774d"/>`);
    out+=text(145,210,'Parking ROI',14,'#237b97')+text(91,341,'ขอบลาน',11);
    if(mode==='edit')out+=`<rect x="145" y="91" width="200" height="85" fill="none" stroke="#cd853b" stroke-dasharray="4 3"/><circle cx="145" cy="91" r="4" fill="#cd853b"/><circle cx="345" cy="176" r="4" fill="#cd853b"/>`;
    return out+panel(mode==='edit'?'Landmark ที่เลือก':'องค์ประกอบแผนผัง',mode==='edit'?['ประเภท: อาคาร','x: 6.0 m   y: 2.0 m','กว้าง: 4.0 m','ยาว: 2.0 m','มุมหมุน: −10°','สถานะ: ยังไม่บันทึก']:['ขอบลาน · outline','พื้นที่กล้อง · parking_areas','อาคาร / ต้นไม้ · landmarks','พิกัดเป็นเมตร','ข้อมูลแผนผังคงที่']);
  }
  function flow(save){const labels=save?['แก้ในหน้าจอ','Save draft','Activate']:['Calibration','Python / ช่องว่าง','Worker → LIFF'];let out='';labels.forEach((s,i)=>{const x=40+i*275;out+=box(x,132,225,156,i===1?'#dbe8bf':'#fff')+text(x+20,166,s,17)+text(x+20,200,save?['React state','Postgres draft','Active lot version'][i]:['ภาพที่ผู้ใช้เลือก','แกนคำนวณร่วมกัน','ภาพที่ worker วิเคราะห์'][i],11)+text(x+20,234,save?['ยังไม่ส่ง server','LIFF ยังใช้ฉบับเดิม','LIFF ใช้เวอร์ชันใหม่'][i]:['analyze_segmentation_primary','analyze_segmentation_gaps','analyze_segmentation_frame'][i],10);if(i<2)out+=text(x+236,216,'→',25)});return out+text(50,340,save?'expected_revision + base_version ช่วยป้องกันการเขียนทับข้อมูลเก่า':'ภาพและค่าตั้งต้องตรงกันก่อนเปรียบเทียบผลจากสองเส้นทาง',13)}
  function figure(id){const info=examples[id]||examples.overview;const mode=info[2];let body='';
    if(mode==='lot'||mode==='edit')body=lot(mode);
    else if(mode==='save'||mode==='shared')body=flow(mode==='save');
    else if(mode==='homography')body=camera(mode)+panel('พิกัดพื้น (ตัวอย่าง)',['P1 → (0, 0) m','P2 → (4, 0) m','P3 → (4, 6) m','P4 → (0, 6) m','ภาพ → H → พื้น','ระยะมาจากผู้ดูแล']);
    else body=camera(mode)+panel(mode==='points'?'Control points':mode==='dimensions'?'ขนาดแถว (ตัวอย่าง)':mode==='image'?'วิเคราะห์ภาพ':mode==='seg'||mode==='width'?'คำอธิบายสัญลักษณ์':'พื้นที่จอด',mode==='points'?['P1: image ↔ ground','P2: image ↔ ground','P3: image ↔ ground','P4: image ↔ ground','บันทึกจุด → คำนวณ map']:mode==='dimensions'?['R1: 6.0 × 1.8 m','R2: 6.0 × 1.8 m','R3: 6.0 × 1.8 m','ที่มา: ESTIMATED','ตัวเลขจำลองเพื่ออธิบาย']:mode==='seg'||mode==='width'?['เส้นประฟ้า = Bounding box','สีเขียวอมฟ้า = Mask','จุดเหลือง = กึ่งกลางล่าง','กรอบ ≠ ขนาดรถจริง','พิกเซล → สเกล → เมตร']:mode==='image'?['① Choose file','② ดูภาพตัวอย่าง','③ Analyze','→ ส่งภาพให้ Python','→ รับผลมาวาดบนจอ']:['ฟ้า: Parking ROI','ม่วง: แถว R1–R3','รถ: จุดตรวจจับจำลอง','แถวไม่ใช่ช่องจอดจริง','ขอบภาพไม่ใช่ระยะเมตร']);
    const toggles=['rows','points','seg','width','occlusion','gaps'].includes(mode)?`<div class="screen-controls"><label><input type="checkbox" data-layer="roi" checked> ROI</label><label><input type="checkbox" data-layer="rows" checked> แถวเสมือน</label>${['seg','width','occlusion'].includes(mode)?'<label><input type="checkbox" data-layer="bbox" checked> Bounding box</label><label><input type="checkbox" data-layer="mask" checked> Mask</label>':''}</div>`:'';
    return `<figure class="example-screen"><figcaption><span class="eyebrow">หน้าจอตัวอย่างจำลอง</span><h2>${info[0]}</h2><p>${info[1]}</p></figcaption>${toggles}<svg viewBox="0 0 860 415" role="img" aria-labelledby="screen-title screen-desc"><title id="screen-title">${info[0]}</title><desc id="screen-desc">${info[1]} ภาพจำลองเพื่อเรียนรู้ ไม่ใช่ภาพหน้าจอหรือผลจากระบบจริง</desc><defs><pattern id="unknown-hatch" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M0 8L8 0" stroke="#ba985f" stroke-width="2"/></pattern></defs>${box(1,1,858,413,'#f8faf4','#c8d2c0',9)}${box(1,1,858,48,'#edf1e7','#c8d2c0',9)}${text(22,30,'ParkMap / '+(mode==='lot'||mode==='edit'||mode==='save'?'Lot Model Editor':'Calibration'),14)}${text(656,30,'ILLUSTRATIVE VIEW',10,'#78816f')}${body}</svg><p class="screen-disclaimer">ภาพประกอบสร้างจากแนวคิดในโค้ด · พิกัด จำนวนรถ และขนาดในภาพเป็นค่าจำลอง · ไม่ใช่ผลตรวจจับหรือหน้าจอจริง</p></figure>`;
  }
  root.ParkMapScreens={figure,ids:Object.keys(examples)};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ParkMapScreens;
})(globalThis);
