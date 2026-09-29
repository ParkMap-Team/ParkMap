"""Diagnostic candidate-fit audit for the R5 12->27 gap."""
from __future__ import annotations
import argparse, mimetypes
from pathlib import Path
from fastapi.testclient import TestClient
from shapely.geometry import Polygon
from shapely.affinity import rotate, translate
from app.main import app
from app.services.virtual_fitting_service import WIDTH_M, LENGTH_M, FITTING_TOLERANCE_M, _row_angle
from PIL import Image, ImageDraw

def shape(g):
    rings=g.get('polygons',[]) if isinstance(g,dict) else []
    if not rings:return Polygon()
    return Polygon([(p['x_m'],p['y_m']) for p in rings[0][0]])
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('image',type=Path); a=ap.parse_args()
    with a.image.open('rb') as h:r=TestClient(app).post('/api/detection/analyze',files={'image':(a.image.name,h,mimetypes.guess_type(a.image.name)[0] or 'image/png')})
    r.raise_for_status(); an=r.json()['parking_analysis']; rowdata=next(x for x in an['physical_map']['rows'] if x['row_id']=='row_5'); row=shape({'polygons':[[rowdata['polygon']]]}); angle=_row_angle(row); origin=row.centroid
    local=lambda p: rotate(translate(p,-origin.x,-origin.y),-angle,origin=(0,0)); world=lambda p: rotate(translate(p,origin.x,origin.y),angle,origin=(origin.x,origin.y))
    ds={d['detection_id']:d for d in an['detections']}; fps={k:local(shape(ds[k]['canonical_footprint'])) for k in ('detection_12','detection_27','detection_47')}; free=local(shape(next(x for x in an['free_space']['rows'] if x['row_id']=='row_5')['free_geometry'])); occupied=local(shape(next(x for x in an['occupied_space']['rows'] if x['row_id']=='row_5')['occupied_geometry'])); lrow=local(row)
    def audit(left,right):
        a,b=fps[left],fps[right]; gap=max(0,b.bounds[0]-a.bounds[2]); x=(a.bounds[2]+b.bounds[0])/2; ymin,ymax=free.bounds[1],free.bounds[3]; candidate=Polygon([(x-WIDTH_M/2,ymin),(x+WIDTH_M/2,ymin),(x+WIDTH_M/2,ymin+LENGTH_M),(x-WIDTH_M/2,ymin+LENGTH_M)])
        row_ok=lrow.buffer(FITTING_TOLERANCE_M).covers(candidate); occ=candidate.intersection(occupied).area; free_ok=free.buffer(FITTING_TOLERANCE_M).covers(candidate); outside=candidate.difference(lrow).area; reason='EXPECTED_FIT' if row_ok and occ<=FITTING_TOLERANCE_M and free_ok else 'ROW_CONTAINMENT_FAILURE' if not row_ok else 'OCCUPIED_INTERSECTION' if occ>FITTING_TOLERANCE_M else 'INSUFFICIENT_LATERAL_LENGTH' if not free_ok else 'OTHER'
        print(f'{left} -> {right}: gap={gap:.3f} available_lateral={ymax-ymin:.3f} required={LENGTH_M:.3f} row={row_ok} occupied_overlap={occ:.6f} free={free_ok} outside={outside:.6f} reason={reason}')
        return candidate,reason,gap
    print('R5 MISSING GAP DIAGNOSTIC'); c1,reason,gap1=audit('detection_12','detection_27'); c2,reason2,gap2=audit('detection_27','detection_47')
    witnesses=[shape(p['footprint_metric']) for p in next(x for x in an['capacity']['rows'] if x['row_id']=='row_5')['placements']]; print(f'Comparison witness present 12->27: {any(c1.equals(w) or c1.intersection(w).area>1.0 for w in witnesses)}; 27->47: {any(c2.equals(w) or c2.intersection(w).area>1.0 for w in witnesses)}')
    canvas=Image.new('RGB',(1000,500),'white'); draw=ImageDraw.Draw(canvas); minx,miny,maxx,maxy=lrow.bounds; sx=900/max(1,maxx-minx); sy=400/max(1,maxy-miny); cv=lambda x,y:(int((x-minx)*sx+40),int((maxy-y)*sy+40)); draw.line([cv(*p) for p in lrow.exterior.coords],fill='blue',width=4)
    for part in (free.geoms if free.geom_type=='MultiPolygon' else [free]): draw.line([cv(*p) for p in part.exterior.coords],fill='lightgreen',width=2)
    draw.line([cv(*p) for p in c1.exterior.coords],fill='red',width=4); draw.line([cv(*p) for p in c2.exterior.coords],fill='green',width=4); canvas.save(Path('debug_output/r5_missing_gap_12_27.png')); print('Annotated output: '+str(Path('debug_output/r5_missing_gap_12_27.png').resolve())); print('Production code changed: NO'); return 0
if __name__=='__main__': raise SystemExit(main())
