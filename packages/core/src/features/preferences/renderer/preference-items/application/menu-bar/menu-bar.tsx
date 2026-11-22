/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import { setTrayVisibleChannel } from "../../../../../../common/ipc/tray";
import { SubTitle } from "../../../../../../renderer/components/layout/sub-title";
import { Switch } from "../../../../../../renderer/components/switch";
import userPreferencesStateInjectable from "../../../../../user-preferences/common/state.injectable";

import type { SendMessageToChannel } from "@freelensapp/messaging";

import type { UserPreferencesState } from "../../../../../user-preferences/common/state.injectable";

interface Dependencies {
  state: UserPreferencesState;
  sendMessageToChannel: SendMessageToChannel;
}

const NonInjectedMenuBarSettings = observer(({ state, sendMessageToChannel }: Dependencies) => (
  <section id="menu">
    <SubTitle title="Menu-bar Settings" />
    <Switch
      checked={state.showTrayIcon}
      onChange={() => {
        state.showTrayIcon = !state.showTrayIcon;
        sendMessageToChannel(setTrayVisibleChannel, state.showTrayIcon);
      }}
    >
      Show tray icon in the menu bar
    </Switch>
  </section>
));

export const MenuBar = withInjectables<Dependencies>(NonInjectedMenuBarSettings, {
  getProps: (di) => ({
    state: di.inject(userPreferencesStateInjectable),
    sendMessageToChannel: di.inject(sendMessageToChannelInjectionToken),
  }),
});
