/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import nodeAssert from "node:assert";
import { describe, expect, it } from "vitest";
import { assert } from "./assert";

const thrownBy = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    return error as Error & { code?: string };
  }

  throw new Error("expected a throw");
};

describe("assert", () => {
  it.each([true, 1, "a", {}, []])("does not throw for the truthy value %j", (value) => {
    expect(() => assert(value)).not.toThrow();
  });

  it.each([false, 0, "", null, undefined])("throws for the falsy value %j", (value) => {
    expect(() => assert(value, "some message")).toThrow("some message");
  });

  it("throws an error with the name and code of node:assert's", () => {
    const ours = thrownBy(() => assert(false, "some message"));
    const nodes = thrownBy(() => nodeAssert(false, "some message"));

    expect(ours).toBeInstanceOf(Error);
    expect(ours.name).toBe(nodes.name);
    expect(ours.code).toBe(nodes.code);
    expect(ours.message).toBe(nodes.message);
    expect(String(ours)).toBe("AssertionError: some message");
  });

  it("has a message without one given", () => {
    expect(thrownBy(() => assert(undefined)).message).toBe("The expression evaluated to a falsy value");
  });

  it("narrows the type", () => {
    const value: string | undefined = "a" as string | undefined;

    assert(value);

    const narrowed: string = value;

    expect(narrowed).toBe("a");
  });
});
