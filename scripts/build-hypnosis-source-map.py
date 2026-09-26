#!/usr/bin/env python3
"""Regenerate only source-map and coverage derivatives; never change graph policy."""
from pathlib import Path
import argparse, hashlib, json


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path('.'));p.add_argument('--check',action='store_true');a=p.parse_args();root=a.root
    graph=json.loads((root/'guide-graphs/candidates/inner-signal-hypnosis.graph.json').read_text())
    b=(root/graph['libraryPath']).read_bytes();lib=json.loads(b)
    if hashlib.sha256(b).hexdigest()!=graph['librarySha256']:raise SystemExit('Graph/library hash drift')
    if graph['sourceAuthority']!=lib['binding']['article']:raise SystemExit('Source authority drift')
    source_map={'format':'hypnosis-source-map-v2','guideId':graph['guideId'],'sourceAuthority':graph['sourceAuthority'],'libraryPath':graph['libraryPath'],'librarySha256':graph['librarySha256'],'sections':[{k:r[k] for k in ['id','title','parent','layer','source','textSha256','epistemicRole']} for r in lib['records']]}
    records=[]
    for r in lib['records']:
        ids=[n['id'] for n in graph['nodes'] if r['id'] in n['sourceRefs']]
        records.append({'source':r['id'],'heading':r['title'],'layer':r['layer'],'text_sha256':r['textSha256'],'node_refs':ids,'disposition':'node-linked and retrievable' if ids else 'retrievable source/reference; no invented compulsory action'})
    coverage={'format':'hypnosis-source-coverage-v2','note':'Every source record is available as actual text. Routing-node coverage is not the same as teaching completeness or independent entailment proof.','records':records}
    for name,obj in [('guide-graphs/source-maps/inner-signal-hypnosis-guide.json',source_map),('tasks/hypnosis-ic-sync-r03-20260911/SOURCE-COVERAGE.json',coverage)]:
        data=(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode();dest=root/name
        if a.check:
            if not dest.is_file() or dest.read_bytes()!=data:raise SystemExit('Derivative drift: '+name)
        else:dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
    print('Source-map and coverage derivatives match' if a.check else 'Source-map and coverage regenerated')

if __name__=='__main__':main()
