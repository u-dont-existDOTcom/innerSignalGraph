const clone = value => structuredClone(value);

function supplementBlock(title, rules, coverage) {
  const scope = coverage?.length ? coverage.join(', ') : 'NONE';
  return `\n\n${title}\n${rules.map(rule => `- ${rule}`).join('\n')}\nStage coverage: ${scope}.\nTreat these as generic failure definitions, not proof that a failure is present. Do not infer hidden seeded truth or case-specific answer keys.`;
}

export function applyLongitudinalAuditSupplement(architectures, supplement) {
  if (!architectures || architectures.status !== 'PROMPT_CONTRACTS_ONLY_NO_PROVIDER_EXECUTION') {
    throw new Error('Unexpected base audit architecture contract.');
  }
  if (!supplement || supplement.status !== 'OWNER_AUTHORIZED_AUDIT_SUPPLEMENT') {
    throw new Error('Missing owner-authorized longitudinal audit supplement.');
  }
  if (!Array.isArray(supplement.sharedRules) || supplement.sharedRules.length < 1) {
    throw new Error('Longitudinal audit supplement needs shared rules.');
  }

  const effective = clone(architectures);
  effective.sharedRules = [...new Set([...effective.sharedRules, ...supplement.sharedRules])];
  effective.longitudinalSupplement = {
    schemaVersion: supplement.schemaVersion,
    newErrorIds: clone(supplement.newErrorIds),
    source: 'LONGITUDINAL-AUDIT-SUPPLEMENT.json'
  };

  const seen = new Set();
  for (const architecture of effective.architectures) {
    for (const stage of architecture.stages) {
      const coverage = supplement.stageCoverage[stage.id];
      if (!coverage) continue;
      seen.add(stage.id);
      const block = supplementBlock('LONGITUDINAL AUDIT SUPPLEMENT', supplement.sharedRules, coverage);
      if (typeof stage.prompt === 'string') stage.prompt += block;
      if (stage.promptByRepairMode) {
        for (const mode of Object.keys(stage.promptByRepairMode)) stage.promptByRepairMode[mode] += block;
      }
    }
  }

  const missing = Object.keys(supplement.stageCoverage).filter(stageId => !seen.has(stageId));
  if (missing.length) throw new Error(`Longitudinal supplement refers to unknown audit stages: ${missing.join(', ')}`);
  return effective;
}

export function applyThreatPathwayAuditSupplement(architectures, supplement) {
  if (!architectures || architectures.status !== 'PROMPT_CONTRACTS_ONLY_NO_PROVIDER_EXECUTION') {
    throw new Error('Unexpected base audit architecture contract.');
  }
  if (!supplement || supplement.status !== 'OWNER_AUTHORIZED_THREAT_PATHWAY_AUDIT_SUPPLEMENT') {
    throw new Error('Missing owner-authorized threat-pathway audit supplement.');
  }
  if (!Array.isArray(supplement.sharedRules) || supplement.sharedRules.length < 1) {
    throw new Error('Threat-pathway audit supplement needs shared rules.');
  }

  const effective = clone(architectures);
  effective.sharedRules = [...new Set([...effective.sharedRules, ...supplement.sharedRules])];
  effective.threatPathwaySupplement = {
    schemaVersion: supplement.schemaVersion,
    newErrorIds: clone(supplement.newErrorIds),
    calibration: clone(supplement.calibration),
    source: 'THREAT-PATHWAY-AUDIT-SUPPLEMENT.json'
  };

  const seen = new Set();
  for (const architecture of effective.architectures) {
    for (const stage of architecture.stages) {
      const coverage = supplement.stageCoverage[stage.id];
      if (!coverage) continue;
      seen.add(stage.id);
      const block = supplementBlock('THREAT-PATHWAY AUDIT SUPPLEMENT', supplement.sharedRules, coverage);
      if (typeof stage.prompt === 'string') stage.prompt += block;
      if (stage.promptByRepairMode) {
        for (const mode of Object.keys(stage.promptByRepairMode)) stage.promptByRepairMode[mode] += block;
      }
    }
  }

  const missing = Object.keys(supplement.stageCoverage).filter(stageId => !seen.has(stageId));
  if (missing.length) throw new Error(`Threat-pathway supplement refers to unknown audit stages: ${missing.join(', ')}`);
  return effective;
}

export function applyAuditSupplements(architectures, { longitudinal, threatPathway }) {
  return applyThreatPathwayAuditSupplement(
    applyLongitudinalAuditSupplement(architectures, longitudinal),
    threatPathway
  );
}
