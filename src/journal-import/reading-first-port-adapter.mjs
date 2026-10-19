import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { buildJournalRolePacket } from "./provider-port.mjs";

// Private-only adapter for authorized provider calls. Every source and result
// remains in the existing protected journal inference/store boundary. Never
// use it to repackage source that a provider previously refused.
const sha = (value) => createHash("sha256").update(value).digest("hex");
const invariant = (ok, code) => { if (!ok) throw new ValidationError(code, { code }); };
const MAX_SOURCE_TEXT = 60_000;
const MAX_SYNTHESIS_INPUT = 42_000;
const MAX_GROUP = 12;

export function createReadingFirstPortAdapter({
  port, grant, generation, sourceSha256, readEvidence, knownState = null
}) {
  invariant(port && typeof port.invoke === "function" && typeof port.getCompletion === "function" &&
    typeof readEvidence === "function" && typeof generation === "string" &&
    typeof sourceSha256 === "string" && typeof grant?.purpose === "string",
    "JOURNAL_READING_FIRST_PROVIDER_INVALID");

  const completed = new Map();
  const buildPacket = (role, fields, coreIds, sourceLocators, operationKey) =>
    buildJournalRolePacket(role, {
      protocol_version: "1.0",
      output_schema_id: role === "source_reader" ? "source-reading-result" : "source-synthesis-result",
      assigned_core_ids: coreIds, source_locators: sourceLocators,
      expected_generation: generation, controller_provenance_tag: operationKey,
      grant_purpose: grant.purpose, ...fields
    });

  async function invoke(role, fields, coreIds, locators, operationKey) {
    const packet = buildPacket(role, fields, coreIds, locators, operationKey);
    const result = await port.invoke({
      role, packet, outputSchema: packet.output_schema_id,
      operationKey, grant
    });
    invariant(result?.receipt?.completion_status === "completed" &&
      result.receipt.target_generation === generation &&
      typeof result.receipt.receipt_id === "string",
      "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED");
    completed.set(operationKey, {
      output: result.output, receipt: result.receipt,
      outputDigest: sha(JSON.stringify(result.output))
    });
    return { ...result, operationKey };
  }
  async function confirm(operationKey, receipt, reportedOutputSha) {
    const remembered = completed.get(operationKey);
    if (!remembered || receipt?.receipt_id !== remembered.receipt.receipt_id) return false;
    const confirmed = await port.getCompletion(operationKey);
    if (confirmed?.status !== "completed" ||
      confirmed.receipt?.receipt_id !== remembered.receipt.receipt_id ||
      confirmed.receipt?.target_generation !== generation ||
      sha(JSON.stringify(confirmed.output)) !== remembered.outputDigest) return false;
    // reportedOutputSha is computed from the private controller-normalized
    // observation; it is not a provider signature by itself.
    return typeof reportedOutputSha === "string" && /^[a-f0-9]{64}$/.test(reportedOutputSha);
  }

  async function reader(request) {
    invariant(request.text.length <= MAX_SOURCE_TEXT,
      "JOURNAL_READING_FIRST_PAGE_TOO_LARGE");
    invariant(request.required_modalities === "text",
      "JOURNAL_READING_FIRST_VISUAL_REVIEW_REQUIRED");
    const workId = "reading-first:page:" + sha(generation+"\0"+sourceSha256+"\0"+request.page);
    const item = await invoke("source_reader", {
      page: request.page, source_page_sha256: request.source_page_sha256,
      text: request.text, required_modalities: "text"
    }, [workId],
    [{ representation_id:"reading-first:page:"+request.page, page:request.page,
      start_byte:0, end_byte:Buffer.byteLength(request.text,"utf8") }],
    workId);
    return {
      observation: item.output,
      provider_receipt: { ...item.receipt, operation_key:item.operationKey }
    };
  }
  async function verifyCompletion({page,input_sha256,provider_receipt,output_sha256}) {
    if (!Number.isSafeInteger(page) || !/^[a-f0-9]{64}$/.test(input_sha256))
      return false;
    const workId="reading-first:page:"+sha(generation+"\0"+sourceSha256+"\0"+page);
    return confirm(workId,provider_receipt,output_sha256);
  }

  let synthesisSequence=0;
  const synthesisReceipts = new Map();
  async function synthCall({observations,prior_summaries,scope,allowedRefs}) {
    const content = { observations,prior_summaries,known_state:knownState??{},
      review_scope:scope };
    invariant(Buffer.byteLength(JSON.stringify(content),"utf8") <= MAX_SYNTHESIS_INPUT,
      "JOURNAL_READING_FIRST_SYNTHESIS_PACKET_TOO_LARGE");
    const workId="reading-first:synth:"+sha(generation+"\0"+scope+"\0"+
      synthesisSequence+++"\0"+sha(JSON.stringify(content)));
    const item=await invoke("source_synthesizer",content,
      ["synthesis:"+scope],[],workId);
    const output=item.output;
    invariant(output?.schema_version === "1.0" &&
      output.known_vs_new_reconciled === true &&
      output.longitudinal_counterexamples_checked === true &&
      Array.isArray(output.source_evidence_refs) &&
      output.source_evidence_refs.every(ref => allowedRefs.has(ref)) &&
      Array.isArray(output.meaningful_changes) &&
      output.meaningful_changes.every(c =>
        Array.isArray(c.evidence_refs) && c.evidence_refs.every(ref => allowedRefs.has(ref))),
      "JOURNAL_READING_FIRST_SYNTHESIS_SOURCE_INVALID");
    synthesisReceipts.set(workId,{receipt:item.receipt, output_sha256:sha(JSON.stringify(output))});
    return { ...output, provider_receipt:{...item.receipt,operation_key:workId} };
  }
  function batches(records) {
    const grouped=[];let group=[],bytes=0;
    for(const v of records){
      const size=Buffer.byteLength(JSON.stringify(v),"utf8")+128;
      invariant(size<=MAX_SYNTHESIS_INPUT,
        "JOURNAL_READING_FIRST_SYNTHESIS_PACKET_TOO_LARGE");
      if(group.length && (group.length>=MAX_GROUP || bytes+size>MAX_SYNTHESIS_INPUT/2)){
        grouped.push(group);group=[];bytes=0;
      }
      group.push(v);bytes+=size;
    }
    if(group.length)grouped.push(group);
    return grouped;
  }
  async function synthesize({persisted_source_evidence,unresolved}) {
    if(persisted_source_evidence.length === 0){
      return { schema_version:"1.0",
        provisional_longitudinal_summary:"No original-source text was available for analysis.",
        source_evidence_refs:[], known_vs_new_reconciled:true,
        longitudinal_counterexamples_checked:true,meaningful_changes:[],
        provider_receipt:{special_status:"all_pending_verified",unresolved_count:unresolved.length} };
    }
    const items=[];
    for(const item of persisted_source_evidence){
      const stored=await readEvidence(item.private_reference);
      invariant(stored?.source_page_sha256===item.source_page_sha256 &&
        stored?.page===item.page && stored?.observation &&
        sha(JSON.stringify(stored.observation))===item.observation_sha256,
        "JOURNAL_READING_FIRST_SOURCE_PERSISTENCE_FAILED");
      items.push({
        page:item.page,evidence_ref:item.private_reference,
        original_page_sha256:item.source_page_sha256,
        source_specific_understanding:stored.observation.source_specific_understanding,
        source_findings:stored.observation.source_findings
      });
    }
    const allowedRefs=new Set(items.map(x=>x.evidence_ref));
    const chunks=batches(items);
    const outputs=[];
    for(const [i,group] of chunks.entries()){
      outputs.push(await synthCall({observations:group,prior_summaries:[],
        scope:"chronological_batch:"+i,allowedRefs:new Set(group.map(v=>v.evidence_ref))}));
    }
    if(outputs.length===1) return outputs[0];

    // Hierarchical cross-period reconciliation. The original references,
    // not a generated node, remain authoritative.
    let level=0,current=outputs.map((o,i)=>({
      batch:i,summary:o.provisional_longitudinal_summary,
      source_evidence_refs:o.source_evidence_refs,
      meaningful_changes:o.meaningful_changes
    }));
    while(current.length>1){
      const groups=batches(current);const next=[];
      for(const [i,group] of groups.entries()){
        const refs=new Set(group.flatMap(v=>v.source_evidence_refs));
        const result=await synthCall({observations:[],prior_summaries:group,
          scope:"chronological_aggregate:"+level+":"+i,allowedRefs:refs});
        next.push({batch:i,summary:result.provisional_longitudinal_summary,
          source_evidence_refs:result.source_evidence_refs,
          meaningful_changes:result.meaningful_changes,
          provider_receipt:result.provider_receipt
        });
      }
      current=next;
      level++;
      invariant(level<=20,"JOURNAL_READING_FIRST_SYNTHESIS_DEPTH_EXCEEDED");
    }
    // Retain the verified final provider receipt and all source citations.
    return {schema_version:"1.0",
      provisional_longitudinal_summary:current[0].summary,
      source_evidence_refs:current[0].source_evidence_refs,
      known_vs_new_reconciled:true,longitudinal_counterexamples_checked:true,
      meaningful_changes:current[0].meaningful_changes,
      provider_receipt:current[0].provider_receipt};
  }
  async function verifySynthesis({provider_receipt,output_sha256}){
    if(provider_receipt?.special_status==="all_pending_verified") return true;
    const workId=provider_receipt?.operation_key;
    const record=synthesisReceipts.get(workId);
    return record?.receipt.receipt_id===provider_receipt?.receipt_id &&
      (await confirm(workId,provider_receipt,record.output_sha256));
  }
  return Object.freeze({reader,verifyCompletion,synthesize,verifySynthesis});
}
