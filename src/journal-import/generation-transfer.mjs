import {createHash} from 'node:crypto';
import {ValidationError} from '../core/errors.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const requireValue=(condition,code)=>{if(!condition)throw new ValidationError(code,{code});};

/** Re-encrypt only the immutable generation's reachable objects under the
 * destination corpus key. This function never publishes a profile pointer. */
export async function transferJournalGeneration({sourceStore,destinationStore,persisted,authorize=async()=>{}}){
  const manifest=persisted.manifest;
  requireValue(sourceStore.caseId===destinationStore.caseId&&sourceStore.corpusId===destinationStore.corpusId,
    'JOURNAL_TRANSFER_IDENTITY_MISMATCH');
  requireValue(manifest.case_id===sourceStore.caseId&&manifest.corpus_id===sourceStore.corpusId,
    'JOURNAL_TRANSFER_MANIFEST_MISMATCH');
  const objects=[...manifest.record_shards,...Object.values(manifest.indexes).flat(),
    ...Object.values(manifest.source_representation_objects),
    ...manifest.archive_references.flatMap(archive=>archive.chunks.map(chunk=>({...chunk,object_id:archive.object_id,object_version:archive.object_version}))),
    persisted.manifest_reference];
  const seen=new Set();let copied=0,reused=0,bytes=0;
  for(const ref of objects){
    const identity=JSON.stringify([ref.object_id,ref.object_version,ref.chunk_index??0]);
    if(seen.has(identity))continue;seen.add(identity);
    await authorize();
    const input={objectId:ref.object_id,objectVersion:ref.object_version,chunkIndex:ref.chunk_index??0};
    const plaintext=await sourceStore.readObject(input);
    try{
      requireValue(plaintext.length===ref.byte_length&&digest(plaintext)===ref.sha256,'JOURNAL_TRANSFER_SOURCE_MISMATCH');
      let existing=null;
      try{existing=await destinationStore.readObject(input);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(existing){
        try{requireValue(existing.equals(plaintext),'JOURNAL_TRANSFER_DESTINATION_CONFLICT');reused++;}finally{existing.fill(0);}
      }else{
        await authorize();
        await destinationStore.writeObject({...input,plaintextBytes:plaintext});copied++;
      }
      const reopened=await destinationStore.readObject(input);
      try{requireValue(reopened.equals(plaintext),'JOURNAL_TRANSFER_READBACK_FAILED');}finally{reopened.fill(0);}
      bytes+=plaintext.length;
    }finally{plaintext.fill(0);}
  }
  for(const archive of manifest.archive_references){
    await authorize();
    for await(const chunk of destinationStore.iterateOriginal(archive))void chunk;
  }
  const saved=await destinationStore.readJsonObject({objectId:persisted.manifest_object_id});
  requireValue(JSON.stringify(saved)===JSON.stringify(manifest),'JOURNAL_TRANSFER_MANIFEST_MISMATCH');
  await authorize();
  return {objects_verified:seen.size,copied_objects:copied,reused_objects:reused,plaintext_bytes_verified:bytes,
    archive_count:manifest.archive_references.length,manifest_verified:true,profile_pointer_published:false};
}
