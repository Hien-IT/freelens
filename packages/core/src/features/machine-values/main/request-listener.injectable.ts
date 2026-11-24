/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import homeDirectoryPathInjectable from "../../../common/os/home-directory-path.injectable";
import kubeDirectoryPathInjectable from "../../../common/os/kube-directory-path.injectable";
import bundledBinaryPathInjectable from "../../../common/utils/main/bundled-binary-path.injectable";
import isDebuggingInjectable from "../../../common/vars/is-debugging.injectable";
import isFlatpakPackageInjectable from "../../../common/vars/is-flatpak-package.injectable";
import isSnapPackageInjectable from "../../../common/vars/is-snap-package.injectable";
import platformInjectable from "../../../common/vars/platform.injectable";
import { machineValuesChannel } from "../common/channel";

/** Answers from main's own injectables, so the renderer gets what main uses. */
const machineValuesRequestListenerInjectable = getRequestChannelListenerInjectable({
  id: "machine-values-request-listener",
  channel: machineValuesChannel,
  getHandler: (di) => () => ({
    platform: di.inject(platformInjectable),
    isDebugging: di.inject(isDebuggingInjectable),
    isSnap: di.inject(isSnapPackageInjectable),
    isFlatpak: di.inject(isFlatpakPackageInjectable),
    homeDirectory: di.inject(homeDirectoryPathInjectable),
    kubeDirectory: di.inject(kubeDirectoryPathInjectable),
    bundledHelmPath: di.inject(bundledBinaryPathInjectable, "helm"),
  }),
});

export default machineValuesRequestListenerInjectable;
