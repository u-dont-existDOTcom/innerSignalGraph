// The pass rule of the journal's cold test (design for clients, point 5c, and "As built, part 2"), in one place: the test scores by it
// (journal-cold-test.mjs), and the journal gate and the page's list ask for its version (clients.mjs, create-server.mjs), so it needs no
// installed package (the app's server starts without any).
//
// It is a method choice of the owner's, who decided it on 24 Nov 2026 (i77 2b: not one wrong answer; the build's own proposal allowed one
// in thirty). A copy passes when:
// - the file holds enough questions of the kinds that show something: `answerable` ones that share a search word with all of their evidence
//   (without one no word search can find it; the others are counted and shown, and not required), and `unanswerable` ones for which the
//   search returns a passage all the same (one that finds nothing is answered "not found" by anything);
// - the judge catches planted wrong answers: the file holds at least `planted` of them, `planted_of_each_kind` of each kind, on questions
//   the journal answers (it is told which it doesn't, so a plant there would test nothing), and at least `caught` of those are judged wrong,
//   and `caught_of_each_kind` of each kind (a judge that sees nothing of one kind could pass by the others). One it refuses isn't caught, nor
//   is it one of those the file needs;
// - no more than `wrong` answers are wrong, which is none, whatever the question;
// - at least `right` of each of those two kinds of questions are right;
// - no more than `left_out` of the questions are left out: searched for longer than a reply waits, or refused by a model;
// - another company's model than the judge's wrote the file, or a person did (the file says who): a key built on a misreading, or errors
//   the judge's own model sees as errors, would be shared;
// - the copy's publication is the same before and after.
// A miss is safe in use (the reply is then made from the conversation alone); a wrong answer isn't. With none allowed, a copy whose answers
// are wrong 1 to 3% of the time fails 47 to 82% of its runs of sixty answers by chance (computed, not measured), and one that is run until
// it passes shows less by its pass: so the report, the receipt and the command say how many tests were started on the copy.
//
// `version` names the rule in the receipt, and a receipt of another version opens nothing: change it with any of these.
export const COLD_TEST_RULE = Object.freeze({
  version: "journal-cold-test-rule-v4",
  answerable: 40, unanswerable: 20, planted: 20, planted_of_each_kind: 3,
  caught: Object.freeze({ at_least: 4, of: 5 }),
  caught_of_each_kind: Object.freeze({ at_least: 1, of: 2 }),
  wrong: 0,
  right: Object.freeze({ at_least: 2, of: 3 }),
  left_out: Object.freeze({ at_most: 1, of: 10 })
});

// What a planted wrong answer gets wrong: a "not" dropped or added, another person, another time, something planned, wished, imagined or
// dreamed told as done (or the other way round), something uncertain told as certain.
export const PLANTED_KINDS = Object.freeze(["negation", "person", "time", "happened", "certainty"]);

// Who wrote the questions, as the file says: a model of one of the two companies whose models answer and judge, or a person.
export const COLD_QUESTION_AUTHORS = Object.freeze(["anthropic", "openai", "person"]);
