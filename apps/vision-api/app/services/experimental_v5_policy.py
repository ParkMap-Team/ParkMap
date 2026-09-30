from dataclasses import dataclass, asdict
from typing import Any
import math

@dataclass(frozen=True)
class V5Policy:
    orientation_difference_max: float=.20
    normalized_lateral_max: float=1.5
    normalized_endpoint_distance_max: float=6.0
    local_scale_ratio_min: float=.5
    local_scale_ratio_max: float=2.0
    merged_perpendicular_dispersion_max: float=1.5
    merged_orientation_dispersion_max: float=.35

def axial_difference(a: float|None,b: float|None)->float|None:
    if a is None or b is None:return None
    d=abs((a-b)%(math.pi)); return min(d,math.pi-d)

def evaluate_fragment_pair(measurement: dict[str,Any], policy: V5Policy=V5Policy())->dict[str,Any]:
    gates={}; reasons=[]
    required=['orientation_difference','normalized_lateral_separation','normalized_endpoint_distance','local_scale_ratio','hypothetical_merged_normalized_perpendicular_dispersion','hypothetical_merged_orientation_dispersion']
    if any(measurement.get(k) is None for k in required): return {'status':'INSUFFICIENT_GEOMETRY','gates':{'geometry_availability':'INSUFFICIENT_GEOMETRY'},'reasons':['undefined measurement']}
    gates['geometry_availability']='PASS'; gates['orientation_gate']='PASS' if measurement['orientation_difference']<=policy.orientation_difference_max else 'REJECT'; gates['lateral_gate']='PASS' if measurement['normalized_lateral_separation']<=policy.normalized_lateral_max else 'REJECT'; gates['endpoint_gate']='PASS' if measurement['normalized_endpoint_distance']<=policy.normalized_endpoint_distance_max else 'REJECT'; gates['scale_gate']='PASS' if policy.local_scale_ratio_min<=measurement['local_scale_ratio']<=policy.local_scale_ratio_max else 'REJECT'; gates['merged_coherence_gate']='PASS' if measurement['hypothetical_merged_normalized_perpendicular_dispersion']<=policy.merged_perpendicular_dispersion_max and measurement['hypothetical_merged_orientation_dispersion']<=policy.merged_orientation_dispersion_max else 'REJECT'; status='PASS' if all(v=='PASS' for v in gates.values()) else 'REJECT'; return {'status':status,'gates':gates,'reasons':reasons,'policy':asdict(policy)}
