"""Diagnostic-only audit of canonical footprint anchoring for R5."""
from __future__ import annotations
import argparse, json, mimetypes
from pathlib import Path
from itertools import combinations
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, Point
from shapely.affinity import rotate, translate
from app.main import app
from app.services.virtual_fitting_service import WIDTH_M, LENGTH_M, FITTING_TOLERANCE_M, _row_angle

def shape(g):
    rings=g.get('polygons',[]) if isinstance(g,dict) else []
    if not rings:return Polygon()
    return Polygon([(p['x_m'],p['y_m']) for p in rings[0][0]])
def proj(p,m):
    q=[m[0][0]*p['x_m']+m[0][1]*p['y_m']+m[0][2],m[1][0]*p['x_m']+m[1][1]*p['y_m']+m[1][2],m[2][0]*p['x_m']+m[2][1]*p['y_m']+m[2][2]]
    return None if abs(q[2])<1e-12 else (q[0]/q[2],q[1]/q[2])
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('image',type=Path); ap.add_argument('--output',type=Path,default=Path('debug_output/r5_footprint_placement_audit.png')); a=ap.parse_args()
    with a.image.open('rb') as h:r=TestClient(app).post('/api/detection/analyze',files={'image':(a.image.name,h,mimetypes.guess_type(a.image.name)[0] or 'image/png')})
    r.raise_for_status(); payload=r.json(); analysis=payload['parking_analysis']; row=next(x for x in analysis['physical_map']['rows'] if x['row_id']=='row_5'); rowpoly=shape({'polygons':[[row['polygon']]]}); detections=[x for x in analysis['detections'] if x.get('row_assignment_v2',{}).get('assigned_row_id')=='row_5'];
    print('R5 CANONICAL FOOTPRINT PLACEMENT AUDIT'); print('Detection | Ground X | Ground Y | Width | Length | Centroid | Ground→Centroid Long/Lateral')
    angle=_row_angle(rowpoly); origin=rowpoly.centroid; local=[]
    for d in detections:
        fp=shape(d.get('canonical_footprint',{})); gp=d.get('metric_ground_point',{}); p=fp; lp=rotate(translate(p,-origin.x,-origin.y),-angle,origin=(0,0)); lground=rotate(translate(Point(gp.get('x_m',0),gp.get('y_m',0)),-origin.x,-origin.y),-angle,origin=(0,0))
        c=lp.centroid; print(f"{d['detection_id']} | {gp.get('x_m',0):.3f} | {gp.get('y_m',0):.3f} | {WIDTH_M:.2f} | {LENGTH_M:.2f} | ({p.centroid.x:.3f},{p.centroid.y:.3f}) | ({c.x-lground.x:.3f},{c.y-lground.y:.3f})")
        print(f"  anchor=CENTER_OF_REAR_EDGE direction=ROW_AXIS footprint_bounds={p.bounds} local_bounds={lp.bounds}"); local.append((lp.centroid.x,d,lp))
    print('\nOVERLAPPING PAIRS');
    for x,y in combinations(local,2):
        area=x[2].intersection(y[2]).area
        if area>FITTING_TOLERANCE_M: print(f"{x[1]['detection_id']} <-> {y[1]['detection_id']} intersection_area={area:.6f}")
    local.sort(); print('\nGROUND-POINT SPACING');
    for x,y in zip(local,local[1:]): print(f"{x[1]['detection_id']} -> {y[1]['detection_id']} separation={(y[2].centroid.x-x[2].centroid.x):.3f} required={WIDTH_M:.3f} footprint_gap={max(0,y[2].bounds[0]-x[2].bounds[2]):.3f}")
    h=json.loads(Path(__file__).resolve().parents[1].joinpath('config/ground_plane_homography.json').read_text()); im=Image.open(a.image).convert('RGB'); dr=ImageDraw.Draw(im); W,H=im.size
    rp=[proj({'x_m':p['x_m'],'y_m':p['y_m']},h['inverse_matrix']) for p in row['polygon']]; rp=[(int(x*W),int(y*H)) for x,y in rp if x is not None]; dr.line(rp+[rp[0]],fill=(0,180,255),width=5)
    for d in detections:
        bbox=next((z.get('bbox') for z in payload.get('detections',[]) if z.get('detection_index')==d.get('detection_index')),None)
        if not bbox:continue
        color=(255,40,40); dr.rectangle((bbox['x']*W,bbox['y']*H,(bbox['x']+bbox['width'])*W,(bbox['y']+bbox['height'])*H),outline=color,width=3); gx=(bbox['x']+bbox['width']/2)*W; gy=(bbox['y']+bbox['height'])*H; dr.ellipse((gx-6,gy-6,gx+6,gy+6),fill=color); dr.text((gx+8,gy),d['detection_id'],fill=color)
        rings=d.get('canonical_footprint',{}).get('polygons',[]); 
        if rings:
            q=[proj({'x_m':p['x_m'],'y_m':p['y_m']},h['inverse_matrix']) for p in rings[0][0]]; q=[(int(x*W),int(y*H)) for x,y in q if x is not None]; dr.line(q+[q[0]],fill=(255,80,180),width=3)
    a.output.parent.mkdir(parents=True,exist_ok=True); im.save(a.output); print(f'Annotated output: {a.output.resolve()}'); print('Production code changed: NO'); return 0
if __name__=='__main__': raise SystemExit(main())
