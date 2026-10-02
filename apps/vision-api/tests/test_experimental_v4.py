from app.services.auto_parking_service import AutoDetection
from app.services.experimental_auto_rows import infer_rows_experimental_v4


def det(x,y,image=0,h=.04): return AutoDetection(image,f'i{image}',.9,x-.02,y-h,x+.02,y)
def run(rows): return infer_rows_experimental_v4([d for r in rows for d in r])[0]
def test_horizontal_row_is_dynamic(): assert len(run([[det(i*.12,.5,i%3) for i in range(6)]]))>=1
def test_slanted_row(): assert len(run([[det(i*.12,.4+i*.03,i%3) for i in range(6)]]))>=1
def test_parallel_rows_do_not_require_five(): assert len(run([[det(i*.12,.45,i%3) for i in range(5)],[det(i*.12,.58,i%3) for i in range(5)]]))>=1
def test_bridge_does_not_crash(): assert run([[det(i*.12,.45,i%3) for i in range(3)],[det(.3,.52,0)],[det(i*.12,.6,i%3) for i in range(3)]]) is not None
def test_transitive_chain_is_deterministic():
    a=[det(i*.1,.5+i*.01,i%3) for i in range(8)]; assert run([a])==run([a])
def test_large_gap(): assert run([[det(0,.5,0),det(.1,.5,1),det(.9,.5,2)]]) is not None
def test_temporal_duplicates_anchor():
    _rows,_r,d= infer_rows_experimental_v4([det(.2,.5,i) for i in range(7)]); assert d['anchor_count']==1
def test_isolated_can_be_unassigned():
    _,_rej,d=infer_rows_experimental_v4([det(.2,.5,0),det(.8,.9,1)]); assert d['unassigned_anchor_count']>=1
def test_scale_variation(): assert run([[det(i*.12,.5,i%3,.02+i*.005) for i in range(6)]]) is not None
def test_three_rows_dynamic(): assert run([[det(i*.15,.35,i%3) for i in range(4)],[det(i*.15,.55,i%3) for i in range(4)],[det(i*.15,.75,i%3) for i in range(4)]]) is not None
def test_output_deterministic():
    a=[det(i*.1,.5,i%3) for i in range(7)]; assert infer_rows_experimental_v4(a)==infer_rows_experimental_v4(a)
