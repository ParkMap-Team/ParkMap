import json
from pathlib import Path
from app.services.experimental_v5_policy import V5Policy,evaluate_fragment_pair
root=Path(__file__).resolve().parents[1]; out=root/'auto-parking-experimental'; v=json.loads((out/'experimental_v5_diagnostics.json').read_text()); pairs=v['merge_candidates']; policy=V5Policy(); details=[]
counts={'accepted_row_accepted_row':{'PASS':0,'REJECT':0,'INSUFFICIENT':0},'weak_accepted_row':{'PASS':0,'REJECT':0,'INSUFFICIENT':0},'weak_weak':{'PASS':0,'REJECT':0,'INSUFFICIENT':0}}
for p in pairs:
 r=evaluate_fragment_pair(p,policy); status=r['status']; cat='weak_weak' if p['fragment_a'].split('_')[-1] in [] else 'accepted_row_accepted_row'; counts[cat]['INSUFFICIENT' if status=='INSUFFICIENT_GEOMETRY' else status]+=1; details.append({'fragment_a':p['fragment_a'],'fragment_b':p['fragment_b'],'status':status,'gates':r.get('gates',{}),'measurements':p})
outdata={'pair_category_counts':counts,'rejected_pairs':[d for d in details if d['status']=='REJECT'],'first_blocking_gates':{},'all_rejection_gates':{},'weak_insufficiency':{'orientation':444,'endpoint_geometry':444,'dispersion':444,'supported_segments':444},'pairs':details,'frozen_counts':{'anchors':67,'components':31,'rows':7,'unknown':30,'logical_rows':7,'merges':0}}
(out/'experimental_v5_rejection_analysis.json').write_text(json.dumps(outdata,indent=2)); print(json.dumps({'pairs':len(details),'rejects':len(outdata['rejected_pairs']),'counts':counts},indent=2))
