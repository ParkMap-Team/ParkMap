import pytest

from app.services.experimental_v5_policy import axial_difference, evaluate_fragment_pair


def m(**k):
 d={'orientation_difference':.1,'normalized_lateral_separation':.5,'normalized_endpoint_distance':2.,'local_scale_ratio':1.,'hypothetical_merged_normalized_perpendicular_dispersion':.5,'hypothetical_merged_orientation_dispersion':.1}; d.update(k); return d
def test_collinear_pass(): assert evaluate_fragment_pair(m())['status']=='PASS'
@pytest.mark.parametrize('key,val', [('orientation_difference',.2),('normalized_lateral_separation',1.5),('normalized_endpoint_distance',6.)])
def test_inclusive_boundaries(key,val): assert evaluate_fragment_pair(m(**{key:val}) )['status']=='PASS'
@pytest.mark.parametrize('key,val', [('orientation_difference',.201),('normalized_lateral_separation',1.501),('normalized_endpoint_distance',6.01),('local_scale_ratio',2.1),('hypothetical_merged_orientation_dispersion',.36)])
def test_outside_reject(key,val): assert evaluate_fragment_pair(m(**{key:val}) )['status']=='REJECT'
def test_undefined_insufficient(): assert evaluate_fragment_pair(m(orientation_difference=None))['status']=='INSUFFICIENT_GEOMETRY'
def test_axial_angles(): assert axial_difference(1*3.14159265/180,179*3.14159265/180)<.04
def test_scale_reasonable_pass(): assert evaluate_fragment_pair(m(local_scale_ratio=1.8))['status']=='PASS'
def test_dispersion_reject(): assert evaluate_fragment_pair(m(hypothetical_merged_normalized_perpendicular_dispersion=1.6))['status']=='REJECT'
def test_deterministic(): assert evaluate_fragment_pair(m())==evaluate_fragment_pair(m())
