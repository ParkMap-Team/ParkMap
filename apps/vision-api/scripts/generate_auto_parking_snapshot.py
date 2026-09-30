from pathlib import Path
import json
import math
from datetime import datetime, timezone
from app.services.cv_service import cv_service
from app.services.supported_segment_geometry import build_supported_segments

root=Path(__file__).resolve().parents[1]; data=root/'test-data'/'auto-parking'; out=root/'auto-parking-experimental'/'current_state.json'
paths=sorted(p for p in data.iterdir() if p.suffix.lower() in {'.jpg','.jpeg','.png','.webp'})
artifact=root/'auto-parking-experimental'/'experimental_v4_diagnostics.json'
if not artifact.exists(): raise SystemExit('Run the V4 diagnostic generator first.')
diagnostic=json.loads(artifact.read_text(encoding='utf-8')); result=diagnostic['graph_summary']; rows=diagnostic['accepted_rows']; anchors=result['anchors']; unknown=diagnostic['unassigned_anchors']; comparison=json.loads((root/'auto-parking-experimental'/'comparison.json').read_text(encoding='utf-8'))
anchor_by_id={a['anchor_id']:a for a in anchors}; public_rows=[]
for i,row in enumerate(rows,1):
 item=dict(row); item['display_id']=f'R{i}'
 item['supported_segments']=build_supported_segments(item, anchor_by_id)
 item['supported_segment_count']=len(item['supported_segments']); public_rows.append(item)
state={'status':'EXPERIMENTAL_READY','source_type':'EXPERIMENTAL_SNAPSHOT','updated_at':datetime.now(timezone.utc).isoformat(),'summary':{'detection_observations':comparison['detection_count'],'anchors':len(anchors),'logical_rows':len(public_rows),'unknown_anchors':len(unknown)},'rows':public_rows,'anchors':anchors,'unknown_anchors':unknown,'availability':'NOT_ESTIMATED'}
out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(state,indent=2),encoding='utf-8'); print(json.dumps(state['summary'],indent=2))
