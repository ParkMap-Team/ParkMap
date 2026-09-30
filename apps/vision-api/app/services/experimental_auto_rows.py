"""Perspective-aware Auto Row Detection prototype.

This module is intentionally separate from ``auto_parking_service.infer_rows``.
It discovers elongated row axes with scale-normalized RANSAC-like line search;
it does not produce parking polygons or consume calibration data.
"""
from __future__ import annotations

from typing import Any, Sequence
import numpy as np

from app.services.auto_parking_service import AutoDetection


def _point(item: AutoDetection) -> np.ndarray:
    return np.array([(item.x1 + item.x2) / 2.0, item.y2], dtype=float)


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n else np.array([1.0, 0.0])


def _line_score(points: np.ndarray, scales: np.ndarray, images: np.ndarray, origin: np.ndarray, direction: np.ndarray) -> tuple[np.ndarray, float, int]:
    normal = np.array([-direction[1], direction[0]])
    distances = np.abs((points - origin) @ normal)
    # Local bbox height is the pixel-scale proxy; cap it to avoid giant tolerance.
    tolerance = np.clip(scales * 1.5, 0.012, 0.12)
    mask = distances <= tolerance
    return mask, float(np.median(distances[mask] / np.maximum(scales[mask], 1e-9))) if mask.any() else 999.0, len(set(images[mask].tolist()))


def infer_rows_experimental(items: Sequence[AutoDetection]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    remaining = list(items)
    rejected: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    while len(remaining) >= 3:
        points = np.array([_point(item) for item in remaining])
        scales = np.array([max(item.y2 - item.y1, 0.008) for item in remaining])
        images = np.array([item.image_index for item in remaining])
        best: tuple[tuple[int, int, float], np.ndarray, np.ndarray] | None = None
        # Deterministic pair-derived candidate axes; no requested row count is used.
        for i in range(len(remaining)):
            for j in range(i + 1, len(remaining)):
                direction = _unit(points[j] - points[i])
                if direction[0] < 0:
                    direction = -direction
                mask, residual, image_count = _line_score(points, scales, images, points[i], direction)
                count = int(mask.sum())
                key = (count, image_count, -residual)
                if count >= 6 and image_count >= 2 and (best is None or key > best[0]):
                    best = (key, mask, direction)
        if best is None:
            break
        _, mask, direction = best
        cluster = [item for item, selected in zip(remaining, mask) if selected]
        if len(cluster) < 3:
            break
        cluster_points = np.array([_point(item) for item in cluster])
        origin = cluster_points.mean(axis=0)
        normal = np.array([-direction[1], direction[0]])
        projected = (cluster_points - origin) @ direction
        order = np.argsort(projected)
        sorted_projection = projected[order]
        local_scales = np.array([max(item.y2 - item.y1, 0.008) for item in cluster])
        gaps = np.diff(sorted_projection)
        gap_limit = max(float(np.median(local_scales)) * 6.0, 0.08)
        segments = int(np.sum(gaps > gap_limit) + 1)
        centerline = [{"x": round(float(np.clip(origin[0] + direction[0] * sorted_projection.min(), 0, 1)), 6), "y": round(float(np.clip(origin[1] + direction[1] * sorted_projection.min(), 0, 1)), 6)}, {"x": round(float(np.clip(origin[0] + direction[0] * sorted_projection.max(), 0, 1)), 6), "y": round(float(np.clip(origin[1] + direction[1] * sorted_projection.max(), 0, 1)), 6)}]
        rows.append({"row_id": f"experimental_row_{len(rows)+1}", "status": "SUPPORTED" if len(cluster) >= 3 and len(set(item.image_index for item in cluster)) >= 2 else "WEAK_EVIDENCE", "observation_count": len(cluster), "distinct_image_count": len(set(item.image_index for item in cluster)), "confidence": round(float(min(1.0, len(cluster) / 12.0)), 4), "local_scale": round(float(np.median(local_scales)), 6), "perpendicular_dispersion": round(float(np.std((cluster_points - origin) @ normal)), 6), "orientation": {"x": round(float(direction[0]), 6), "y": round(float(direction[1]), 6)}, "centerline": centerline, "supported_segments": segments})
        remaining = [item for item, selected in zip(remaining, mask) if not selected]
    rejected.extend(item.as_dict() | {"rejection_reason": "NO_COHERENT_ROW_AXIS"} for item in remaining)
    rows.sort(key=lambda row: (row["centerline"][0]["y"], row["centerline"][0]["x"]))
    for index, row in enumerate(rows, 1):
        row["row_id"] = f"experimental_row_{index}"
    return rows, rejected


def infer_rows_experimental_v2(items: Sequence[AutoDetection]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Local-scale anchor graph prototype; intentionally independent of V2."""
    if not items:
        return [], []
    # Collapse repeated temporal observations into spatial anchors.
    ordered = sorted(items, key=lambda d: (_point(d)[1], _point(d)[0], d.image_index))
    anchors: list[list[AutoDetection]] = []
    for item in ordered:
        p = _point(item); scale = max(item.y2 - item.y1, .008)
        match = next((group for group in anchors if np.linalg.norm(p - np.mean([_point(x) for x in group], axis=0)) <= .65 * max(scale, np.median([max(x.y2-x.y1,.008) for x in group]))), None)
        if match is None: anchors.append([item])
        else: match.append(item)
    centers = np.array([np.mean([_point(x) for x in g], axis=0) for g in anchors]); scales = np.array([np.median([max(x.y2-x.y1,.008) for x in g]) for g in anchors])
    graph = [set() for _ in anchors]
    for i in range(len(anchors)):
        for j in range(i + 1, len(anchors)):
            delta = centers[j] - centers[i]; dist = np.linalg.norm(delta); limit = 3.5 * max(scales[i], scales[j])
            if dist <= limit and abs(delta[1]) <= 2.0 * max(scales[i], scales[j]) or (dist <= 8 * max(scales[i], scales[j]) and abs(delta[1]) <= .45 * dist + max(scales[i], scales[j])):
                graph[i].add(j); graph[j].add(i)
    seen=set(); components=[]
    for i in range(len(anchors)):
        if i in seen: continue
        stack=[i]; seen.add(i); comp=[]
        while stack:
            k=stack.pop(); comp.append(k)
            for n in graph[k]:
                if n not in seen: seen.add(n); stack.append(n)
        components.append(comp)
    rows=[]; rejected=[]
    for comp in components:
        group=[item for k in comp for item in anchors[k]]
        if len(group)<3 or len(comp)<2:
            rejected.extend(item.as_dict()|{"rejection_reason":"TINY_LOCAL_COMPONENT"} for item in group); continue
        pts=np.array([_point(x) for x in group]); _,_,v=np.linalg.svd(pts-pts.mean(0),full_matrices=False); direction=_unit(v[0]); direction = -direction if direction[0]<0 else direction; origin=pts.mean(0); normal=np.array([-direction[1],direction[0]]); proj=(pts-origin)@direction; gaps=np.diff(np.sort(proj)); gap_limit=max(float(np.median([max(x.y2-x.y1,.008) for x in group]))*6,.08)
        rows.append({"row_id":f"experimental_v2_row_{len(rows)+1}","status":"SUPPORTED" if len(set(x.image_index for x in group))>=2 else "WEAK_EVIDENCE","spatial_anchor_count":len(comp),"raw_observation_count":len(group),"distinct_image_count":len(set(x.image_index for x in group)),"local_scale":round(float(np.median([max(x.y2-x.y1,.008) for x in group])),6),"orientation":{"x":round(float(direction[0]),6),"y":round(float(direction[1]),6)},"perpendicular_dispersion":round(float(np.std((pts-origin)@normal)),6),"supported_segments":int(np.sum(gaps>gap_limit)+1),"centerline":[{"x":round(float(np.clip((origin+direction*proj.min())[0],0,1)),6),"y":round(float(np.clip((origin+direction*proj.min())[1],0,1)),6)},{"x":round(float(np.clip((origin+direction*proj.max())[0],0,1)),6),"y":round(float(np.clip((origin+direction*proj.max())[1],0,1)),6)}]})
    rows.sort(key=lambda r:r["centerline"][0]["y"])
    for i,row in enumerate(rows,1): row["row_id"]=f"experimental_v2_row_{i}"
    return rows,rejected

def infer_rows_experimental_v3(items: Sequence[AutoDetection]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Conservative anchor-first prototype with anti-bridge row bands."""
    ordered=sorted(items,key=lambda d:(_point(d)[1],_point(d)[0],d.image_index)); anchors=[]
    for item in ordered:
        p=_point(item); s=max(item.y2-item.y1,.008); hit=None
        for g in anchors:
            c=np.mean([_point(x) for x in g],axis=0); gs=np.median([max(x.y2-x.y1,.008) for x in g])
            if np.linalg.norm(p-c)<=.65*max(s,gs): hit=g; break
        if hit is not None: hit.append(item)
        else: anchors.append([item])
    centers=np.array([np.mean([_point(x) for x in g],axis=0) for g in anchors]); scales=np.array([np.median([max(x.y2-x.y1,.008) for x in g]) for g in anchors]); n=len(anchors); edges=[]
    for i in range(n):
        for j in range(i+1,n):
            d=centers[j]-centers[i]; dist=float(np.linalg.norm(d)); lim=3.0*max(scales[i],scales[j])
            if dist<=lim and abs(float(d[1]))<=1.8*max(scales[i],scales[j]): edges.append((i,j,dist))
    graph=[set() for _ in range(n)]
    for i,j,_ in edges: graph[i].add(j); graph[j].add(i)
    seen=set(); comps=[]
    for i in range(n):
        if i in seen: continue
        stack=[i]; seen.add(i); c=[]
        while stack:
            k=stack.pop(); c.append(k)
            for q in graph[k]:
                if q not in seen: seen.add(q); stack.append(q)
        comps.append(c)
    rows=[]; rejected=[]
    for comp in comps:
        if len(comp)<2: rejected.extend(x.as_dict()|{"rejection_reason":"ISOLATED_ANCHOR"} for k in comp for x in anchors[k]); continue
        pts=centers[comp]; _,_,v=np.linalg.svd(pts-pts.mean(0),full_matrices=False); direction=_unit(v[0]); direction=-direction if direction[0]<0 else direction; origin=pts.mean(0); normal=np.array([-direction[1],direction[0]]); lateral=(pts-origin)@normal
        # Split multimodal lateral offsets rather than accepting a bridge component.
        if len(comp)>=4 and float(np.ptp(lateral))>2.5*float(np.median(scales[comp])):
            order=np.argsort(pts[:,1]); groups=[]
            for idx in order:
                if not groups or abs(pts[idx,1]-np.mean(pts[groups[-1],1]))>2.0*float(np.median(scales[comp])): groups.append([idx])
                else: groups[-1].append(idx)
            subcomponents=[[comp[i] for i in g] for g in groups]
        else: subcomponents=[comp]
        for sub in subcomponents:
            if len(sub)<2: rejected.extend(x.as_dict()|{"rejection_reason":"COHERENCE_SPLIT"} for k in sub for x in anchors[k]); continue
            group=[x for k in sub for x in anchors[k]]; p=np.array([_point(x) for x in group]); o=p.mean(0); _,_,v=np.linalg.svd(p-o,full_matrices=False); dr=_unit(v[0]); dr=-dr if dr[0]<0 else dr; no=np.array([-dr[1],dr[0]]); pr=(p-o)@dr; gaps=np.diff(np.sort(pr)); gl=max(float(np.median([max(x.y2-x.y1,.008) for x in group]))*6,.08)
            rows.append({"row_id":f"experimental_v3_row_{len(rows)+1}","status":"SUPPORTED" if len(set(x.image_index for x in group))>=2 else "WEAK_EVIDENCE","spatial_anchor_count":len(sub),"raw_observation_count":len(group),"distinct_image_count":len(set(x.image_index for x in group)),"local_scale":round(float(np.median([max(x.y2-x.y1,.008) for x in group])),6),"orientation":{"x":round(float(dr[0]),6),"y":round(float(dr[1]),6)},"orientation_dispersion":round(float(np.std(np.arctan2((p-o)@no,(p-o)@dr))),6),"perpendicular_dispersion":round(float(np.std((p-o)@no)),6),"longitudinal_span":round(float(np.ptp(pr)),6),"supported_segments":int(np.sum(gaps>gl)+1),"centerline":[{"x":round(float(np.clip((o+dr*pr.min())[0],0,1)),6),"y":round(float(np.clip((o+dr*pr.min())[1],0,1)),6)},{"x":round(float(np.clip((o+dr*pr.max())[0],0,1)),6),"y":round(float(np.clip((o+dr*pr.max())[1],0,1)),6)}]})
    rows.sort(key=lambda r:r['centerline'][0]['y']);
    for i,r in enumerate(rows,1): r['row_id']=f'experimental_v3_row_{i}'
    diag={'anchor_count':n,'edge_count':len(edges),'degree_distribution':[len(g) for g in graph],'component_sizes_before':[len(c) for c in comps],'edge_lengths':[e[2] for e in edges]}
    return rows,rejected,diag

def infer_rows_experimental_v4(items: Sequence[AutoDetection]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Mutual-neighbor, degree-limited graph prototype (not production)."""
    ordered=sorted(items,key=lambda d:(_point(d)[1],_point(d)[0],d.image_index)); anchors=[]
    for item in ordered:
        p=_point(item); hit=next((g for g in anchors if np.linalg.norm(p-np.mean([_point(x) for x in g],0))<=.65*max(item.y2-item.y1,.008,np.median([max(x.y2-x.y1,.008) for x in g]))),None)
        if hit is None: anchors.append([item])
        else: hit.append(item)
    centers=np.array([np.mean([_point(x) for x in g],0) for g in anchors]); scales=np.array([np.median([max(x.y2-x.y1,.008) for x in g]) for g in anchors]); n=len(anchors)
    orient=[]; conf=[]
    for i in range(n):
        d=np.linalg.norm(centers-centers[i],axis=1); ids=np.argsort(np.where(np.arange(n)==i,1e9,d))[:5]; vec=centers[ids]-centers[i]; vec=vec[np.linalg.norm(vec,axis=1)>0];
        if len(vec)==0: orient.append(np.array([1.,0.])); conf.append(0.); continue
        _,_,v=np.linalg.svd(vec,full_matrices=False); u=_unit(v[0]); u=-u if u[0]<0 else u; orient.append(u); conf.append(float(min(1.,len(vec)/4)))
    candidates=[]; accepted=[]; rejected=[]
    nearest=[]
    for i in range(n):
        scores=[]
        for j in range(n):
            if i==j: continue
            delta=centers[j]-centers[i]; dist=float(np.linalg.norm(delta)); u=_unit(delta); u=-u if np.dot(u,orient[i])<0 else u; lat=abs(float(delta[0]*(-orient[i][1])+delta[1]*orient[i][0])); od=abs(float(np.dot(orient[i],orient[j]))); norm=dist/max(scales[i],scales[j]); scores.append((norm,j,lat,od,u))
        nearest.append(sorted(scores)[:4])
    for i in range(n):
        for norm,j,lat,od,u in nearest[i]:
            back=next((x for x in nearest[j] if x[1]==i),None); candidates.append((i,j,norm,lat,od,back is not None))
            if back and norm<=4 and lat<=1.2*max(scales[i],scales[j]) and od>=.82 and abs(float(np.dot(u,orient[j])))>=.82: accepted.append((i,j))
            else: rejected.append((i,j,norm,lat,od,back is not None))
    graph=[set() for _ in range(n)]
    for i,j in accepted: graph[i].add(j); graph[j].add(i)
    seen=set(); comps=[]
    for i in range(n):
        if i in seen: continue
        stack=[i]; seen.add(i); c=[]
        while stack:
            k=stack.pop(); c.append(k)
            for q in graph[k]:
                if q not in seen: seen.add(q); stack.append(q)
        comps.append(c)
    rows=[]; unassigned=[]
    for comp in comps:
        if len(comp)<3: unassigned.extend(comp); continue
        p=centers[comp]; _,_,v=np.linalg.svd(p-p.mean(0),full_matrices=False); dr=_unit(v[0]); dr=-dr if dr[0]<0 else dr; o=p.mean(0); no=np.array([-dr[1],dr[0]]); pr=(p-o)@dr; gaps=np.diff(np.sort(pr)); gl=max(float(np.median(scales[comp]))*6,.08)
        rows.append({'row_id':f'experimental_v4_row_{len(rows)+1}','status':'SUPPORTED' if len(set(x.image_index for k in comp for x in anchors[k]))>=2 else 'WEAK_EVIDENCE','spatial_anchor_count':len(comp),'raw_observation_count':sum(len(anchors[k]) for k in comp),'distinct_image_count':len(set(x.image_index for k in comp for x in anchors[k])),'orientation':{'x':round(float(dr[0]),6),'y':round(float(dr[1]),6)},'orientation_dispersion':round(float(np.std(np.arctan2((p-o)@no,(p-o)@dr))),6),'perpendicular_dispersion':round(float(np.std((p-o)@no)),6),'longitudinal_span':round(float(np.ptp(pr)),6),'supported_segments':int(np.sum(gaps>gl)+1),'centerline':[{'x':round(float(np.clip((o+dr*pr.min())[0],0,1)),6),'y':round(float(np.clip((o+dr*pr.min())[1],0,1)),6)},{'x':round(float(np.clip((o+dr*pr.max())[0],0,1)),6),'y':round(float(np.clip((o+dr*pr.max())[1],0,1)),6)}]})
    rows.sort(key=lambda r:r['centerline'][0]['y'])
    for i,r in enumerate(rows,1): r['row_id']=f'experimental_v4_row_{i}'
    component_ids={k:ci for ci,c in enumerate(comps,1) for k in c}
    anchor_records=[{'anchor_id':i,'x':float(centers[i][0]),'y':float(centers[i][1]),'local_scale':float(scales[i]),'raw_observation_count':len(anchors[i]),'distinct_image_count':len(set(x.image_index for x in anchors[i]))} for i in range(n)]
    component_records=[]
    for ci,comp in enumerate(comps,1):
        pts=centers[comp]; scale=float(np.median(scales[comp])); rec={'component_id':ci,'anchor_ids':list(comp),'anchor_count':len(comp),'raw_observation_count':sum(len(anchors[k]) for k in comp),'distinct_image_count':len(set(x.image_index for k in comp for x in anchors[k])),'accepted_as_row':len(comp)>=3,'centroid':{'x':float(pts[:,0].mean()),'y':float(pts[:,1].mean())},'local_scale':scale,'orientation':None,'orientation_status':'INSUFFICIENT_EVIDENCE' if len(comp)<3 else 'VALID','orientation_dispersion':None,'supported_segments':[],'segment_membership':{str(k):None for k in comp}}
        if len(comp)>=3:
            _,_,vv=np.linalg.svd(pts-pts.mean(0),full_matrices=False); dd=_unit(vv[0]); dd=-dd if dd[0]<0 else dd; nn=np.array([-dd[1],dd[0]]); proj=(pts-pts.mean(0))@dd; rec['orientation']={'x':float(dd[0]),'y':float(dd[1])}; rec['orientation_dispersion']=float(np.std(np.arctan2((pts-pts.mean(0))@nn,(pts-pts.mean(0))@dd))); rec['longitudinal_min']=float(proj.min()); rec['longitudinal_max']=float(proj.max()); rec['longitudinal_span']=float(np.ptp(proj)); rec['perpendicular_dispersion']=float(np.std((pts-pts.mean(0))@nn)); rec['normalized_perpendicular_dispersion']=rec['perpendicular_dispersion']/max(scale,1e-9)
        component_records.append(rec)
    for ri,row in enumerate(rows):
        eligible=[c for c in component_records if c['accepted_as_row'] and c.get('row_id') is None]
        if eligible: component=eligible[0]; component['row_id']=row['row_id']; row['component_ids']=[component['component_id']]; row['anchor_ids']=component['anchor_ids']
    return rows,[anchors[i][0].as_dict()|{'rejection_reason':'UNASSIGNED_ANCHOR'} for i in unassigned],{'anchor_count':n,'candidate_edge_count':len(candidates),'accepted_edge_count':len(accepted),'rejected_edge_count':len(rejected),'component_sizes':[len(c) for c in comps],'largest_component':max(map(len,comps),default=0),'maximum_degree':max((len(g) for g in graph),default=0),'unassigned_anchor_count':len(unassigned),'accepted_edges':accepted,'rejected_edges':[(x[0],x[1]) for x in rejected],'component_ids':component_ids,'anchors':anchor_records,'components':component_records}
