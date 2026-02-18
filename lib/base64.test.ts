import { expect, test } from "bun:test";
import { stripDataUrlPrefix } from "./base64";

test("stripDataUrlPrefix removes data URL prefix", () => {
  const input = "data:image/png;base64,iVBORw0KGgo=";
  expect(stripDataUrlPrefix(input)).toBe("iVBORw0KGgo=");
});

test("stripDataUrlPrefix handles jpeg prefix", () => {
  const input = "data:image/jpeg;base64,/9j/4AAQ=";
  expect(stripDataUrlPrefix(input)).toBe("/9j/4AAQ=");
});

test("stripDataUrlPrefix returns raw base64 unchanged", () => {
  const input = "abc123";
  expect(stripDataUrlPrefix(input)).toBe("abc123");
});

test("intentional failure - remove before merging", () => {
  expect(true).toBe(false);
});
