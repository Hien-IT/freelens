/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannel } from "@freelensapp/messaging";
import * as proto from "../../../common/protocol-handler";
import { foldAttemptResults, ProtocolHandlerInvalid, RouteAttempt } from "../../../common/protocol-handler";

import type { EnlistMessageChannelListener } from "@freelensapp/messaging";
import type { ShowNotification } from "@freelensapp/notifications";

import type { LensProtocolRouterDependencies } from "../../../common/protocol-handler";

interface Dependencies extends LensProtocolRouterDependencies {
  showShortInfoNotification: ShowNotification;
  showErrorNotification: ShowNotification;
  enlistMessageChannelListener: EnlistMessageChannelListener;
}

// Typed channels of the legacy names; each message is the list of the legacy
// arguments (specs/002-messaging-for-tauri, data-model.md, Channel).
const internalChannel = getMessageChannel<[rawUrl: string, mainAttemptResult: RouteAttempt]>(
  proto.ProtocolHandlerInternal,
);
const extensionChannel = getMessageChannel<[rawUrl: string, mainAttemptResult: RouteAttempt]>(
  proto.ProtocolHandlerExtension,
);
const invalidChannel = getMessageChannel<[error: string, rawUrl: string]>(ProtocolHandlerInvalid);

export class LensProtocolRouterRenderer extends proto.LensProtocolRouter {
  protected readonly processName = "renderer";

  constructor(protected readonly dependencies: Dependencies) {
    super(dependencies);
  }

  /**
   * This function is needed to be called early on in the renderers lifetime.
   */
  public init(): void {
    const listen = this.dependencies.enlistMessageChannelListener;

    listen({
      id: "protocol-handler-internal",
      channel: internalChannel,
      handler: ([rawUrl, mainAttemptResult]) => {
        const rendererAttempt = this._routeToInternal(new URL(rawUrl));

        if (foldAttemptResults(mainAttemptResult, rendererAttempt) === RouteAttempt.MISSING) {
          this.dependencies.showShortInfoNotification(
            <p>
              {"Unknown action "}
              <code>{rawUrl}</code>
              {". Are you on the latest version?"}
            </p>,
          );
        }
      },
    });
    listen({
      id: "protocol-handler-extension",
      channel: extensionChannel,
      handler: async ([rawUrl, mainAttemptResult]) => {
        const rendererAttempt = await this._routeToExtension(new URL(rawUrl));

        switch (foldAttemptResults(mainAttemptResult, rendererAttempt)) {
          case RouteAttempt.MISSING:
            this.dependencies.showShortInfoNotification(
              <p>
                {"Unknown action "}
                <code>{rawUrl}</code>
                {". Are you on the latest version of the extension?"}
              </p>,
            );
            break;
          case RouteAttempt.MISSING_EXTENSION:
            this.dependencies.showShortInfoNotification(
              <p>
                {"Missing extension for action "}
                <code>{rawUrl}</code>
                {". Not able to find extension in our known list. Try installing it manually."}
              </p>,
            );
            break;
        }
      },
    });
    listen({
      id: "protocol-handler-invalid",
      channel: invalidChannel,
      handler: ([error, rawUrl]) => {
        this.dependencies.showErrorNotification(
          <>
            <p>
              {"Failed to route "}
              <code>{rawUrl}</code>.
            </p>
            <p>
              <b>Error:</b> {error}
            </p>
          </>,
        );
      },
    });
  }
}
