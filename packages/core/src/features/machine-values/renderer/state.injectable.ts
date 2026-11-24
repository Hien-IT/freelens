/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

import type { MachineValues } from "../common/channel";

export interface MachineValuesState {
  get(): MachineValues;
  set(values: MachineValues): void;
}

const machineValuesStateInjectable = getInjectable({
  id: "machine-values-state",
  instantiate: (): MachineValuesState => {
    let state: MachineValues | undefined;

    return {
      get: () => {
        if (!state) {
          throw new Error("Tried to read the machine values before main answered with them.");
        }

        return state;
      },
      set: (values) => {
        if (state) {
          throw new Error("Tried to overwrite the machine values.");
        }

        state = values;
      },
    };
  },
});

export default machineValuesStateInjectable;
