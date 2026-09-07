import { ValidationError } from "../core/errors.mjs";

// Shared by the path and delivery contracts. This deliberately covers only their
// repository-owned bounded schema subset; it never executes user-supplied schemas.
// Keep runtime startup independent of development-only validation dependencies.
export function checkBoundedSchema(value, schema, name = "contract") {
  const fail = () => { throw new ValidationError(`${name} does not satisfy its bounded schema.`); };
  if (schema.anyOf) {
    for (const branch of schema.anyOf) {
      try { checkBoundedSchema(value, branch, name); return; }
      catch (error) { if (!(error instanceof ValidationError)) throw error; }
    }
    return fail();
  }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!(Array.isArray(schema.type) ? schema.type : [schema.type]).includes(type)) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (type === "object") {
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) fail();
    if ((schema.required ?? []).some(key => !Object.hasOwn(value, key))) fail();
    for (const key of Object.keys(value)) if (Object.hasOwn(schema.properties, key)) checkBoundedSchema(value[key], schema.properties[key], `${name}.${key}`);
  } else if (type === "array") {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail();
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail();
    value.forEach(item => checkBoundedSchema(item, schema.items, name));
  } else if (type === "string") {
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity) || (schema.minLength > 0 && !value.trim())) fail();
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail();
  } else if (type === "number") {
    if (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail();
  }
}
