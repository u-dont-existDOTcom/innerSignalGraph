#!/usr/bin/env python3
"""Build a read-only source-linked hypnosis library from explicit, hash-pinned inputs.

No network, content rewriting, graph-policy inference, or publication. Native editor
islands are excluded using Joel Articles' canonical source-preservation parser.
"""
from __future__ import annotations
import argparse, hashlib, html, importlib.util, importlib.machinery, json, re, sys
from html.parser import HTMLParser
from pathlib import Path

sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode('utf-8')).hexdigest()
def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.casefold()).strip('-')
def dumps(x):
    return json.dumps(x, ensure_ascii=False, indent=2) + '\n'

class Reader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.out=[]; self.ignored=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','svg'): self.ignored += 1
        if not self.ignored and tag in ('p','li','br','h1','h2','h3','h4','h5','h6','blockquote'): self.out.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','svg') and self.ignored: self.ignored -= 1
        elif not self.ignored and tag in ('p','li','h1','h2','h3','h4','h5','h6','blockquote'): self.out.append('\n')
    def handle_data(self, s):
        if not self.ignored: self.out.append(s)
    def text(self):
        return '\n'.join(re.sub(r'\s+', ' ', x).strip() for x in ''.join(self.out).splitlines() if x.strip())

def visible(s):
    p=Reader(); p.feed(s); return p.text()

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--article',type=Path,required=True)
    ap.add_argument('--inner-child',type=Path,required=True)
    ap.add_argument('--reference-root',type=Path,required=True)
    ap.add_argument('--islands-tool',type=Path,required=True)
    ap.add_argument('--binding',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True)
    a=ap.parse_args(); binding=json.loads(a.binding.read_text())
    for name, path in [('article',a.article),('innerChild',a.inner_child),('islandsTool',a.islands_tool)]:
        if sha(path.read_bytes()) != binding[name]['sha256']: raise SystemExit(f'Input hash mismatch: {name}')
    spec=importlib.util.spec_from_loader('canonical_islands', importlib.machinery.SourceFileLoader('canonical_islands',str(a.islands_tool)))
    mod=importlib.util.module_from_spec(spec); sys.modules[spec.name]=mod; spec.loader.exec_module(mod)
    raw=a.article.read_text(); spans=mod.find_protected_spans(raw)
    # Preserve source character offsets: blank only the native islands, not the source.
    clean=list(raw)
    for start,end in spans: clean[start:end]=' '*(end-start)
    clean=''.join(clean)
    records=[]; seen={}; stack=[]
    headers=list(re.finditer(r'<h([1-6])\b[^>]*>(.*?)</h\1>',clean,re.S|re.I))
    chunks=[(0,0,'Opening',0)] + [(h.start(),int(h.group(1)),visible(h.group(2)),h.end()) for h in headers]
    personal={'Introduction','The Most Extreme Example','Affirmations Done Right','Reversing Accidental Affirmations','Why doing it myself worked better for me'}
    for i,(start,level,title,hend) in enumerate(chunks):
        end=chunks[i+1][0] if i+1<len(chunks) else len(raw)
        text=visible(clean[start:end]); key=slug(title) or 'opening'; seen[key]=seen.get(key,0)+1
        ident='HYP.S.'+key+(f'-{seen[key]}' if seen[key]>1 else '')
        while stack and stack[-1][0]>=level: stack.pop()
        parent=stack[-1][1] if stack else None
        records.append(dict(id=ident,layer='hypnosis-guide',title=title,level=level,parent=parent,
            text=text,format='text',textSha256=sha(text),source=dict(document='hypnosis-r03',start=start,end=end,
            rawSpanSha256=sha(raw[start:end]),heading=title),
            epistemicRole='owner-testimony-or-interpretation' if title in personal else 'owner-guide-not-independently-validated'))
        stack.append((level,ident))
    ic=a.inner_child.read_text(); headers=list(re.finditer(r'^(#{1,6})[ \t]+(.+?)\s*$',ic,re.M)); seen={}; stack=[]
    for i,h in enumerate(headers):
        end=headers[i+1].start() if i+1<len(headers) else len(ic)
        title=re.sub(r'\s+',' ',h.group(2)).strip(); level=len(h.group(1)); key=slug(title) or 'heading'
        seen[key]=seen.get(key,0)+1; ident='IC.S.'+key+(f'-{seen[key]}' if seen[key]>1 else '')
        while stack and stack[-1][0]>=level: stack.pop()
        parent=stack[-1][1] if stack else None
        text=ic[h.start():end].strip() # exact Markdown, including linked source terminology
        records.append(dict(id=ident,layer='inner-child-companion',title=title,level=level,parent=parent,
            text=text,format='markdown',textSha256=sha(text),source=dict(document='inner-child-owner-20260911',
            start=h.start(),end=end,rawSpanSha256=sha(ic[h.start():end]),heading=title),epistemicRole='owner-guide-not-independent-evidence'))
        stack.append((level,ident))
    refs={}
    for name, expected in binding['externalReference']['files'].items():
        content=(a.reference_root/name).read_text()
        if sha(content)!=expected: raise SystemExit(f'Reference hash mismatch: {name}')
        refs[name]=content
    content=refs['TEACHING-REFERENCE.md']
    topics=list(re.finditer(r'^### (T\d{2}) — (.+)$',content,re.M))
    for i,h in enumerate(topics):
        end=topics[i+1].start() if i+1<len(topics) else len(content)
        text=content[h.start():end].strip()
        records.append(dict(id='REF.'+h.group(1),layer='external-research',title=h.group(2),level=3,parent=None,
            text=text,format='markdown',textSha256=sha(text),source=dict(document='TEACHING-REFERENCE.md',start=h.start(),end=end,
            rawSpanSha256=sha(content[h.start():end]),heading=h.group(2)),epistemicRole='attributed-source-account-and-separately-labelled-application'))
    # Source ledger and consultation protocol stay accessible, not injected into narration.
    for name in ('SOURCES-AND-READING.md','CONSULTATION-AND-ACCEPTANCE.md'):
        text=refs[name]; ident='REF.SOURCES' if name.startswith('SOURCES') else 'REF.CONSULTATION'
        records.append(dict(id=ident,layer='external-research',title=name,level=1,parent=None,text=text,format='markdown',
            textSha256=sha(text),source=dict(document=name,start=0,end=len(text),rawSpanSha256=sha(text),heading=name),
            epistemicRole='reading-record-or-authored-evaluation-not-completed-validation'))
    output=dict(format='hypnosis-knowledge-v2',binding=binding,sourcePolicy={
        'articleAuthority':'joel-articles current registered master; this text index is a read-only derivative',
        'sourceAccountsAreNotClinicalValidation':True,'externalResearchIsNotGuideAuthorship':True,
        'narrateCitations':False,'lookupRequiredBeyondCoverage':True,'installedRuntimeChanged':False},
        counts={layer:sum(r['layer']==layer for r in records) for layer in ('hypnosis-guide','inner-child-companion','external-research')},records=records)
    a.out.parent.mkdir(parents=True,exist_ok=True); a.out.write_text(dumps(output))
    print(dumps({'output':str(a.out),'sha256':sha(a.out.read_bytes()),'counts':output['counts']}))
if __name__=='__main__': main()
