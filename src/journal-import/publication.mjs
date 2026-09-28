import {ValidationError} from '../core/errors.mjs';
import {transferJournalGeneration} from './generation-transfer.mjs';
const requireValue=(v,code)=>{if(!v)throw new ValidationError(code,{code});};
const requireReference=(snapshot)=>{
  if(!snapshot.reference)throw new ValidationError('Journal corpus was not found.',{code:'PRIVATE_CASE_NOT_FOUND'});
  return snapshot.reference;
};

/** Backend operator only. No inference, source interpretation or MCP mutation. */
export async function publishJournalGenerationFromStaging({service,sourceStore,persisted,auth,authorize}){
  const manifest=persisted.manifest,caseId=manifest.case_id,corpusId=manifest.corpus_id;
  requireValue(manifest.permitted_uses.includes('session_use'),'JOURNAL_PUBLICATION_PURPOSE_MISSING');
  requireValue(typeof authorize==='function','JOURNAL_PUBLICATION_AUTHORIZATION_REQUIRED');
  // The operator holds case:write only. Every read here is a write-authorized inspection that
  // carries the case revision, the corpus reference and a digest of the state outside the journal,
  // never case content, so the import needs no case:read grant.
  const inspect=()=>service.inspectJournalCorpus(caseId,corpusId,{requiredScope:'case:write',requiredPurpose:'session_use'},auth);
  await authorize();
  const before=await inspect();
  const prior=before.reference;
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
    const latest=await inspect(),reference=requireReference(latest);
    requireValue(reference.visibility_epoch===manifest.visibility_epoch,'GRANT_REVOKED');
    requireValue(reference.active_generation===null||reference.active_generation===manifest.generation,
      'JOURNAL_PUBLICATION_GENERATION_CONFLICT');
    try{
      publication=await service.publishJournalGeneration(caseId,{corpusId,generation:manifest.generation,
        manifestObjectId:persisted.manifest_object_id,expectedGeneration:reference.active_generation,
        expectedCaseRevision:latest.case_revision,expectedVisibilityEpoch:manifest.visibility_epoch},auth);
      break;
    }catch(error){if(error.code!=='REVISION_CONFLICT'||attempt===2)throw error;}
  }
  await authorize();
  const saved=await inspect(),reference=requireReference(saved);
  requireValue(reference.active_generation===manifest.generation&&reference.manifest_object_id===persisted.manifest_object_id,
    'JOURNAL_PUBLICATION_READBACK_FAILED');
  // Concurrent legitimate changes are never overwritten or rolled back to a stale
  // snapshot. A changed digest remains an explicit preservation check to resolve.
  return {publication,transfer,reference,prior_reference:prior,
    legacy_before_sha256:before.non_journal_state_sha256,legacy_after_sha256:saved.non_journal_state_sha256,
    legacy_state_unchanged:before.non_journal_state_sha256===saved.non_journal_state_sha256,
    profile_committed:true,cold_retrieval_verified:false};
}
