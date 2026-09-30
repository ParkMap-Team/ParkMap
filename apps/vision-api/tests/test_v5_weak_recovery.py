from app.services.experimental_v5_weak_recovery import evaluate_weak_fragment
def row(i,x): return {'row_id':f'r{i}','centroid':{'x':x,'y':0},'local_scale':.05}
def frag(x): return {'centroid':{'x':x,'y':0},'local_scale':.05}
def test_clear_candidate(): assert evaluate_weak_fragment(frag(0),[row(1,0),row(2,1)])['status']=='RECOVERABLE_SINGLE_CANDIDATE'
def test_ambiguous_candidate(): assert evaluate_weak_fragment(frag(.5),[row(1,0),row(2,1)])['status']=='AMBIGUOUS_MULTIPLE_ROWS'
def test_far_unknown(): assert evaluate_weak_fragment(frag(10),[row(1,0)])['status']=='NO_COMPATIBLE_ROW'
