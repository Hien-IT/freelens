/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { BrowserWindow, Menu, webContents, webFrameMain } from "electron";
import applicationMenuItemCompositeInjectable from "../../features/application-menu/main/application-menu-item-composite.injectable";
import { getApplicationMenuTemplate } from "../../features/application-menu/main/populate-application-menu.injectable";

/** Pops the application menu up at the top bar's menu icon of the window of a frame. */
export type PopupApplicationMenu = (sender?: { processId: number; frameId: number }) => void;

const popupApplicationMenuInjectable = getInjectable({
  id: "popup-application-menu",

  instantiate: (di): PopupApplicationMenu => {
    const applicationMenuItemComposite = di.inject(applicationMenuItemCompositeInjectable);

    return (sender) => {
      const frame = sender && webFrameMain.fromId(sender.processId, sender.frameId);
      const contents = frame && webContents.fromFrame(frame);
      const menu = Menu.buildFromTemplate(getApplicationMenuTemplate(applicationMenuItemComposite.get()));

      menu.popup({
        ...(contents ? BrowserWindow.fromWebContents(contents) : undefined),
        // Center of the topbar menu icon
        x: 20,
        y: 20,
      });
    };
  },

  causesSideEffects: true,
});

export default popupApplicationMenuInjectable;
