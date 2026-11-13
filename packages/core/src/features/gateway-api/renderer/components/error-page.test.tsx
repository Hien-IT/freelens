/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderFor } from "../../../../renderer/components/test-utils/renderFor";
import { getDiForUnitTesting } from "../../../../renderer/getDiForUnitTesting";
import { ErrorPage, withErrorPage } from "./error-page";

import type { Logger } from "@freelensapp/logger";

import type { DiRender } from "../../../../renderer/components/test-utils/renderFor";

describe("ErrorPage", () => {
  let render: DiRender;
  let logger: Logger;

  beforeEach(() => {
    const di = getDiForUnitTesting();

    logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), silly: vi.fn(), warn: vi.fn() };
    di.override(loggerInjectionToken, () => logger);
    render = renderFor(di);
  });

  it("renders the error message and logs the error", () => {
    const { getByText } = render(<ErrorPage error={new Error("boom")} />);

    expect(getByText("Error: boom")).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith("[GATEWAY-API]: Error: boom");
  });

  it("renders children and does not log when there is no error", () => {
    const { getByText } = render(
      <ErrorPage>
        <span>child content</span>
      </ErrorPage>,
    );

    expect(getByText("child content")).toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  describe("withErrorPage", () => {
    it("renders the wrapped component when it does not throw", () => {
      const { getByText } = render(withErrorPage({}, () => <span>all good</span>));

      expect(getByText("all good")).toBeDefined();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("renders an ErrorPage when the wrapped component throws", () => {
      const { getByText } = render(
        withErrorPage({}, () => {
          throw new Error("kaboom");
        }),
      );

      expect(getByText("Error: kaboom")).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith("[GATEWAY-API]: Error: kaboom");
    });
  });
});
