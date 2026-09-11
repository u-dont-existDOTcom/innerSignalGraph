#!/usr/bin/env python3
"""Pinned historical audit diagnostic, NOT runtime/clinical acceptance.
Reads the exact guide and graph, verifies the projection, and mirrors only the
inspected planner's initial readiness/match/defer/rank logic. No model/network
calls or graph mutations. Requires beautifulsoup4. Labels describe distinctions
missing from graph variables, not observed NLP-extractor assignments.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from bs4 import BeautifulSoup

PIN = {
    'graph_commit': 'ad441affd378e06d6395e0ba4ec0760eaaea5d52',
    'article_commit': 'defc51d43fa291dcb00c93468e111c967094164a',
    'master': '06987f70e7264a5ac72d132e4b8420cf75cda60f33bbb430c83a0146e612adf9',
    'graph': '7f75487ab6146e912b0d9c3fb3abff193d12c7f9196313302dde10cd94df3b5c',
    'source_map': 'fd4b69d30720a2012f59ec63b39bd189bcd74d38b46e86bd0c07f9a5dd06475e',
    'reader': '35532449c0bccb2de357c35f675a7a48c4a5ba8ba322456bdd1924e204aef678',
    'planner_git_blob': 'e713a022fe1cb525521a463334e591600855d01c',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def initial_selection(graph, raw):
    v = dict(raw)
    def value(field):
        return v.get(field, 'unknown')
    unsafe = any((value('present_safety') == 'unsafe',
                  value('orientation') == 'disoriented',
                  value('ability_to_stop') == 'no',
                  value('ability_to_return') == 'no',
                  value('activation') == 'high',
                  value('dissociation') == 'high',
                  value('altered_state') == 'altered'))
    ready = all((value('present_safety') == 'safe',
                 value('orientation') == 'oriented',
                 value('ability_to_stop') == 'yes',
                 value('ability_to_return') == 'yes',
                 value('activation') not in ('high', 'unknown'),
                 value('dissociation') not in ('high', 'unknown'),
                 value('altered_state') == 'sober'))
    v['deep_work_readiness'] = 'no' if unsafe else 'yes' if ready else 'unknown'
    def condition(c):
        a, b = value(c['field']), c['value']
        if c['op'] == 'eq': return a == b
        if c['op'] == 'notEq': return a != b
        if c['op'] == 'in': return a in b
        if c['op'] == 'notIn': return a not in b
        raise ValueError('Unsupported operator')
    def matches(activation):
        all_c, any_c, none_c = (activation.get(k, []) for k in ('all', 'any', 'none'))
        return (bool(all_c or any_c or none_c)
                and (not all_c or all(map(condition, all_c)))
                and (not any_c or any(map(condition, any_c)))
                and not any(map(condition, none_c)))
    matched = sorted((n for n in graph['nodes'] if matches(n.get('activation', {}))),
                     key=lambda n: (n['tier'], -n['priority'], n['id']))
    deferred = {x for n in matched for x in n['effects'].get('deferNodes', [])}
    blocked = {x for n in matched for x in n['effects'].get('blockNodes', [])}
    eligible = [n['id'] for n in matched if n['id'] not in deferred | blocked]
    return {'initial_primary': eligible[0] if eligible else None,
            'eligible': eligible,
            'suppressed_matched': [n['id'] for n in matched if n['id'] in deferred | blocked],
            'matched': [n['id'] for n in matched],
            'derived_deep_work_readiness': v['deep_work_readiness']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.'), help='Pinned innerSignalGraph checkout')
    parser.add_argument('--master', type=Path, required=True, help='Pinned joel-articles master.html')
    parser.add_argument('--out', type=Path, required=True, help='Diagnostic JSON output')
    args = parser.parse_args()
    try:
        paths = {'master': args.master,
                 'graph': args.root / 'guide-graphs/candidates/inner-signal-hypnosis.graph.json',
                 'source_map': args.root / 'guide-graphs/source-maps/inner-signal-hypnosis-guide.json'}
        data = {key: path.read_bytes() for key, path in paths.items()}
        for key, content in data.items():
            if digest(content) != PIN[key]:
                raise ValueError(f'{key} differs from pinned historical audit; do not interpret this as a repaired candidate test.')
        graph, source_map = json.loads(data['graph']), json.loads(data['source_map'])
        tags = ['h1', 'h2', 'h3', 'h4', 'p', 'li', 'blockquote']
        soup = BeautifulSoup(data['master'], 'html.parser')
        blocks, headings = [], 0
        for tag in soup.find_all(tags):
            if tag.find_parent(tags): continue
            text = ' '.join(tag.get_text(' ', strip=True).split())
            if text:
                blocks.append(text)
                headings += tag.name.startswith('h')
        reader_hash = digest(('\n'.join(blocks) + '\n').encode())
        section_checks = []
        for section in source_map['sections']:
            text = '\n'.join(blocks[section['lineStart']-1:section['lineEnd']])
            section_checks.append({'id': section['id'], 'match': digest(text.encode()) == section['sha256']})
        source_pass = (reader_hash == PIN['reader'] and len(blocks) == 723 and headings == 151
                       and len(section_checks) == 41 and all(s['match'] for s in section_checks))
        if not source_pass: raise ValueError('Reader or source-section identity failed')
        safe = {'present_safety': 'safe', 'orientation': 'oriented', 'ability_to_stop': 'yes',
                'ability_to_return': 'yes', 'activation': 'low', 'dissociation': 'none',
                'altered_state': 'sober', 'body_capacity': 'adequate', 'support_available': 'absent'}
        cases = [
            ('P01', 'Before a known session; all facts unknown', {}),
            ('P02', 'Stable consultation about a hypnotist', {**safe, 'current_intent': 'conversation'}),
            ('P03', 'Settled hypnosis after purpose chosen', {**safe, 'current_intent': 'hypnosis'}),
            ('P04', 'Request to finish not representable as phase', {**safe, 'current_intent': 'integration'}),
            ('P05', 'Memory concern plus high activation', {**safe, 'current_intent': 'memory_processing', 'activation': 'high', 'memory_source_risk': 'present'}),
            ('P06', 'Unsafe altered state', {**safe, 'current_intent': 'altered_state', 'altered_state': 'altered', 'present_safety': 'unsafe'}),
            ('P07', 'Oriented but cannot stop', {**safe, 'current_intent': 'hypnosis', 'ability_to_stop': 'no'}),
            ('P08', 'Oriented with low body capacity', {**safe, 'current_intent': 'hypnosis', 'body_capacity': 'low'}),
            ('P09', 'Stable gentle practice; help available', {**safe, 'current_intent': 'gentle_practice', 'support_available': 'present'}),
            ('P10', 'Same as P09 but help absent', {**safe, 'current_intent': 'gentle_practice'}),
            ('P11', 'Positive hypnosis purpose missing from variables', {**safe, 'current_intent': 'hypnosis'}),
            ('P12', 'Memory intent with source risk absent', {**safe, 'current_intent': 'memory_processing', 'memory_source_risk': 'absent'}),
        ]
        results = [{'id': i, 'label': label, 'variables': v, 'observation': initial_selection(graph, v)}
                   for i, label, v in cases]
        output = {'kind': 'pinned-source-checks-and-bounded-selector-mirror', 'identities': PIN,
                  'source_identity': 'PASS', 'blocks': len(blocks), 'headings': headings,
                  'section_checks': section_checks, 'cases': results,
                  'limitations': ['Not the actual runtime or deployed app.',
                                  'No NLP extraction, realization, or clinical validation.',
                                  'Mirrors only the relevant initial selector; no task policy is added.',
                                  'No changed-candidate acceptance or owner policy approval.']}
        args.out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
        print('Source identity PASS; 41 section hashes; 12 bounded diagnostic cases.')
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
