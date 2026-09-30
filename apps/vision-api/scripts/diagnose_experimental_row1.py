from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from app.services.cv_service import cv_service
from app.services.auto_parking_service import detections_from_response
from app.services.experimental_auto_rows import infer_rows_experimental

root=Path(__file__).resolve().parents[1]; data=root/'test-data'/'auto-parking'; out=root/'auto-parking-experimental'; out.mkdir(exist_ok=True)
paths=sorted(p for p in data.iterdir() if p.suffix.lower() in {'.jpg','.jpeg','.png','.webp'})
items=[d for i,p in enumerate(paths) for d in detections_from_response(cv_service.analyze_image(p.read_bytes()),i,p.name)]
rows,_=infer_rows_experimental(items); row=rows[0]; a=np.array([[(d.x1+d.x2)/2,d.y2,d.y2-d.y1,d.image_index] for d in items]); p0=np.array([row['centerline'][0]['x'],row['centerline'][0]['y']]); p1=np.array([row['centerline'][1]['x'],row['centerline'][1]['y']]); direction=(p1-p0); direction/=np.linalg.norm(direction); normal=np.array([-direction[1],direction[0]]); residual=np.abs((a[:,:2]-p0)@normal); mask=residual<=np.clip(a[:,2]*1.5,.012,.12)
assigned=a[mask]; proj=(assigned[:,:2]-p0)@direction; gaps=np.diff(np.sort(proj)); stats={'assigned':int(mask.sum()),'x_range':[float(assigned[:,0].min()),float(assigned[:,0].max())],'y_range':[float(assigned[:,1].min()),float(assigned[:,1].max())],'scale_range':[float(assigned[:,2].min()),float(assigned[:,2].max())],'residual_quantiles':np.quantile(residual[mask],[0,.25,.5,.75,1]).tolist(),'per_image':{str(i):int(np.sum(assigned[:,3]==i)) for i in range(len(paths))},'projection_range':[float(proj.min()),float(proj.max())],'largest_gaps':sorted(gaps.tolist(),reverse=True)[:10]}; (out/'experimental_row_1_diagnostics.json').write_text(json.dumps(stats,indent=2)); image=Image.open(paths[0]).convert('RGB'); draw=ImageDraw.Draw(image,'RGBA'); px=lambda q:(round(q[0]*image.width),round(q[1]*image.height));
for i,v in enumerate(a):
 p=px(v[:2]); draw.ellipse((p[0]-3,p[1]-3,p[0]+3,p[1]+3),fill=(255,255,255,100) if not mask[i] else (255,60,30,230))
draw.line([px(p0),px(p1)],fill=(0,255,255,255),width=5); image.save(out/'experimental_row_1_diagnostics.png'); print(json.dumps(stats,indent=2))
