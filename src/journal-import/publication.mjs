import {createHash} from 'node:crypto';
import {ValidationError} from '../core/errors.mjs';
import {transferJournalGeneration} from './generation-transfer.mjs';
const requireValue=(v,code)=>{if(!v)throw new ValidationError(code,{code});};
function legacyDigest(record){
  const copy=structuredClone(record);
  for(const key of ['revision','updated_at','schema_version','journal_corpora','journal_corpus_keys'])delete copy[key];
  return createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}

/** Backend operator only. No inference, source interpretation or MCP mutation. */
export async function publishJournalGenerationFromStaging({service,sourceStore,persisted,auth,authorize}){
  const manifest=persisted.manifest,caseId=manifest.case_id,corpusId=manifest.corpus_id;
  requireValue(manifest.permitted_uses.includes('session_use'),'JOURNAL_PUBLICATION_PURPOSE_MISSING');
  requireValue(typeof authorize==='function','JOURNAL_PUBLICATION_AUTHORIZATION_REQUIRED');
  await authorize();
  const before=await service.loadPrivateRuntimeCase(caseId,auth);
  const prior=before.journal_corpora.find(r=>r.corpus_id===corpusId)??null;
  requireValue(!prior||prior.active_generation===null||
    (prior.active_generation===manifest.generation&&prior.manifest_object_id===persisted.manifest_object_id),
    'JOURNAL_PUBLICATION_GENERATION_CONFLICT');
  // Creating the corpus allocates its private key but exposes no active generation.
  // All subsequent object writes precede the short generation-pointer transaction.
  if(!prior){await authorize();await service.createJournalCorpus(caseId,{corpusId,manifestObjectId:persisted.manifest_object_id},auth);}
  const transfer=await service.withJournalCorpus(caseId,corpusId,{requiredScope:'case:write',requiredPurpose:'archive'},
    async({corpusStore,reference})=>{
      requireValue(reference.visibility_epoch===manifest.visibility_epoch,'GRANT_REVOKED');
      return transferJournalGeneration({sourceStore,destinationStore:corpusStore,persisted,authorize});
    },auth);
  let publication;
  for(let attempt=0;attempt<3;attempt++){
    await authorize();
    const latest=await service.getJournalCorpus(caseId,corpusId,auth);
    requireValue(latest.reference.visibility_epoch===manifest.visibility_epoch,'GRANT_REVOKED');
    requireValue(latest.reference.active_generation===null||latest.reference.active_generation===manifest.generation,
      'JOURNAL_PUBLICATION_GENERATION_CONFLICT');
    try{
      publication=await service.publishJournalGeneration(caseId,{corpusId,generation:manifest.generation,
        manifestObjectId:persisted.manifest_object_id,expectedGeneration:latest.reference.active_generation,
        expectedCaseRevision:latest.case_revision,expectedVisibilityEpoch:manifest.visibility_epoch},auth);
      break;
    }catch(error){if(error.code!=='REVISION_CONFLICT'||attempt===2)throw error;}
  }
  await authorize();
  const saved=await service.getJournalCorpus(caseId,corpusId,auth);
  requireValue(saved.reference.active_generation===manifest.generation&&saved.reference.manifest_object_id===persisted.manifest_object_id,
    'JOURNAL_PUBLICATION_READBACK_FAILED');
  const after=await service.loadPrivateRuntimeCase(caseId,auth);
  const legacyPreserved=legacyDigest(before)===legacyDigest(after);
  // Concurrent legitimate changes are never overwritten or rolled back to a stale
  // snapshot. A changed digest remains an explicit preservation check to resolve.
  return {publication,transfer,reference:saved.reference,prior_reference:prior,
    legacy_before_sha256:legacyDigest(before),legacy_after_sha256:legacyDigest(after),
    legacy_state_unchanged:legacyPreserved,profile_committed:true,cold_retrieval_verified:false};
}
