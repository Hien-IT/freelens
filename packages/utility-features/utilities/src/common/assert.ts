/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/**
 * Throws when `value` is falsy, and narrows its type otherwise.
 *
 * A replacement for `assert` of `node:assert` that runs without Node. The error
 * keeps the `name` and `code` of Node's `AssertionError`, so that code checking
 * either sees what `node:assert` threw.
 *
 * @param value The condition that must hold
 * @param message The error message when it does not
 */
export function assert(value: unknown, message?: string): asserts value {
  if (!value) {
    throw Object.assign(new Error(message ?? "The expression evaluated to a falsy value"), {
      name: "AssertionError",
      code: "ERR_ASSERTION",
    });
  }
}
