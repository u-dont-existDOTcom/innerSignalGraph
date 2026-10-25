import { journalSchema } from "./contracts.mjs";
import { buildJournalRolePacket, JOURNAL_ROLE_DEFINITIONS, journalRoleInstruction } from "./provider-port.mjs";

// Claude Code clamps the declared tool limit to 500,000 characters. Leave room
// below that boundary for the complete fetch envelope, never a preview.
export const MAX_JOURNAL_TOOL_RESULT_CHARS = 500_000;
export const MAX_HARDEST_PACKET_CHARS = 450_000;

export function journalWorkPacketValue(entry) {
  return { work_id: entry.work_id, status: "ready", role: entry.role, instruction: entry.instruction,
    packet: entry.packet, output_schema: entry.output_schema, expected_generation: entry.expected_generation,
    expires_at: entry.expires_at, submit_with: "submit_journal_work_result" };
}

export function hardestJournalPacketFits(role, packet) {
  // Producers don't yet know the exchange ID/expiry. Use the maximum ID width;
  // the host and tool independently check the exact serialized fetch value.
  return JSON.stringify(journalWorkPacketValue({ work_id: "x".repeat(256), role,
    instruction: journalRoleInstruction(role), packet,
    output_schema: journalSchema(JOURNAL_ROLE_DEFINITIONS[role].outputSchema),
    expected_generation: packet.expected_generation, expires_at: "9999-12-31T23:59:59.999Z"
  })).length <= MAX_HARDEST_PACKET_CHARS;
}

export function hardestJournalRequestFits({ role, units, unit, packetInput }, generation, purpose = "organize_search") {
  const scope = units ?? [unit];
  return hardestJournalPacketFits(role, buildJournalRolePacket(role, {
    protocol_version: "1.0", output_schema_id: JOURNAL_ROLE_DEFINITIONS[role].outputSchema,
    assigned_core_ids: scope.map(item => item.unit_id),
    source_locators: scope.map(item => ({ representation_id: item.representation_id,
      page: item.page_number ?? null, start_byte: item.start_byte, end_byte: item.end_byte })),
    expected_generation: generation, controller_provenance_tag: "x".repeat(256),
    grant_purpose: purpose, ...packetInput
  }));
}
