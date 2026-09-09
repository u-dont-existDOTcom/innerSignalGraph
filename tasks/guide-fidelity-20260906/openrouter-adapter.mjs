// Evaluation-only provider, no change to deployed runtime provider defaults.
// Source: https://openrouter.ai/docs/guides/features/structured-outputs
// https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
// Exact IDs and provider routing must be supplied, never guessed from a UI label.
export function validateSettings(settings, env = process.env) {
  const errors=[];
  if (settings?.responder?.effort !== 'xhigh') errors.push('Responder must request xhigh');
  const roles=[settings?.responder,...(settings?.graders ?? [])];
  if (!settings || settings.graders?.length !== 2) errors.push('Exactly two independent grader configurations required');
  for (const role of roles) {
    if (!role?.model || !role?.expected_response_model || !role?.provider) errors.push('Exact model, returned-model identity and provider are required for each role');
    if (!role?.api_key_env || !env[role.api_key_env]) errors.push('A named API credential is unavailable');
    if (!['xhigh','high','medium','low'].includes(role?.effort)) errors.push('Explicit reasoning effort required');
    if (!Number.isInteger(role?.max_tokens) || role.max_tokens < 256 || role.max_tokens > 64000) errors.push('Explicit bounded max_tokens required');
  }
  if (new Set(roles.map(r=>r?.expected_response_model)).size !== 3) errors.push('Responder and the two graders must have distinct returned model identities');
  if (settings?.acknowledge_provider_retention !== true) errors.push('Provider retention must be acknowledged before sending even synthetic cases');
  if (!Number.isInteger(settings?.max_calls) || settings.max_calls < 3 || settings.max_calls > 1500) errors.push('Explicit max_calls in 3..1500 required');
  return [...new Set(errors)];
}
export function publicSettings(settings) {
  const role=r=>({model:r.model,expected_response_model:r.expected_response_model,provider:r.provider,effort:r.effort,max_tokens:r.max_tokens});
  return {responder:role(settings.responder),graders:settings.graders.map(role),max_calls:settings.max_calls,transport:'openrouter-chat-completions',provider_fallbacks:false};
}

export function makeOpenRouterProvider(role, {id='openai', execute, fetchImpl=fetch, env=process.env}) {
  return {
    id, model:role.model,
    async generate({system,user,metadata={},outputSchema}) {
      if (system.length + user.length > 500000) throw new Error("INPUT_BUDGET_EXCEEDED_NO_TRUNCATION");
      const request={model:role.model,messages:[{role:'system',content:system},{role:'user',content:user}],stream:false,
        reasoning:{effort:role.effort,exclude:true},max_tokens:role.max_tokens,
        provider:{only:[role.provider],allow_fallbacks:false,require_parameters:true},
        ...(outputSchema?{response_format:{type:'json_schema',json_schema:{name:'innersignal_eval',strict:true,schema:outputSchema}}}:{})};
      return execute({role:id,model:role.model,expectedModel:role.expected_response_model,stage:metadata.stage ?? 'unknown',request},async()=>{
        // This evaluation-only sink intentionally sends schema-validated synthetic
        // fixtures to one fixed endpoint after explicit retention and budget gates.
        // It cannot select an endpoint or read arbitrary file bytes at this layer.
        const result=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
          method:'POST',headers:{'Authorization':`Bearer ${env[role.api_key_env]}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(900000) // codeql[js/file-access-to-http] synthetic evaluation data intentionally sent to the fixed provider endpoint
        });
        if (!result.ok) throw new Error(`Provider HTTP ${result.status}`); // do not echo credential-bearing error payloads
        const data=await result.json();
        if (data.model !== role.expected_response_model) throw new Error(`Returned model differs from pinned expected identity`);
        const choice=data.choices?.[0];
        if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('Incomplete, refused or truncated provider response');
        return {text:choice.message.content,requestId:data.id,model:data.model,provider:data.provider ?? null,providerRequested:role.provider,usage:data.usage ?? null,reasoningRequested:role.effort,reasoningExecutionVerified:false};
      });
    }
  };
}
