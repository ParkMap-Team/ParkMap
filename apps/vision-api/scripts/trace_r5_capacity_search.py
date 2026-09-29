"""Diagnostic trace of the existing R5 Capacity V1 search."""
from __future__ import annotations
import argparse, mimetypes, math
from pathlib import Path
from fastapi.testclient import TestClient
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
from shapely.affinity import rotate, translate
from app.main import app
from app.services.virtual_fitting_service import WIDTH_M, LENGTH_M, FITTING_TOLERANCE_M, _row_angle
from app.services.capacity_service import _candidate_positions

def shape(g):
    rings=g.get('polygons',[]) if isinstance(g,dict) else []
    if not rings:return Polygon()
    parts=[Polygon([(p['x_m'],p['y_m']) for p in polygon[0]]) for polygon in rings if polygon]
    return unary_union(parts) if parts else Polygon()
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('image',type=Path); a=ap.parse_args()
    with a.image.open('rb') as h:r=TestClient(app).post('/api/detection/analyze',files={'image':(a.image.name,h,mimetypes.guess_type(a.image.name)[0] or 'image/png')})
    r.raise_for_status(); an=r.json()['parking_analysis']; rowdata=next(x for x in an['physical_map']['rows'] if x['row_id']=='row_5'); row=shape({'polygons':[[rowdata['polygon']] ]}); free=shape(next(x for x in an['free_space']['rows'] if x['row_id']=='row_5')['free_geometry']); occupied=shape(next(x for x in an['occupied_space']['rows'] if x['row_id']=='row_5')['occupied_geometry']); angle=_row_angle(row); origin=row.centroid; local_free=rotate(translate(free,-origin.x,-origin.y),-angle,origin=(0,0)); local_row=rotate(translate(row,-origin.x,-origin.y),-angle,origin=(0,0));
    print('R5 CAPACITY SEARCH TRACE'); print(f'Production capacity: {next(x for x in an["capacity"]["rows"] if x["row_id"]=="row_5")["capacity"]}'); print(f'free input area={free.area:.6f} bounds={free.bounds} local bounds={local_free.bounds} step={WIDTH_M:.3f} tolerance={FITTING_TOLERANCE_M}')
    generated=[]
    for component in ([local_free] if local_free.geom_type=='Polygon' else list(local_free.geoms)):
        y=component.bounds[1]; start,end=component.bounds[0]+WIDTH_M/2,component.bounds[2]-WIDTH_M/2; count=max(0,math.floor((end-start+FITTING_TOLERANCE_M)/WIDTH_M)+1); print(f'component bounds={component.bounds} start={start:.6f} end={end:.6f} generated_count={count}')
        for position in _candidate_positions(component, start, end):
            anchor=Point(position,y); candidate=Polygon([(anchor.x-WIDTH_M/2,anchor.y),(anchor.x+WIDTH_M/2,anchor.y),(anchor.x+WIDTH_M/2,anchor.y+LENGTH_M),(anchor.x-WIDTH_M/2,anchor.y+LENGTH_M)]); accepted=local_free.buffer(FITTING_TOLERANCE_M).covers(candidate); generated.append((anchor,candidate,accepted)); print(f'candidate {len(generated)-1} anchor={anchor.x:.6f},{anchor.y:.6f} bounds={candidate.bounds} accepted={accepted}')
    selected=[]
    for anchor,candidate,accepted in generated:
        if accepted and all(candidate.intersection(existing).area<=FITTING_TOLERANCE_M for _,existing in selected): selected.append((anchor,candidate))
    world=[rotate(translate(c,origin.x,origin.y),angle,origin=(origin.x,origin.y)) for _,c in selected]
    production_row=next(x for x in an["capacity"]["rows"] if x["row_id"]=="row_5"); production_world=[shape(item["footprint_metric"]) for item in production_row.get("placements", [])]
    print(f'generated candidates={len(generated)} valid/accepted candidates={sum(x[2] for x in generated)} diagnostic selected={len(world)}')
    print(f'PRODUCTION capacity={production_row.get("capacity")} selected final witnesses={len(production_world)} capacity_equals_witness_count={production_row.get("capacity")==len(production_world)}')
    for i,w in enumerate(production_world): print(f'W{i} bounds={w.bounds} area={w.area:.6f} row={row.buffer(FITTING_TOLERANCE_M).covers(w)} free={free.buffer(FITTING_TOLERANCE_M).covers(w)} occupied_overlap={w.intersection(occupied).area:.9f}')
    ds={d['detection_id']:shape(d['canonical_footprint']) for d in an['detections']}; target=ds.get('detection_12'); right=ds.get('detection_27'); target2=ds.get('detection_47'); lt=lambda p:rotate(translate(p,-origin.x,-origin.y),-angle,origin=(0,0)); a12,b27,b47=lt(target),lt(right),lt(target2); gap=(b27.bounds[0]-a12.bounds[2]); candidate=Polygon([((a12.bounds[2]+b27.bounds[0])/2-WIDTH_M/2,local_free.bounds[1]),((a12.bounds[2]+b27.bounds[0])/2+WIDTH_M/2,local_free.bounds[1]),((a12.bounds[2]+b27.bounds[0])/2+WIDTH_M/2,local_free.bounds[1]+LENGTH_M),((a12.bounds[2]+b27.bounds[0])/2-WIDTH_M/2,local_free.bounds[1]+LENGTH_M)]); target_world=rotate(translate(candidate,origin.x,origin.y),angle,origin=(origin.x,origin.y)); conflicts=[i for i,w in enumerate(production_world) if target_world.intersection(w).area>FITTING_TOLERANCE_M]; equivalent=[i for i,w in enumerate(production_world) if target_world.symmetric_difference(w).area<=FITTING_TOLERANCE_M]; print(f'Target #12->#27 gap={gap:.6f} diagnostic_candidate_free={local_free.buffer(FITTING_TOLERANCE_M).covers(candidate)} equivalent={equivalent}'); print(f'W2 between #27/#47={any(w.bounds[0]>=b27.bounds[2] and w.bounds[2]<=b47.bounds[0] for w in [lt(x) for x in production_world])}'); print('target conflicts:',conflicts); print('ROOT FINDINGS: TRACE_DIAGNOSTIC_BUG' if production_row.get('capacity')==len(production_world) else 'ROOT FINDINGS: CAPACITY_OUTPUT_INCONSISTENCY'); print('Production code changed: NO'); return 0
if __name__=='__main__': raise SystemExit(main())
