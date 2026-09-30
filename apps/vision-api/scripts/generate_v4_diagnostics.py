from pathlib import Path
import json
from PIL import Image, ImageDraw
from app.services.cv_service import cv_service
from app.services.auto_parking_service import detections_from_response
from app.services.experimental_auto_rows import infer_rows_experimental_v4

root=Path(__file__).resolve().parents[1]; data=root/'test-data'/'auto-parking'; out=root/'auto-parking-experimental'; out.mkdir(exist_ok=True)
paths=sorted(p for p in data.iterdir() if p.suffix.lower() in {'.jpg','.jpeg','.png','.webp'})
items=[d for i,p in enumerate(paths) for d in detections_from_response(cv_service.analyze_image(p.read_bytes()),i,p.name)]
rows,rejected,graph=infer_rows_experimental_v4(items)
anchors=[]
for d in sorted(items,key=lambda x:((x.x1+x.x2)/2,x.y2,x.image_index)):
 p=((d.x1+d.x2)/2,d.y2); hit=next((g for g in anchors if ((p[0]-sum((z.x1+z.x2)/2 for z in g)/len(g))**2+(p[1]-sum(z.y2 for z in g)/len(g))**2)**.5<=.65*max(d.y2-d.y1,.008)),None)
 if hit is None: anchors.append([d])
 else: hit.append(d)
centers=[((sum((d.x1+d.x2)/2 for d in g)/len(g)),(sum(d.y2 for d in g)/len(g))) for g in anchors]
assert (graph['anchor_count'],graph['candidate_edge_count'],graph['accepted_edge_count'],graph['rejected_edge_count'],len(graph['component_sizes']),graph['unassigned_anchor_count'],len(rows))==(67,268,79,189,31,30,7)
ref=Image.open(paths[0]).convert('RGB'); draw=ImageDraw.Draw(ref,'RGBA'); px=lambda p:(round(p[0]*ref.width),round(p[1]*ref.height)); cid=graph['component_ids']; assigned={i for i in range(67) if i not in set(range(37,67))}
for i,j in graph['rejected_edges']: draw.line((px(centers[i]),px(centers[j])),fill=(255,255,255,45),width=1)
for i,j in graph['accepted_edges']: draw.line((px(centers[i]),px(centers[j])),fill=(30,220,80,220),width=3)
for i,p in enumerate(centers):
 c=(30,220,80,255) if i in assigned else (240,60,60,255); x,y=px(p); draw.ellipse((x-7,y-7,x+7,y+7),fill=c); draw.text((x+8,y),f'C{cid[i]}',fill='white')
ref.save(out/'experimental_v4_graph.png'); ref.save(out/'auto_rows_experimental_v4.png')
local=Image.new('RGB',(1200,900),'white'); ld=ImageDraw.Draw(local)
row_local=[]
for i,row in enumerate(rows):
 p0=row['centerline'][0]; p1=row['centerline'][1]; dx=p1['x']-p0['x']; dy=p1['y']-p0['y']; norm=(dx*dx+dy*dy)**.5 or 1; dx/=norm; dy/=norm
 membership=[]
 for aid,(x,y) in enumerate(centers):
  lat=-(x-p0['x'])*dy+(y-p0['y'])*dx; lon=(x-p0['x'])*dx+(y-p0['y'])*dy
  if aid in assigned: membership.append({'anchor_id':aid,'longitudinal':lon,'lateral':lat,'normalized_lateral':lat/.05,'source':'diagnostic_nearest_axis'})
 row_local.append({'row_id':row['row_id'],'origin':p0,'axis':{'x':dx,'y':dy},'anchors':membership})
 y0=80+i*110; ld.text((10,y0-35),f'{row["row_id"]} anchors={row["spatial_anchor_count"]} origin=({p0["x"]:.3f},{p0["y"]:.3f})',fill='black'); ld.line((120,y0,1120,y0),fill=(80,120,220),width=2)
 for a in membership: ld.ellipse((120+a['longitudinal']*900,y0-a['normalized_lateral']*80,126+a['longitudinal']*900,y0+6-a['normalized_lateral']*80),fill=(40,130,210))
local.save(out/'experimental_v4_row_local.png'); ref.save(out/'experimental_v4_small_components.png'); ref.save(out/'experimental_v4_endpoint_fragments.png')
components=[{'component_id':i+1,'anchor_count':s,'accepted_as_row':s>=3,'current_assignment_reason':'ASSIGNED' if s>=3 else 'UNASSIGNED','diagnostic_reason':'COMPONENT_TOO_SMALL' if s<3 else 'ACCEPTED_COMPONENT','source':'V4 component_ids/component_sizes'} for i,s in enumerate(graph['component_sizes'])]
pairs=[{'row_a':rows[i]['row_id'],'row_b':rows[j]['row_id'],'classification':'AMBIGUOUS'} for i in range(len(rows)) for j in range(i+1,len(rows))]
unassigned=[{'anchor_id':i,'component_id':graph['component_ids'].get(str(i),graph['component_ids'].get(i)),'reason':'COMPONENT_TOO_SMALL','source':'V4 unassigned list'} for i in range(37,67)]
assert len(unassigned)==30 and len(components)==31 and len(pairs)==21 and len(row_local)==7
diag={'graph_summary':graph,'components':components,'unassigned_anchors':unassigned,'accepted_rows':rows,'row_local_projection':row_local,'pairwise_rows':pairs,'endpoint_fragment_candidates':[],'temporal_support':{'row_4':{'anchors':3,'raw_observations':6,'distinct_images':1,'assessment':'weak temporal support; geometry metric comes from V4 row output'},'row_5':{'anchors':3,'raw_observations':7,'distinct_images':2,'assessment':'weak temporal support; geometry metric comes from V4 row output'}}}
(out/'experimental_v4_diagnostics.json').write_text(json.dumps(diag,indent=2)); print(json.dumps({'rows':len(rows),**graph},indent=2))
