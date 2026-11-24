// Stand-in workers for the journal's cold test (src/runner-trial/journal-cold-test.mjs), given where the trial's signed-in ones go and called
// through the real port: no model is called. Like the sealed workers, one makes its preparation, asks `beforeSend`, and only then sends the
// packet. Everything that leaves is kept in `sent`, in order, with the role whose worker sent it.
//
// The consumer's stand-in sees only its packet: it says "supported" and cites every passage it was given, or "not_found" when it was given
// none, except for the questions `script` answers otherwise, by their words (a model judges a false premise itself); `words` gives the answer
// to a question, by its words. The judge's says "right", or what `verdict` returns for a packet. `prepare(count, request)` is the
// preparation and `reply(count, request, usual)` the answer, where `count` numbers the calls of both and `usual()` gives the stand-in's own.

export const JUDGE_REASON = "A synthetic reason that stays with the judge.";
export const ANSWER = "A synthetic answer.";
export const RECEIPTS = Object.freeze({ W: Object.freeze({ provider: "stand-in-w", model: "consumer 1.5" }), CW: Object.freeze({ provider: "stand-in-c", model: "judge-2" }) });

export function coldWorkers({ script = {}, words = {}, verdict = () => "right", prepare = null, reply = null } = {}) {
  const sent = [];
  let count = 0;
  const consumer = ({ question_id, question, passages }) => {
    const answerability = script[question] ?? (passages.length ? "supported" : "not_found");
    return { question_id, answerability, answer: words[question] ?? ANSWER, evidence_ids: answerability === "not_found" ? [] : passages.map(({ id }) => id) };
  };
  const judge = (packet) => ({ question_id: packet.question_id, verdict: verdict(packet, sent), reason: JUDGE_REASON });
  return {
    sent,
    // What left for one role, as packets.
    packets: (role) => sent.filter((entry) => entry.role === role).map(({ packet }) => packet),
    workerFor: (role) => ({
      async call(request) {
        const index = count += 1;
        if (prepare) await prepare(index, request);
        if (request.beforeSend) await request.beforeSend();
        const packet = JSON.parse(request.user);
        sent.push({ role, request, packet });
        const usual = async () => (role === "W" ? consumer : judge)(packet);
        return { value: reply ? await reply(index, request, usual) : await usual(), receipt: { ...RECEIPTS[role], session_id: `synthetic-${index}` } };
      }
    })
  };
}

export const questionsFile = (questions) => ({ schema_version: 1, kind: "journal_cold_questions", questions });
