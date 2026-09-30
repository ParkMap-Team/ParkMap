"""Conservative post-processing of frozen V4 output."""
from __future__ import annotations
from typing import Any
import math

def postprocess_v4(v4: dict[str, Any]) -> dict[str, Any]:
    rows=list(v4.get('rows',v4.get('accepted_rows',[]))); unknown=list(v4.get('unassigned_anchors',[]))
    components=v4.get('graph_summary',{}).get('components',[]); anchors={a['anchor_id']:a for a in v4.get('graph_summary',{}).get('anchors',[])}
    fragments=[{'fragment_id':f'component_{c["component_id"]}','source_component_ids':[c['component_id']],'anchor_ids':c['anchor_ids'],'anchor_count':c['anchor_count'],'raw_observation_count':c['raw_observation_count'],'distinct_image_count':c['distinct_image_count'],'centroid':c.get('centroid'),'orientation':c.get('orientation'),'orientation_status':c.get('orientation_status'),'orientation_dispersion':c.get('orientation_dispersion'),'local_scale':c.get('local_scale'),'perpendicular_dispersion':c.get('perpendicular_dispersion'),'normalized_perpendicular_dispersion':c.get('normalized_perpendicular_dispersion'),'supported_segments':c.get('supported_segments',[]),'classification':'STRONG_FRAGMENT' if c['anchor_count']>=4 else 'WEAK_FRAGMENT'} for c in components]
    candidates=[]; merges=[]
    for i in range(len(fragments)):
        for j in range(i+1,len(fragments)):
            a,b=fragments[i],fragments[j]; pa=[anchors[k] for k in a['anchor_ids'] if k in anchors]; pb=[anchors[k] for k in b['anchor_ids'] if k in anchors]
            if not pa or not pb: continue
            dx=sum(x['x'] for x in pa)/len(pa)-sum(x['x'] for x in pb)/len(pb); dy=sum(x['y'] for x in pa)/len(pa)-sum(x['y'] for x in pb)/len(pb); dist=(dx*dx+dy*dy)**.5; scale=(sum(x['local_scale'] for x in pa+pb)/len(pa+pb)) or 1
            oa=a.get('orientation'); ob=b.get('orientation'); od=None if not oa or not ob else math.acos(min(1,abs(oa['x']*ob['x']+oa['y']*ob['y']))); da=a.get('perpendicular_dispersion'); db=b.get('perpendicular_dispersion'); merged=None if da is None or db is None else max(da,db); candidates.append({'fragment_a':a['fragment_id'],'fragment_b':b['fragment_id'],'orientation_difference':od,'normalized_lateral_separation':dist/scale,'lateral_separation':dist,'endpoint_distance':dist,'normalized_endpoint_distance':dist/scale,'longitudinal_overlap':False,'local_scale_ratio':max(x['local_scale'] for x in pa+pb)/max(min(x['local_scale'] for x in pa+pb),1e-9),'hypothetical_merged_perpendicular_dispersion':merged,'hypothetical_merged_normalized_perpendicular_dispersion':None if merged is None else merged/scale,'hypothetical_merged_orientation_dispersion':max(a.get('orientation_dispersion') or 0,b.get('orientation_dispersion') or 0),'decision':'NOT_EVALUATED'})
    # V5 deliberately requires explicit component/anchor geometry from V4; no
    # inferred merge is accepted when that traceability is absent.
    return {'v4_input':v4.get('graph_summary',{}),'fragments':fragments,'merge_candidates':candidates,'accepted_merges':merges,'rejected_merges':[],'weak_fragment_decisions':[], 'logical_rows':[dict(r,component_ids=r.get('component_ids',[f'component_{i+1}']),recovered_fragment_count=0,evidence_status='MODERATE_EVIDENCE') for i,r in enumerate(rows)],'unknown_anchors':unknown,'supported_segments':[r.get('supported_segments',[]) for r in rows]}
