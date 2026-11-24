/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { execFile } from "node:child_process";
import { getInjectable } from "@ogre-tools/injectable";
import type { ExecFileException, ExecFileOptions } from "node:child_process";

import type { AsyncResult } from "@freelensapp/utilities";

export type ExecFileError = ExecFileException & { stderr: string };

export interface ExecFileWithInputOptions extends ExecFileOptions {
  /**
   * Written to the standard input of the child, which is then closed. For a
   * secret, which an argument would show in the process list.
   */
  input?: string;
}

export interface ExecFile {
  (filePath: string): AsyncResult<string, ExecFileError>;
  (filePath: string, argsOrOptions: string[] | ExecFileWithInputOptions): AsyncResult<string, ExecFileError>;
  (filePath: string, args: string[], options: ExecFileWithInputOptions): AsyncResult<string, ExecFileError>;
}

const execFileInjectable = getInjectable({
  id: "exec-file",

  instantiate: (): ExecFile => {
    return (
      filePath: string,
      argsOrOptions?: string[] | ExecFileWithInputOptions,
      maybeOptions?: ExecFileWithInputOptions,
    ) => {
      const {
        args,
        options: { input, ...options },
      } = (() => {
        if (Array.isArray(argsOrOptions)) {
          return {
            args: argsOrOptions,
            options: maybeOptions ?? {},
          };
        } else {
          return {
            args: [],
            options: argsOrOptions ?? {},
          };
        }
      })();

      return new Promise((resolve) => {
        try {
          const child = execFile(filePath, args, options, (error, stdout, stderr) => {
            if (error) {
              resolve({
                callWasSuccessful: false,
                error: Object.assign(error, { stderr }),
              });
            } else {
              resolve({
                callWasSuccessful: true,
                response: stdout.toString(),
              });
            }
          });

          if (input !== undefined) {
            // A child that exits without reading its input breaks the pipe;
            // how the child ended is what the callback above reports.
            child.stdin?.on("error", () => {});
            child.stdin?.end(input);
          }
        } catch (error) {
          // On Windows, spawn failures such as `spawn UNKNOWN` (errno -4094)
          // are thrown synchronously instead of being passed to the callback.
          // Convert them into the AsyncResult error shape so callers don't hang.
          resolve({
            callWasSuccessful: false,
            error: Object.assign(error as ExecFileError, {
              stderr: (error as Partial<ExecFileError>).stderr ?? "",
            }),
          });
        }
      });
    };
  },

  causesSideEffects: true,
});

export default execFileInjectable;
