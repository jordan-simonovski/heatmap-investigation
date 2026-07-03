import { test } from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "../src/scenarios.ts";

test("all 8 scenarios present and well-formed", () => {
  assert.equal(scenarios.length, 8);
  for (const s of scenarios) {
    assert.ok(s.id, "id");
    assert.ok(s.symptomPrompt.length > 10, `${s.id} symptomPrompt`);
    assert.ok(s.groundTruthRca.length > 10, `${s.id} groundTruthRca`);
    assert.ok(s.culpritService, `${s.id} culpritService`);
    assert.ok(s.rubric.length > 10, `${s.id} rubric`);
    // Symptom prompt must not name the discriminating values (no giveaway).
    for (const a of s.discriminatingAttributes) {
      assert.ok(
        !s.symptomPrompt.toLowerCase().includes(a.value.toLowerCase()),
        `${s.id} symptom leaks ${a.value}`,
      );
    }
  }
});

test("S6 is the tie, others have discriminators", () => {
  const s6 = scenarios.find((s) => s.id === "S6")!;
  assert.equal(s6.tie, true);
  for (const s of scenarios.filter((s) => s.id !== "S6")) {
    assert.ok(s.discriminatingAttributes.length > 0, `${s.id} needs discriminators`);
  }
});
