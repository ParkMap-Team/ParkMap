from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from app.services.cv_service import cv_service
from app.services.auto_parking_service import detections_from_response
def _point(d): return np.array([(d.x1+d.x2)/2,d.y2])
from app.services.experimental_auto_rows import infer_rows_experimental_v3

root=Path(__file__).resolve().parents[1]; data=root/'test-data'/'auto-parking'; out=root/'auto-parking-experimental'; out.mkdir(exist_ok=True)
paths=sorted(p for p in data.iterdir() if p.suffix.lower() in {'.jpg','.jpeg','.png','.webp'}); items=[d for i,p in enumerate(paths) for d in detections_from_response(cv_service.analyze_image(p.read_bytes()),i,p.name)]
rows,_,graph=infer_rows_experimental_v3(items); anchors=[]
for d in items:
 p=_point(d); hit=next((g for g in anchors if np.linalg.norm(p-np.mean([_point(x) for x in g],axis=0))<=.65*max(d.y2-d.y1,.008,np.median([max(x.y2-x.y1,.008) for x in g]))),None)
 if hit is None: anchors.append([d])
 else: hit.append(d)
ac=np.array([np.mean([_point(x) for x in g],0) for g in anchors]); ascale=np.array([np.median([max(x.y2-x.y1,.008) for x in g]) for g in anchors]); araw=[len(g) for g in anchors]; aimg=[len(set(x.image_index for x in g)) for g in anchors]
def stats(v):
 v=np.asarray(v,float); med=float(np.median(v)); return {'min':float(v.min()),'max':float(v.max()),'median':med,'q1':float(np.quantile(v,.25)),'q3':float(np.quantile(v,.75)),'mad':float(np.median(np.abs(v-med))),'std':float(v.std())}
def modes(z):
 z=np.sort(np.asarray(z)); gaps=np.diff(z); cut=max(float(np.median(np.abs(gaps-np.median(gaps)))+np.median(gaps))*3,.08); groups=[]
 for x in z:
  if not groups or x-groups[-1][-1]>cut: groups.append([x])
  else: groups[-1].append(x)
 return [stats(g)|{'anchor_count':len(g)} for g in groups]
axes=[]
for row in rows:
 p0=np.array([row['centerline'][0]['x'],row['centerline'][0]['y']]); p1=np.array([row['centerline'][1]['x'],row['centerline'][1]['y']]); dr=p1-p0; dr/=np.linalg.norm(dr); axes.append((p0,dr,np.array([-dr[1],dr[0]])))
labels=[]
for i,p in enumerate(ac): labels.append(int(np.argmin([abs((p-a[0])@a[2])/max(ascale[i],.008) for a in axes])))
report={'graph':graph,'rows':[]}
for row in rows:
 ri=rows.index(row); p0,dr,no=axes[ri]; lat=(ac-p0)@no; lon=(ac-p0)@dr; score=np.abs(lat)/np.maximum(ascale,1e-9); assigned=np.array([i for i,l in enumerate(labels) if l==ri])
 payload={'row_id':row['row_id'],'anchor_count':len(assigned),'raw_observation_count':int(sum(araw[i] for i in assigned)),'distinct_image_count':len(set(x.image_index for i in assigned for x in anchors[i])),'local_scale':stats(ascale[assigned]),'lateral':stats(lat[assigned]),'normalized_lateral':stats(score[assigned]),'lateral_modes':modes(lat[assigned]),'longitudinal_gaps':sorted(np.diff(np.sort(lon[assigned])).tolist(),reverse=True)[:10],'potential_bridge_anchors':[],'potential_bridge_edges':[]}
 report['rows'].append(payload)
 (out/f'{row["row_id"]}_local.csv').write_text('\n'.join(f'{lon[i]:.6f},{score[i]:.6f}' for i in assigned))
report['anchor_count']=len(anchors); (out/'experimental_v3_lateral_diagnostics.json').write_text(json.dumps(report,indent=2))
ref=Image.open(paths[0]).convert('RGB'); canvas=Image.new('RGB',(ref.width,ref.height*2),'white'); draw=ImageDraw.Draw(canvas); canvas.paste(ref,(0,0)); colors=[(255,50,50),(50,150,255),(40,180,70)]
for ri,row in enumerate(rows):
 p0=np.array([row['centerline'][0]['x'],row['centerline'][0]['y']]); p1=np.array([row['centerline'][1]['x'],row['centerline'][1]['y']]); dr=p1-p0; dr/=np.linalg.norm(dr); no=np.array([-dr[1],dr[0]]); lat=(ac-p0)@no; idx=np.argsort(np.abs(lat))[:row['spatial_anchor_count']]
 for i in idx:
  x,y=ac[i]*np.array([ref.width,ref.height]); draw.ellipse((x-7,y-7,x+7,y+7),fill=colors[ri%3]);
 draw.line([(p0[0]*ref.width,p0[1]*ref.height),(p1[0]*ref.width,p1[1]*ref.height)],fill=colors[ri%3],width=5)
canvas.save(out/'experimental_v3_lateral_diagnostics.png')
local=Image.new('RGB',(1200,600*len(rows)),'white'); ld=ImageDraw.Draw(local)
for ri,payload in enumerate(report['rows']):
 vals=[]
 # reconstruct from row assignment for local plot
 row=rows[ri]; p0=np.array([row['centerline'][0]['x'],row['centerline'][0]['y']]); p1=np.array([row['centerline'][1]['x'],row['centerline'][1]['y']]); dr=p1-p0; dr/=np.linalg.norm(dr); no=np.array([-dr[1],dr[0]]); lon=(ac-p0)@dr; lat=(ac-p0)@no/np.maximum(ascale,1e-9); idx=np.argsort(np.abs((ac-p0)@no))[:row['spatial_anchor_count']]
 for i in idx: ld.ellipse((100+lon[i]*900,ri*600+300-lat[i]*250,106+lon[i]*900,ri*600+306-lat[i]*250),fill=colors[ri%3])
 ld.text((10,ri*600+20),row['row_id'],fill='black')
local.save(out/'experimental_v3_row_local.png'); print(json.dumps(report,indent=2))
