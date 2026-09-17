"""Validate package coherence, not clinical/application/host behavior."""
from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]
required=['00-READ-ME.md','01-ARCHITECTURE.md','02-INTERFACES.md','03-WORK-INSTRUCTION.md','04-VERIFICATION-PLAN.md','05-PRIOR-WORK-AND-SOURCES.md','CHATGPT-CONTINUITY-INSTRUCTION.md','reference/README.md','reference/continuity.mjs','reference/continuity.test.mjs','contracts/continuity-v1.schema.json','evals/prompts.json','evals/gold.json','evidence/SOURCE-REGISTER.json']
for rel in required:
    path=ROOT/rel
    assert path.is_file() and path.stat().st_size>0, f'Missing or empty {rel}'
for path in ROOT.rglob('*.json'):
    json.loads(path.read_text())
sources=json.loads((ROOT/'evidence/SOURCE-REGISTER.json').read_text())
source_ids={x['id'] for x in sources['sources']}
for path in ROOT.glob('*.md'):
    content=path.read_text()
    for group in re.findall(r'\[([OMR][0-9][^\]]*)\]',content):
        for sid in re.findall(r'[OMR][0-9]+',group):
            assert sid in source_ids, f'Unresolved source {sid} in {path.name}'
    assert content.count('```')%2==0, f'Unclosed fence in {path.name}'
    for forbidden in ['Louka','Corsica','28d957d9a456f7701b3cc5a89edaf764e2e36d59','handoff:9f660db1']:
        assert forbidden not in content, f'Private/unverified content {forbidden} in {path.name}'
instruction=(ROOT/'CHATGPT-CONTINUITY-INSTRUCTION.md').read_text()
assert len(instruction)<=8000
prompts=json.loads((ROOT/'evals/prompts.json').read_text())['cases']
gold=json.loads((ROOT/'evals/gold.json').read_text())['cases']
assert len({x['id'] for x in prompts})==len(prompts)
assert {x['id'] for x in prompts}=={x['id'] for x in gold}
assert all(x['synthetic'] is True for x in prompts)
assert all('required_behavior' not in x for x in prompts)
schema=json.loads((ROOT/'contracts/continuity-v1.schema.json').read_text())
assert schema['$schema']=='https://json-schema.org/draft/2020-12/schema'
try:
    import jsonschema
except ImportError:
    schema_status='syntax_only_jsonschema_library_unavailable'
else:
    jsonschema.Draft202012Validator.check_schema(schema)
    schema_status='draft202012_schema_valid'
print(json.dumps({'status':'PASS','scope':'artifact_structure_and_source_reference_coherence','required_files':len(required),'behavioral_fixture_count':len(prompts),'native_instruction_characters':len(instruction),'schema_check':schema_status,'host_or_model_behavior_tested':False},indent=2))
