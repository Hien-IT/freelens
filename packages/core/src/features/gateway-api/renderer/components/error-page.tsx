/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { withInjectables } from "@ogre-tools/injectable-react";
import styles from "./error-page.module.scss";

import type { Logger } from "@freelensapp/logger";
import type { StrictReactNode } from "@freelensapp/utilities";

import type React from "react";

export interface ErrorPageProps {
  error?: unknown;
  children?: StrictReactNode;
}

interface Dependencies {
  logger: Logger;
}

const NonInjectedErrorPage = ({ error, children, logger }: ErrorPageProps & Dependencies) => {
  if (error) {
    logger.error(`[GATEWAY-API]: ${error}`);
  }

  return (
    <div className={styles.errorPage}>
      {error ? <p className={styles.errorMessage}>{String(error)}</p> : null}
      {children}
    </div>
  );
};

export const ErrorPage = withInjectables<Dependencies, ErrorPageProps>(NonInjectedErrorPage, {
  getProps: (di, props) => ({
    ...props,
    logger: di.inject(loggerInjectionToken),
  }),
});

/**
 * Renders `wrapped` with `props`, or an `ErrorPage` with the error when it throws.
 *
 * ```ts
 * export const Component = (props: ComponentProps) => withErrorPage(props, () => {
 *   throw new Error("something died");
 * })
 * ```
 */
export function withErrorPage<P>(props: P, wrapped: (props: P) => React.JSX.Element) {
  try {
    return wrapped(props);
  } catch (error) {
    return <ErrorPage error={error} />;
  }
}
