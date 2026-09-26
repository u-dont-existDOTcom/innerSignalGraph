#!/usr/bin/env python3
"""Check a design packet, not the application or a model. Python standard library only."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import time
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--design', type=Path, help='Path to the Markdown design if not adjacent')
    parser.add_argument('--output', type=Path, help='Optional JSON receipt path')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    start = time.perf_counter()
    contract = json.loads((root/'contract.json').read_text(encoding='utf-8'))
    cases = json.loads((root/'acceptance-cases.json').read_text(encoding='utf-8'))
    design_path = args.design or root/'DESIGN.md'
    design = design_path.read_text(encoding='utf-8')
    checks = []

    def check(name, predicate):
        if not predicate:
            raise ValueError(f'Design consistency check failed: {name}')
        checks.append(name)

    def validate_example(case):
        assertion = {**cases['assertion_defaults'], **case['assertion']}
        span = case['span']
        if not set(contract['assertion_required_fields']) <= assertion.keys():
            raise ValueError('Missing assertion field')
        if not set(contract['span_required_fields']) <= span.keys():
            raise ValueError('Missing span field')
        if assertion['kind'] not in contract['assertion_kinds']:
            raise ValueError('Unknown epistemic kind')
        if assertion['evidence_ids'] != [span['id']]:
            raise ValueError('Unresolved evidence reference')
        raw = case['source_text'].encode('utf-8')
        lo, hi = span['start_byte'], span['end_byte']
        if not isinstance(lo, int) or not isinstance(hi, int) or not 0 <= lo < hi <= len(raw):
            raise ValueError('Bad source range')
        exact = raw[lo:hi].decode('utf-8')
        if exact != span['quote']:
            raise ValueError('Quote differs from source bytes')
        if hashlib.sha256(raw[lo:hi]).hexdigest() != span['quote_sha256']:
            raise ValueError('Quote digest mismatch')
        if assertion['still_current'] is not None:
            raise ValueError('These historical examples must not default to current')
        for name in ['authored_time', 'event_time']:
            if assertion[name]['precision'] != 'unknown' or assertion[name]['timezone'] is not None:
                raise ValueError('Synthetic unknown date was assigned false precision')

    check('design-only status is explicit', contract['status'] == 'design_only_not_runtime' and 'importer not implemented' in design)
    check('four-layer architecture is declared', len(set(contract['layers'])) == 4)
    check('all 13 design sections exist', all(f'## {i}.' in design for i in range(1,14)))
    check('source references R1-R4 and P1-P6 are present', all(f'**{r}**' in design for r in ['R1','R2','R3','R4','P1','P2','P3','P4','P5','P6']))
    check('synthetic data provenance is explicit', cases['data_origin'] == 'entirely_synthetic')
    check('fixture IDs are unique', len({c['id'] for c in cases['cases']}) == len(cases['cases']))
    invs={x['id'] for x in contract['invariants']}
    check('all invariant references resolve', all(set(c['invariant_ids']) <= invs for c in cases['cases']))
    check('every invariant has acceptance coverage', invs <= {i for c in cases['cases'] for i in c['invariant_ids']})
    check('all application cases truthfully remain unexecuted', all(c['execution_status']=='not_run_against_application' for c in cases['cases']))
    check('no unsafe default activation', all(v is False for k,v in contract['defaults'].items() if k!='historical_still_current') and contract['defaults']['historical_still_current'] is None)
    examples=[c for c in cases['cases'] if 'source_text' in c]
    for c in examples:
        validate_example(c)
        checks.append(f"{c['id']}: fields, UTF-8 span, digest and unknown currentness")
    check('all epistemic kinds have example coverage', set(contract['assertion_kinds']) <= {c['assertion']['kind'] for c in examples})
    for name, mutate in [
        ('wrong_quote', lambda c: c['span'].__setitem__('quote','not the source')),
        ('missing_support', lambda c: c['assertion'].__setitem__('evidence_ids',[])),
        ('false_currentness', lambda c: c['assertion'].__setitem__('still_current',True)),
        ('unknown_kind', lambda c: c['assertion'].__setitem__('kind','verified_diagnosis')),
        ('invalid_utf8_boundary', lambda c: c['span'].__setitem__('end_byte',c['source_text'].encode('utf-8').index('é'.encode('utf-8'))+1))
    ]:
        altered=copy.deepcopy(examples[0]); mutate(altered)
        try:
            validate_example(altered)
        except (ValueError, UnicodeDecodeError):
            checks.append(f'example-validator rejects {name}')
        else:
            raise ValueError(f'Example validator accepted {name}')
    check('semantic target is unmeasured and not archive-only blocker', contract['semantic_target']['status']=='provisional_not_measured' and contract['semantic_target']['not_an_archive_only_blocker'])
    result={
      'schema_version':1,'checked_at':datetime.now(timezone.utc).isoformat(),'result':'PASS_DESIGN_CONSISTENCY_ONLY',
      'check_count':len(checks),'elapsed_seconds':round(time.perf_counter()-start,6),'checks':checks,
      'synthetic_source_examples':len(examples),'future_application_acceptance_cases':len(cases['cases']),
      'runtime_tests_executed':False,'model_extraction_executed':False,'real_private_data_read':False,
      'semantic_recall_measured':False,'security_certification':False,
      'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [design_path,root/'contract.json',root/'acceptance-cases.json',Path(__file__)]}
    }
    if args.output:
        args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:result[k] for k in ['result','check_count','synthetic_source_examples','future_application_acceptance_cases','elapsed_seconds']},indent=2))

if __name__=='__main__':
    main()
