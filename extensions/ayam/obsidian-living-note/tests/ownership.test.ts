import assert from "node:assert/strict";
import test from "node:test";
import { applyApprovedChanges, assertNoUnownedChange, parseOwnership, replaceOwnedRegions } from "../src/ownership";

test("parses explicit non-overlapping ownership boundaries", () => {
  const note = "human\n<!-- superdocs:owned:start id=\"summary\" -->\nauto\n<!-- superdocs:owned:end id=\"summary\" -->\nmore human";
  const result = parseOwnership(note);
  assert.deepEqual(result.errors, []);
  assert.equal(result.regions[0].id, "summary");
});

test("rejects missing, duplicate, and overlapping boundaries", () => {
  assert.match(parseOwnership("<!-- superdocs:owned:start id=\"a\" -->").errors.join(" "), /missing its end/);
  assert.match(parseOwnership("<!-- superdocs:owned:end id=\"a\" -->").errors.join(" "), /without a start/);
  assert.match(parseOwnership([
    '<!-- superdocs:owned:start id="a" -->',
    '<!-- superdocs:owned:start id="b" -->',
    '<!-- superdocs:owned:end id="a" -->',
    '<!-- superdocs:owned:end id="b" -->',
  ].join("\n")).errors.join(" "), /nested|overlap/);
});

test("replaces only owned content and preserves human bytes", () => {
  const original = [
    "# My note",
    "Human paragraph: do not rewrite this.",
    '<!-- superdocs:owned:start id="summary" -->',
    "old generated summary",
    '<!-- superdocs:owned:end id="summary" -->',
    "Human paragraph with two spaces  and a hard line break.  ",
  ].join("\n");
  const updated = original.replace("old generated summary", "new generated summary");
  assert.equal(replaceOwnedRegions(original, updated), updated);
  assert.doesNotThrow(() => assertNoUnownedChange(original, updated));
});

test("refuses a response that omits an owned region", () => {
  const original = '<!-- superdocs:owned:start id="a" -->\na\n<!-- superdocs:owned:end id="a" -->';
  const updated = "# response without the boundary";
  assert.throws(() => replaceOwnedRegions(original, updated), /omitted|no owned regions/);
});

test("applies approved HTML fragments when SuperDocs strips marker comments", () => {
  const original = [
    "# My note",
    "Human paragraph: do not rewrite this.",
    '<!-- superdocs:owned:start id="summary" -->',
    "## SuperDocs-owned: summary",
    "old generated summary",
    '<!-- superdocs:owned:end id="summary" -->',
    "Another human paragraph.",
  ].join("\n");
  const updated = applyApprovedChanges(original, [{
    change_id: "change-1",
    operation: "edit",
    old_html: '<p data-chunk-id="x">old generated summary</p>',
    new_html: '<p data-chunk-id="x">new generated summary</p>',
    ai_explanation: "updated source-backed summary",
  }]);
  assert.match(updated, /new generated summary/);
  assert.match(updated, /Human paragraph: do not rewrite this\./);
  assert.match(updated, /Another human paragraph\./);
  assert.match(updated, /superdocs:owned:start/);
});

test("refuses a response that changes unowned bytes", () => {
  const original = 'human\n<!-- superdocs:owned:start id="a" -->\na\n<!-- superdocs:owned:end id="a" -->';
  const updated = 'rewritten human\n<!-- superdocs:owned:start id="a" -->\na\n<!-- superdocs:owned:end id="a" -->';
  assert.throws(() => assertNoUnownedChange(original, updated), /outside owned/);
});
