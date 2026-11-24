/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { renderFor } from "../../../../../../../renderer/components/test-utils/renderFor";
import { getDiForUnitTesting } from "../../../../../../../renderer/getDiForUnitTesting";
import machineValuesStateInjectable from "../../../../../../machine-values/renderer/state.injectable";
import { HelmPathToBinary } from "./helm-path-to-binary";

describe("<HelmPathToBinary />", () => {
  it("shows the path main gives for the bundled helm as the placeholder", () => {
    const di = getDiForUnitTesting();
    const values = di.inject(machineValuesStateInjectable).get();

    di.inject(machineValuesStateInjectable).set({ ...values, bundledHelmPath: "/opt/Freelens/resources/x64/helm" });

    const { container } = renderFor(di)(<HelmPathToBinary />);

    expect(container.querySelector("input")?.placeholder).toBe("/opt/Freelens/resources/x64/helm");
  });
});
