/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { logPrefix } from "./dependencies";
import { ErrorPage } from "./error-page";

import type { Logger } from "@freelensapp/logger";

export interface ErrorBoundaryProps {
  logger: Logger;
  /**
   * A new value clears the error and renders the children again: the object of a details panel, which the details
   * drawer replaces with a new one when the object changes.
   */
  resetKey?: unknown;
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  error?: unknown;
  resetKey?: unknown;
}

/**
 * Keeps an error that its children throw while React renders them inside the boundary: it logs the error with the
 * component stack, and renders the error page in place of the children.
 *
 * The details drawer and the Workloads Overview have no boundary around each of their items, and the boundary around
 * the cluster frame would replace the whole cluster view, so an error of a map, such as one of the canvas, would take
 * down the views around it. Each entry component of the maps renders its map inside one.
 *
 * It is a class component, because only a class component can be an error boundary, with no decorators and no
 * `observer`: it reads no observable, and the children it renders are observers of their own.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { failed: true, error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): ErrorBoundaryState | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    this.props.logger.error(`${logPrefix}: ${error}`, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <ErrorPage error={this.state.error} />;
  }
}
