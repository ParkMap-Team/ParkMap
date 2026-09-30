from app.services.experimental_auto_rows_v5 import postprocess_v4

def test_v5_is_deterministic_and_traceable():
    v={'graph_summary':{'anchor_count':2},'rows':[{'row_id':'row_1','spatial_anchor_count':3,'supported_segments':1}], 'unassigned_anchors':[{'anchor_id':9}]}
    a=postprocess_v4(v); b=postprocess_v4(v); assert a==b; assert a['logical_rows'][0]['component_ids']==['component_1']

def test_v5_does_not_force_merge_without_geometry():
    v={'rows':[{'row_id':'a'},{'row_id':'b'}],'unassigned_anchors':[]}; out=postprocess_v4(v); assert out['accepted_merges']==[] and len(out['logical_rows'])==2
