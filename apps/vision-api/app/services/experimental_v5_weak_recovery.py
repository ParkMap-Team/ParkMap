from typing import Any
import math

def evaluate_weak_fragment(fragment: dict[str,Any], rows: list[dict[str,Any]]) -> dict[str,Any]:
    candidates=[]
    for row in rows:
        c=fragment.get('centroid'); rc=row.get('centroid') or (row.get('centerline') or [{'x':0,'y':0}])[0]
        if not c: continue
        dx=c['x']-rc.get('x',0); dy=c['y']-rc.get('y',0); dist=math.hypot(dx,dy); scale=max(fragment.get('local_scale') or .01,row.get('local_scale') or .01)
        candidates.append({'row_id':row.get('row_id'),'normalized_lateral':dist/scale,'longitudinal_relationship':'UNDEFINED','endpoint_distance':dist,'normalized_endpoint_distance':dist/scale,'scale_ratio':(fragment.get('local_scale') or scale)/(row.get('local_scale') or scale),'orientation_status':'UNAVAILABLE','status':'GEOMETRY_ONLY'})
    candidates.sort(key=lambda x:(x['normalized_lateral'],x['row_id'] or ''))
    if not candidates:return {'status':'INSUFFICIENT_EVIDENCE','candidates':[]}
    if len(candidates)>1 and abs(candidates[1]['normalized_lateral']-candidates[0]['normalized_lateral'])<.25:return {'status':'AMBIGUOUS_MULTIPLE_ROWS','candidates':candidates}
    if candidates[0]['normalized_lateral']>3:return {'status':'NO_COMPATIBLE_ROW','candidates':candidates}
    return {'status':'RECOVERABLE_SINGLE_CANDIDATE','destination':candidates[0]['row_id'],'candidates':candidates}
