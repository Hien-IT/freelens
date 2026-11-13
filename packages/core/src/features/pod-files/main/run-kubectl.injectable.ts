/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { spawn } from "node:child_process";
import { getInjectable } from "@ogre-tools/injectable";

export interface RunKubectlOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Written to the standard input of kubectl, which is then closed. */
  readonly input?: Uint8Array;
  readonly timeoutMs: number;
  /** kubectl is stopped, and the call fails, when its output exceeds this. */
  readonly maxOutputBytes: number;
}

export type RunKubectlResult =
  | { readonly callWasSuccessful: true; readonly response: Buffer }
  | { readonly callWasSuccessful: false; readonly error: string };

export type RunKubectl = (kubectlPath: string, args: string[], options: RunKubectlOptions) => Promise<RunKubectlResult>;

/**
 * Runs kubectl without a shell and keeps its output as bytes, which the
 * string-based `execFile` cannot do for a binary file.
 */
const runKubectlInjectable = getInjectable({
  id: "pod-files-run-kubectl",

  instantiate: (): RunKubectl => (kubectlPath, args, options) =>
    new Promise((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let failure: string | undefined;
      let settled = false;

      const settle = (result: RunKubectlResult) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      };

      let child: ReturnType<typeof spawn>;

      try {
        child = spawn(kubectlPath, args, {
          env: options.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        // On Windows some spawn failures are thrown instead of emitted.
        resolve({ callWasSuccessful: false, error: String(error) });

        return;
      }

      const stop = (reason: string) => {
        failure ??= reason;
        child.kill();
      };

      const timer = setTimeout(
        () => stop(`kubectl timed out after ${options.timeoutMs / 1000} seconds`),
        options.timeoutMs,
      );

      child.stdout?.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;

        if (outputBytes > options.maxOutputBytes) {
          stop(`The output is larger than ${options.maxOutputBytes} bytes`);
        } else {
          stdout.push(chunk);
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => settle({ callWasSuccessful: false, error: error.message }));
      child.on("close", (code) => {
        const errorOutput = Buffer.concat(stderr).toString("utf8").trim();

        if (failure) {
          settle({ callWasSuccessful: false, error: failure });
        } else if (code === 0) {
          settle({ callWasSuccessful: true, response: Buffer.concat(stdout) });
        } else {
          settle({ callWasSuccessful: false, error: errorOutput || `kubectl exited with code ${code}` });
        }
      });

      // A command that exits without reading its input breaks the pipe; how
      // it ended is what the close handler reports.
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.input);
    }),

  causesSideEffects: true,
});

export default runKubectlInjectable;
