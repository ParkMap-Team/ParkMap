"""Diagnostic audit for apparent empty R2 regions."""
from __future__ import annotations
import argparse, mimetypes, math
from pathlib import Path
from fastapi.testclient import TestClient
from shapely.geometry import Polygon, Point
from shapely.affinity import rotate, translate
from PIL import Image, ImageDraw
from app.main import app
from app.services.virtual_fitting_service import WIDTH_M, LENGTH_M, FITTING_TOLERANCE_M, _row_angle
from app.services.capacity_service import _candidate_positions

def shape(g):
    rings=g.get('polygons',[]) if isinstance(g,dict) else []
    parts=[Polygon([(p['x_m'],p['y_m']) for p in item[0]]) for item in rings if item]
    from shapely.ops import unary_union
    return unary_union(parts) if parts else Polygon()
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('image',type=Path); a=ap.parse_args()
    with a.image.open('rb') as h:r=TestClient(app).post('/api/detection/analyze',files={'image':(a.image.name,h,mimetypes.guess_type(a.image.name)[0] or 'image/png')})
    r.raise_for_status(); an=r.json()['parking_analysis']; rowdata=next(x for x in an['physical_map']['rows'] if x['row_id']=='row_2'); row=shape({'polygons':[[rowdata['polygon']]]}); free=shape(next(x for x in an['free_space']['rows'] if x['row_id']=='row_2')['free_geometry']); occupied=shape(next(x for x in an['occupied_space']['rows'] if x['row_id']=='row_2')['occupied_geometry']); angle=_row_angle(row); origin=row.centroid; local_free=rotate(translate(free,-origin.x,-origin.y),-angle,origin=(0,0)); local_row=rotate(translate(row,-origin.x,-origin.y),-angle,origin=(0,0));
    cap=next(x for x in an['capacity']['rows'] if x['row_id']=='row_2'); final=[shape(x['footprint_metric']) for x in cap.get('placements',[])]; generated=[]
    print('R2 MISSING WITNESS AUDIT'); print(f'Production capacity = {cap.get("capacity")}'); print(f'Free geometry type={free.geom_type} components={len(free.geoms) if free.geom_type=="MultiPolygon" else 1} area={free.area:.6f}')
    parts=list(local_free.geoms) if local_free.geom_type=='MultiPolygon' else [local_free]
    generated_by_component=[]
    for index,component in enumerate(parts):
        start,end=component.bounds[0]+WIDTH_M/2,component.bounds[2]-WIDTH_M/2; positions=_candidate_positions(component,start,end) if end>=start else []; valid=[]
        component_candidates=[]
        for position in positions:
            candidate=Polygon([(position-WIDTH_M/2,component.bounds[1]),(position+WIDTH_M/2,component.bounds[1]),(position+WIDTH_M/2,component.bounds[1]+LENGTH_M),(position-WIDTH_M/2,component.bounds[1]+LENGTH_M)]); ok=local_free.buffer(FITTING_TOLERANCE_M).covers(candidate); generated.append(candidate); valid.append(candidate) if ok else None
            component_candidates.append((candidate,ok))
        generated_by_component.append(component_candidates)
        selected=sum(1 for witness in final if component.buffer(FITTING_TOLERANCE_M).covers(witness))
        print(f'Component {index}: bounds={component.bounds} longitudinal_width={max(0,end-start):.6f} lateral_width={component.bounds[3]-component.bounds[1]:.6f} canonical_fit={"YES" if valid else "NO"} generated={len(positions)} valid={len(valid)} selected={selected}')
    print(f'Generated candidates={len(generated)} Final selected witnesses={len(final)}')
    local_final=[rotate(translate(w,-origin.x,-origin.y),-angle,origin=(0,0)) for w in final]
    for index,witness in enumerate(local_final):
        component_id=next((i for i,component in enumerate(parts) if component.buffer(FITTING_TOLERANCE_M).covers(witness)),None)
        print(f'W{index} -> component {component_id} bounds={witness.bounds} row={local_row.buffer(FITTING_TOLERANCE_M).covers(witness)} free={local_free.buffer(FITTING_TOLERANCE_M).covers(witness)} occupied_overlap={final[index].intersection(occupied).area:.9f}')
    gaps=[]
    ordered=sorted([(w.bounds[0],w.bounds[2],i) for i,w in enumerate(local_final)])
    for left,right in zip(ordered,ordered[1:]):
        if right[0]-left[1]>WIDTH_M: gaps.append((right[0]-left[1],left[1],right[0]))
    gaps=sorted(gaps,reverse=True)[:2]
    for region_index,(length,left_x,right_x) in enumerate(gaps):
        region=f'Region {"AB"[region_index]}'; in_generated=[i for i,(candidate,ok) in enumerate(generated_by_component[0]) if candidate.bounds[2]>=left_x and candidate.bounds[0]<=right_x]; valid_ids=[i for i in in_generated if generated_by_component[0][i][1]]; selected_ids=[i for i,w in enumerate(local_final) if w.bounds[0]>=left_x and w.bounds[2]<=right_x]; print(f'{region}: bounds=({left_x:.6f},{right_x:.6f}) longitudinal_length={length:.6f} lateral_length={parts[0].bounds[3]-parts[0].bounds[1]:.6f} canonical_fit={length+FITTING_TOLERANCE_M>=WIDTH_M} generated_candidates={in_generated} valid_candidates={valid_ids} selected_witnesses={selected_ids}')
        for candidate_id in valid_ids:
            candidate=generated_by_component[0][candidate_id][0]; conflicts=[(i,candidate.intersection(w).area) for i,w in enumerate(local_final) if candidate.intersection(w).area>FITTING_TOLERANCE_M]; print(f'  candidate C{candidate_id}: conflicts={conflicts}')
    print('Region A (middle-left): inspect component 0 above; Region B (right-side): inspect final component above.')
    print('Backend final CLEAR witnesses =',sum(1 for item in (an.get('witness_safety') or {}).get('rows',[]) if item.get('row_id')=='row_2' for witness in item.get('witnesses',[]) if witness.get('uncertainty_status')=='CLEAR'))
    print('Frontend rendered witnesses = Backend CLEAR witnesses (PhysicalMeasuredMap uses witness_safety)')
    out=Path('debug_output'); out.mkdir(exist_ok=True); canvas=Image.new('RGB',(1200,500),'white'); draw=ImageDraw.Draw(canvas); minx,miny,maxx,maxy=local_row.bounds; sx=1100/max(1,maxx-minx); sy=400/max(1,maxy-miny); cv=lambda x,y:(int((x-minx)*sx+40),int((maxy-y)*sy+40)); draw.line([cv(*p) for p in local_row.exterior.coords],fill='blue',width=4)
    for part in parts: draw.line([cv(*p) for p in part.exterior.coords],fill='lightgreen',width=2)
    for c in generated: draw.line([cv(*p) for p in c.exterior.coords],fill='orange',width=2)
    for i,w in enumerate(final): draw.line([cv(*p) for p in w.exterior.coords],fill='green',width=4); draw.text(cv(w.centroid.x,w.centroid.y),f'W{i}',fill='darkgreen')
    canvas.save(out/'r2_missing_witness_audit.png'); print('Annotated output:',(out/'r2_missing_witness_audit.png').resolve()); print('Production code changed = NO'); return 0
if __name__=='__main__': raise SystemExit(main())
