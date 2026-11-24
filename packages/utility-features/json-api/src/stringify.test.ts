/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { stringify as nodeStringify } from "node:querystring";
import { describe, expect, it } from "vitest";
import { stringify, stringifyQuery } from "./json-api";

import type { QueryParams } from "./json-api";

const cases: Record<string, QueryParams> = {
  "plain values": { a: "b", n: 1, t: true, f: false },
  spaces: { "a key": "a value" },
  "characters querystring leaves unescaped": { mark: "!~*'()-_." },
  "reserved characters": { q: "a&b=c?d/e#f+g%h", "k&=": "v" },
  unicode: { name: "héllo wörld ✓ 日本" },
  "an array": { labelSelector: ["app=a", "tier in (x,y)"] },
  "an empty array": { a: [], b: "c" },
  "non-finite numbers": { nan: Number.NaN, inf: Number.POSITIVE_INFINITY, neg: Number.NEGATIVE_INFINITY },
  "an empty string": { empty: "" },
  "null and undefined": { n: null, u: undefined, x: "y" },
  "no keys": {},
};

describe("stringify", () => {
  it.each(Object.entries(cases))("writes %s as node:querystring does", (_name, query) => {
    expect(stringify(query)).toBe(nodeStringify(query as Parameters<typeof nodeStringify>[0]));
  });
});

describe("stringifyQuery", () => {
  it("leaves out undefined and null, and writes the rest as node:querystring does", () => {
    expect(stringifyQuery({ watch: true, previous: undefined, limit: null, labelSelector: ["a=b"] })).toBe(
      "watch=true&labelSelector=a%3Db",
    );
  });
});
