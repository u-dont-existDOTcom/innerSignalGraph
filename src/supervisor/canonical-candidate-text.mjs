import { ValidationError } from "../core/errors.mjs";

export function assembleCanonicalCandidateText(result) {
  const answer = result?.answer;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new ValidationError("Therapy pipeline did not return candidate response text.");
  }

  const question = typeof result.next_question === "string" ? result.next_question.trim() : "";
  if (!question || answer === question || answer.endsWith(`\n\n${question}`)) return answer;
  return `${answer}\n\n${question}`;
}
