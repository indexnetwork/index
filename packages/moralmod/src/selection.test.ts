import { describe, expect, test } from "bun:test";

import { AssessmentError, POLICY_TEMPLATES, statistic, templateFor } from "./selection.ts";

describe("statistic", () => {
  test("mean", () => expect(statistic([1, 2, 3, 6], "mean")).toBe(3));
  test("median of odd length is the middle sample", () => expect(statistic([5, 1, 3], "median")).toBe(3));
  test("median of even length is the mean of the middle two", () => expect(statistic([1, 2, 3, 10], "median")).toBe(2.5));
  test("lower decile is the nearest-rank sample", () => {
    expect(statistic([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], "lower_decile")).toBe(1);
    expect(statistic([1, 2], "lower_decile")).toBe(1);
  });
  test("fewer than two samples is invalid", () => {
    expect(() => statistic([1], "mean")).toThrow(AssessmentError);
  });
  test("a non-finite sample is invalid", () => {
    expect(() => statistic([1, Number.NaN], "mean")).toThrow(AssessmentError);
  });
});

describe("templateFor", () => {
  test("resolves the default study template", () => {
    expect(templateFor("aggregate-value-mean-hold-v1").objective).toBe("aggregate_moral_value");
  });
  test("an unknown template id is refused", () => {
    expect(() => templateFor("made-up-v9")).toThrow(AssessmentError);
  });
  test("the five v1 templates are present", () => {
    expect(POLICY_TEMPLATES.map((template) => template.id)).toEqual([
      "joint-welfare-mean-hold-v1",
      "joint-welfare-median-hold-v1",
      "joint-welfare-lower-decile-hold-v1",
      "principal-utility-mean-hold-v1",
      "aggregate-value-mean-hold-v1",
    ]);
  });
});
