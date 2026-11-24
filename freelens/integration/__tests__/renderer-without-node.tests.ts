/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describeIf } from "@freelensapp/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kindReady } from "../helpers/kind";
import * as utils from "../helpers/utils";

import type { Page } from "playwright";

const TEST_KIND_CLUSTER_NAME = process.env.TEST_KIND_CLUSTER_NAME || "kind";
const TEST_NAMESPACE = process.env.TEST_NAMESPACE || "integration-tests";

// What a view has of Node and of the bridge to main. A string, so that it is
// evaluated in the view as written, whatever the test's own build does to code.
const nodeInView = `({
  require: typeof require,
  process: typeof process,
  Buffer: typeof Buffer,
  bridge: Object.keys(globalThis.freelensViewBridge ?? {}).sort(),
})`;

const withoutNode = {
  require: "undefined",
  process: "undefined",
  Buffer: "undefined",
  bridge: ["getPathForFile", "ipcRenderer"],
};

describe("the renderer without Node", () => {
  let window: Page;
  let cleanup: undefined | (() => Promise<void>);

  beforeEach(
    async () => {
      ({ window, cleanup } = await utils.start());
    },
    10 * 60 * 1000,
  );

  afterEach(
    async () => {
      await cleanup?.();
    },
    10 * 60 * 1000,
  );

  it("gives the window no Node, and only the bridge to main", async () => {
    expect(await window.evaluate(nodeInView)).toEqual(withoutNode);
  });

  describeIf(kindReady(TEST_KIND_CLUSTER_NAME, TEST_NAMESPACE))("with a kind cluster", () => {
    it(
      "gives a cluster frame no Node, and only the bridge to main",
      async () => {
        await utils.clickWelcomeButton(window);

        const frame = await utils.launchKindClusterFromCatalog(TEST_KIND_CLUSTER_NAME, window);

        expect(await frame.evaluate(nodeInView)).toEqual(withoutNode);
      },
      10 * 60 * 1000,
    );
  });
});
