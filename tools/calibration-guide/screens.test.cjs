const test=require('node:test');
const assert=require('node:assert/strict');
const {figure,ids}=require('./screens.js');
test('every chapter has an explicitly labelled teaching screen',()=>{
  assert.equal(ids.length,15);
  for(const id of ids){const html=figure(id);assert.ok(html.includes('<svg'));assert.ok(html.includes('<title'));assert.ok(html.includes('ไม่ใช่ผลตรวจจับหรือหน้าจอจริง'));assert.ok(!html.includes('undefined'));}
});
test('ROI and virtual rows are independent layers with visible controls',()=>{
  const html=figure('roi');
  for(const layer of ['roi','rows']){assert.ok(html.includes(`data-demo-${layer}`));assert.ok(html.includes(`data-layer="${layer}"`));}
  for(const row of ['R1','R2','R3'])assert.ok(html.includes(row));
});
test('segmentation screen separates box, mask and ground anchor',()=>{
  const html=figure('seg');
  assert.ok(html.includes('data-demo-bbox'));assert.ok(html.includes('data-demo-mask'));assert.ok(html.includes('กึ่งกลางล่าง'));
});
