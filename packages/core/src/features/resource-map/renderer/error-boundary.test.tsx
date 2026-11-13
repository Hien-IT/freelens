/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./error-boundary";
import { fakeLogger } from "./test-utils/fake-logger";

let logger: ReturnType<typeof fakeLogger>;

beforeEach(() => {
  logger = fakeLogger();
  // React reports an error that a boundary caught on the console as well.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Throws = ({ message = "boom" }: { message?: string }): React.JSX.Element => {
  throw new Error(message);
};

// A child that throws only for some objects, as a details panel does for an object without a field it reads.
const ThrowsFor = ({ object }: { object: { broken: boolean } }) => {
  if (object.broken) throw new Error("broken object");
  return <p>fine object</p>;
};

describe("ErrorBoundary", () => {
  it("renders the error page in place of a child that throws, logs it, and leaves its siblings rendered", () => {
    render(
      <>
        <p>before</p>
        <ErrorBoundary logger={logger}>
          <p>inside</p>
          <Throws />
        </ErrorBoundary>
        <p>after</p>
      </>,
    );

    expect(screen.getByText("Error: boom")).toBeDefined();
    expect(screen.queryByText("inside")).toBeNull();
    expect(screen.getByText("before")).toBeDefined();
    expect(screen.getByText("after")).toBeDefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("[RESOURCE-MAP]: Error: boom", expect.any(String));
  });

  it("renders its children without an error", () => {
    render(
      <ErrorBoundary logger={logger}>
        <p>inside</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("inside")).toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("renders the children again for a new reset key", () => {
    const broken = { broken: true };
    const fixed = { broken: false };
    const { rerender } = render(
      <ErrorBoundary logger={logger} resetKey={broken}>
        <ThrowsFor object={broken} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Error: broken object")).toBeDefined();

    rerender(
      <ErrorBoundary logger={logger} resetKey={fixed}>
        <ThrowsFor object={fixed} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("fine object")).toBeDefined();
    expect(screen.queryByText("Error: broken object")).toBeNull();
  });
});
