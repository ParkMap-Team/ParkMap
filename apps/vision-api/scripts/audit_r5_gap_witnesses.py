"""Map authoritative R5 capacity witnesses to detected-footprint gaps."""
from __future__ import annotations
import argparse, mimetypes, json
from pathlib import Path
from fastapi.testclient import TestClient
from shapely.geometry import Polygon
from shapely.affinity import rotate, translate
from PIL import Image, ImageDraw
from app.main import app
from app.services.virtual_fitting_service import _row_angle

def shape(g):
    rings=g.get('polygons',[]) if isinstance(g,dict) else []
    if not rings:return Polygon()
    return Polygon([(p['x_m'],p['y_m']) for p in rings[0][0]])
def project(p,m):
    q=[m[0][0]*p['x_m']+m[0][1]*p['y_m']+m[0][2],m[1][0]*p['x_m']+m[1][1]*p['y_m']+m[1][2],m[2][0]*p['x_m']+m[2][1]*p['y_m']+m[2][2]]
    return None if abs(q[2])<1e-12 else (q[0]/q[2],q[1]/q[2])
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('image',type=Path); a=ap.parse_args()
    with a.image.open('rb') as h:r=TestClient(app).post('/api/detection/analyze',files={'image':(a.image.name,h,mimetypes.guess_type(a.image.name)[0] or 'image/png')})
    r.raise_for_status(); payload=r.json(); an=payload['parking_analysis']; row=next(x for x in an['physical_map']['rows'] if x['row_id']=='row_5'); rowpoly=shape({'polygons':[[row['polygon']]]}); angle=_row_angle(rowpoly); origin=rowpoly.centroid
    detections=[]
    for d in an['detections']:
        if d.get('row_assignment_v2',{}).get('assigned_row_id')=='row_5': detections.append((d,rotate(translate(shape(d['canonical_footprint']),-origin.x,-origin.y),-angle,origin=(0,0))))
    detections.sort(key=lambda x:x[1].centroid.x); cap=next(x for x in an['capacity']['rows'] if x['row_id']=='row_5'); witnesses=[]
    for i,p in enumerate(cap.get('placements',[])):
        w=shape(p['footprint_metric']); witnesses.append((i,w,rotate(translate(w,-origin.x,-origin.y),-angle,origin=(0,0))))
    assignments=[]; edges=[]
    for i,w,lw in witnesses:
        left=[(d,fp) for d,fp in detections if fp.bounds[2]<=lw.bounds[0]]; right=[(d,fp) for d,fp in detections if fp.bounds[0]>=lw.bounds[2]]
        if left and right: gap=(left[-1][0]['detection_id'],right[0][0]['detection_id']); region=f'{gap[0]} -> {gap[1]}'
        elif not left: region='BEFORE_FIRST_DETECTION'
        else: region='AFTER_LAST_DETECTION'
        assignments.append((i,region,lw)); print(f'W{i}: region={region} local_bounds={lw.bounds} metric={w.wkt}')
    print('\nR5 GAP-TO-WITNESS AUDIT'); print(f'Production Capacity: {cap.get("capacity",0)}'); print(f'Witnesses accounted: {len(assignments)}')
    print('\nGap | Production Witness Count | Witness Indices')
    groups={}
    for i,region,_ in assignments: groups.setdefault(region,[]).append(i)
    for region,ids in groups.items(): print(f'{region} | {len(ids)} | {ids}')
    print(f'WITNESS_ACCOUNTING: {"PASS" if len(assignments)==cap.get("capacity",0) else "WITNESS_ACCOUNTING_MISMATCH"}')
    out=Path('debug_output'); out.mkdir(exist_ok=True); im=Image.open(a.image).convert('RGB'); dr=ImageDraw.Draw(im); h=json.loads(Path(__file__).resolve().parents[1].joinpath('config/ground_plane_homography.json').read_text()); W,H=im.size
    rp=[project({'x_m':p['x_m'],'y_m':p['y_m']},h['inverse_matrix']) for p in row['polygon']]; rp=[(int(x*W),int(y*H)) for x,y in rp if x is not None]; dr.line(rp+[rp[0]],fill=(0,180,255),width=5)
    for d,fp in detections:
        q=[project({'x_m':p['x_m'],'y_m':p['y_m']},h['inverse_matrix']) for p in d['canonical_footprint']['polygons'][0][0]]; q=[(int(x*W),int(y*H)) for x,y in q if x is not None]; dr.line(q+[q[0]],fill=(255,80,180),width=3); dr.text(q[0],d['detection_id'],fill=(255,40,40))
    for i,w,_ in witnesses:
        q=[project({'x_m':p['x_m'],'y_m':p['y_m']},h['inverse_matrix']) for p in cap['placements'][i]['footprint_metric']['polygons'][0][0]]; q=[(int(x*W),int(y*H)) for x,y in q if x is not None]; dr.line(q+[q[0]],fill=(40,220,80),width=3); dr.text(q[0],f'W{i}',fill=(20,120,20))
    im.save(out/'r5_gap_witness_audit.png')
    # Metric top-down rendering with a stable scale.
    minx,miny,maxx,maxy=rowpoly.bounds; scale=100; canvas=Image.new('RGB',(int((maxx-minx)*scale+120),int((maxy-miny)*scale+120)),'white'); md=ImageDraw.Draw(canvas); conv=lambda x,y:(int((x-minx)*scale+60),int((maxy-y)*scale+60)); md.line([conv(*p) for p in list(rowpoly.exterior.coords)],fill='blue',width=3)
    for d,fp in detections: md.line([conv(*p) for p in list(fp.exterior.coords)],fill='magenta',width=3); md.text(conv(fp.centroid.x,fp.centroid.y),d['detection_id'],fill='red')
    for i,w,_ in witnesses: md.line([conv(*p) for p in list(w.exterior.coords)],fill='green',width=3); md.text(conv(w.centroid.x,w.centroid.y),f'W{i}',fill='green')
    canvas.save(out/'r5_gap_witness_physical_map.png'); print(f'Camera output: {(out/"r5_gap_witness_audit.png").resolve()}'); print(f'Physical output: {(out/"r5_gap_witness_physical_map.png").resolve()}'); print('Production code changed: NO'); return 0
if __name__=='__main__': raise SystemExit(main())
