"""Measured reference checks with identical-green suppression. No network calls."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess, time, sys
ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'evidence'
EVIDENCE.mkdir(exist_ok=True)
START=datetime.now(timezone.utc)
def fingerprint(paths,cmd):
    h=hashlib.sha256(json.dumps(cmd).encode())
    for p in sorted(paths):
        h.update(str(p.relative_to(ROOT)).encode());h.update(p.read_bytes())
    return h.hexdigest()
previous={}
receipt_path=EVIDENCE/'REFERENCE-VERIFICATION.json'
if receipt_path.exists():
    previous={r['fingerprint']:r for r in json.loads(receipt_path.read_text()).get('checks',[]) if r.get('exit_code')==0}
checks=[]
specs=[('reference-unit-tests',['node','--test','reference/continuity.test.mjs'],list((ROOT/'reference').glob('*.mjs')),'focused'),('artifact-validation',[sys.executable,'reference/validate_artifacts.py'],[p for p in ROOT.rglob('*') if p.is_file() and p.suffix in {'.md','.json','.py'} and p.name not in {'REFERENCE-VERIFICATION.json','MANIFEST.json','PACKAGE-STATUS.json'}],'artifact')]
for name,cmd,paths,tier in specs:
    fp=fingerprint(paths,cmd)
    if fp in previous:
        old=previous[fp]
        checks.append({**old,'execution':'reused_unchanged_green','reused_at':START.isoformat()})
        continue
    before=time.monotonic();at=datetime.now(timezone.utc).isoformat()
    try:
        result=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=40)
        rc=result.returncode;out=result.stdout;err=result.stderr
    except subprocess.TimeoutExpired as exc:
        rc=124;out=str(exc.stdout or '');err=str(exc.stderr or '')+'\nTIMEOUT'
    duration=time.monotonic()-before
    output_path=EVIDENCE/(name+'.txt');output_path.write_text(out+('\nSTDERR\n'+err if err else ''))
    checks.append({'name':name,'tier':tier,'command':cmd,'fingerprint':fp,'started_at':at,'duration_seconds':duration,'exit_code':rc,'execution':'executed','output':str(output_path.relative_to(ROOT))})
end=datetime.now(timezone.utc)
build_start=json.loads((EVIDENCE/'BUILD-START.json').read_text())['started_at']
wall=(end-datetime.fromisoformat(build_start)).total_seconds()
test_seconds=sum(x['duration_seconds'] for x in checks if x['execution']=='executed')
receipt={'schema_version':1,'scope':'ISOLATED_REFERENCE_ONLY','status':'PASS' if all(x['exit_code']==0 for x in checks) else 'FAIL','checked_at':end.isoformat(),'node_version':subprocess.check_output(['node','--version'],text=True).strip(),'python_version':sys.version.split()[0],'repository_runtime_required_at_baseline':'24.18.0','repository_integration_tested':False,'native_host_tested':False,'semantic_model_evaluation_run':False,'private_case_accessed':False,'paid_inference_calls':0,'design_and_reference_task_wall_seconds':wall,'this_invocation_test_seconds':test_seconds,'this_invocation_test_share_of_task_wall':test_seconds/wall if wall>0 else None,'checks':checks}
receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
sys.exit(0 if receipt['status']=='PASS' else 1)
