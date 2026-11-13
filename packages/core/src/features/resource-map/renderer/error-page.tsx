/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import styles from "./error-page.module.scss";

import type React from "react";

export interface ErrorPageProps {
  error?: unknown;
  children?: React.ReactNode;
}

/**
 * The error, in place of a page or a details panel that threw it. `ErrorBoundary` renders it and logs the error.
 */
export function ErrorPage({ error, children }: ErrorPageProps) {
  return (
    <div className={styles.errorPage}>
      {error ? <p className={styles.errorMessage}>{String(error)}</p> : null}
      {children}
    </div>
  );
}
