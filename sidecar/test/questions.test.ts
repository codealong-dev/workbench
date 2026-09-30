import { test } from "node:test";
import assert from "node:assert/strict";
import { toQuestions, withAnswers } from "../src/questions.ts";

const input = {
  questions: [
    {
      question: "Which repeat is it?",
      header: "Repeat type",
      multiSelect: false,
      options: [
        { label: "Stacked rows", description: "many Thought rows" },
        { label: "Word cycling", description: "the indicator" },
      ],
    },
    { question: "Which areas?", header: "Areas", multiSelect: true, options: [{ label: "UI", description: "" }, { label: "API", description: "" }] },
  ],
};

test("normalizes Claude's questions, keyed by question text", () => {
  const qs = toQuestions(input);
  assert.equal(qs.length, 2);
  assert.deepEqual(qs[0], {
    id: "Which repeat is it?",
    header: "Repeat type",
    question: "Which repeat is it?",
    options: [
      { label: "Stacked rows", description: "many Thought rows" },
      { label: "Word cycling", description: "the indicator" },
    ],
    multiSelect: false,
    allowOther: true,
    secret: false,
  });
  assert.equal(qs[1].multiSelect, true);
  assert.deepEqual(toQuestions({}), []);
});

test("answers go back as the SDK reads them: one string per question", () => {
  const out = withAnswers(input, { "Which repeat is it?": ["Stacked rows"], "Which areas?": ["UI", " API "], "Unanswered?": [] });
  assert.deepEqual(out.answers, { "Which repeat is it?": "Stacked rows", "Which areas?": "UI, API" });
  assert.equal(out.questions, input.questions);
});
