/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The code below is ported from lib/path.js of Node.js v24.22.1, under this notice:
//
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/**
 * `normalize`, `isAbsolute`, `join`, `dirname`, `basename`, `parse` and `sep`
 * of `node:path`, in both forms, for the renderer, which has no Node. The code
 * is Node's as it is; the primordials it calls are the plain methods below.
 */

const CHAR_UPPERCASE_A = 65;
const CHAR_LOWERCASE_A = 97;
const CHAR_UPPERCASE_Z = 90;
const CHAR_LOWERCASE_Z = 122;
const CHAR_DOT = 46;
const CHAR_FORWARD_SLASH = 47;
const CHAR_BACKWARD_SLASH = 92;
const CHAR_COLON = 58;

const ArrayPrototypeIncludes = (array: readonly string[], value: string) => array.includes(value);
const ArrayPrototypeJoin = (array: readonly string[], separator: string) => array.join(separator);
const ArrayPrototypePush = (array: string[], ...items: string[]) => array.push(...items);
const StringPrototypeCharCodeAt = (value: string, index: number) => value.charCodeAt(index);
const StringPrototypeIncludes = (value: string, search: string) => value.includes(search);
const StringPrototypeIndexOf = (value: string, search: string, position?: number) => value.indexOf(search, position);
const StringPrototypeLastIndexOf = (value: string, search: string) => value.lastIndexOf(search);
const StringPrototypeSlice = (value: string, start?: number, end?: number) => value.slice(start, end);
const StringPrototypeToUpperCase = (value: string) => value.toUpperCase();

function validateString(value: unknown, name: string) {
  if (typeof value !== "string") {
    throw new TypeError(`The "${name}" argument must be of type string. Received ${typeof value}`);
  }
}

export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

export interface PathPort {
  normalize(path: string): string;
  isAbsolute(path: string): boolean;
  join(...args: string[]): string;
  dirname(path: string): string;
  basename(path: string, suffix?: string): string;
  parse(path: string): ParsedPath;
  readonly sep: string;
}

function isPathSeparator(code: number) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}

function isPosixPathSeparator(code: number) {
  return code === CHAR_FORWARD_SLASH;
}

const WINDOWS_RESERVED_NAMES = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
  "COM\xb9",
  "COM\xb2",
  "COM\xb3",
  "LPT\xb9",
  "LPT\xb2",
  "LPT\xb3",
];

function isWindowsReservedName(path: string, colonIndex: number) {
  const devicePart = StringPrototypeToUpperCase(StringPrototypeSlice(path, 0, colonIndex));
  return ArrayPrototypeIncludes(WINDOWS_RESERVED_NAMES, devicePart);
}

function isWindowsDeviceRoot(code: number) {
  return (
    (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) || (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z)
  );
}

// Resolves . and .. elements in a path with directory names
function normalizeString(
  path: string,
  allowAboveRoot: boolean,
  separator: string,
  isPathSeparator: (code: number) => boolean,
) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = StringPrototypeCharCodeAt(path, i);
    else if (isPathSeparator(code)) break;
    else code = CHAR_FORWARD_SLASH;

    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          StringPrototypeCharCodeAt(res, res.length - 1) !== CHAR_DOT ||
          StringPrototypeCharCodeAt(res, res.length - 2) !== CHAR_DOT
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.length - lastSegmentLength - 1;
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = StringPrototypeSlice(res, 0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - StringPrototypeLastIndexOf(res, separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += `${separator}${StringPrototypeSlice(path, lastSlash + 1, i)}`;
        else res = StringPrototypeSlice(path, lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

export const win32: PathPort = {
  normalize(path: string): string {
    validateString(path, "path");
    const len = path.length;
    if (len === 0) return ".";
    let rootEnd = 0;
    let device;
    let isAbsolute = false;
    const code = StringPrototypeCharCodeAt(path, 0);

    // Try to match a root
    if (len === 1) {
      // `path` contains just a single char, exit early to avoid
      // unnecessary work
      return isPosixPathSeparator(code) ? "\\" : path;
    }
    if (isPathSeparator(code)) {
      // Possible UNC root

      // If we started with a separator, we know we at least have an absolute
      // path of some kind (UNC or otherwise)
      isAbsolute = true;

      if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (j < len && !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
          j++;
        }
        if (j < len && j !== last) {
          const firstPart = StringPrototypeSlice(path, last, j);
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (j < len && isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (j < len && !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
              j++;
            }
            if (j === len || j !== last) {
              if (firstPart === "." || firstPart === "?") {
                // We matched a device root (e.g. \\\\.\\PHYSICALDRIVE0)
                device = `\\\\${firstPart}`;
                rootEnd = 4;
                const colonIndex = StringPrototypeIndexOf(path, ":");
                // Special case: handle \\?\COM1: or similar reserved device paths
                const possibleDevice = StringPrototypeSlice(path, 4, colonIndex + 1);
                if (isWindowsReservedName(possibleDevice, possibleDevice.length - 1)) {
                  device = `\\\\?\\${possibleDevice}`;
                  rootEnd = 4 + possibleDevice.length;
                }
              } else if (j === len) {
                // We matched a UNC root only
                // Return the normalized version of the UNC root since there
                // is nothing left to process
                return `\\\\${firstPart}\\${StringPrototypeSlice(path, last)}\\`;
              } else {
                // We matched a UNC root with leftovers
                device = `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                rootEnd = j;
              }
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else {
      const colonIndex = StringPrototypeIndexOf(path, ":");
      if (colonIndex > 0) {
        if (isWindowsDeviceRoot(code) && colonIndex === 1) {
          device = StringPrototypeSlice(path, 0, 2);
          rootEnd = 2;
          if (len > 2 && isPathSeparator(StringPrototypeCharCodeAt(path, 2))) {
            isAbsolute = true;
            rootEnd = 3;
          }
        } else if (isWindowsReservedName(path, colonIndex)) {
          device = StringPrototypeSlice(path, 0, colonIndex + 1);
          rootEnd = colonIndex + 1;
        }
      }
    }

    let tail =
      rootEnd < len ? normalizeString(StringPrototypeSlice(path, rootEnd), !isAbsolute, "\\", isPathSeparator) : "";
    if (tail.length === 0 && !isAbsolute) tail = ".";
    if (tail.length > 0 && isPathSeparator(StringPrototypeCharCodeAt(path, len - 1))) tail += "\\";
    if (!isAbsolute && device === undefined && StringPrototypeIncludes(path, ":")) {
      // If the original path was not absolute and if we have not been able to
      // resolve it relative to a particular device, we need to ensure that the
      // `tail` has not become something that Windows might interpret as an
      // absolute path. See CVE-2024-36139.
      if (
        tail.length >= 2 &&
        isWindowsDeviceRoot(StringPrototypeCharCodeAt(tail, 0)) &&
        StringPrototypeCharCodeAt(tail, 1) === CHAR_COLON
      ) {
        return `.\\${tail}`;
      }
      let index = StringPrototypeIndexOf(path, ":");

      do {
        if (index === len - 1 || isPathSeparator(StringPrototypeCharCodeAt(path, index + 1))) {
          return `.\\${tail}`;
        }
      } while ((index = StringPrototypeIndexOf(path, ":", index + 1)) !== -1);
    }
    const colonIndex = StringPrototypeIndexOf(path, ":");
    if (isWindowsReservedName(path, colonIndex)) {
      return `.\\${device ?? ""}${tail}`;
    }
    if (device === undefined) {
      return isAbsolute ? `\\${tail}` : tail;
    }
    return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
  },

  isAbsolute(path: string): boolean {
    validateString(path, "path");
    const len = path.length;
    if (len === 0) return false;

    const code = StringPrototypeCharCodeAt(path, 0);
    return (
      isPathSeparator(code) ||
      // Possible device root
      (len > 2 &&
        isWindowsDeviceRoot(code) &&
        StringPrototypeCharCodeAt(path, 1) === CHAR_COLON &&
        isPathSeparator(StringPrototypeCharCodeAt(path, 2)))
    );
  },

  join(...args: string[]): string {
    if (args.length === 0) return ".";

    const path: string[] = [];
    for (let i = 0; i < args.length; ++i) {
      const arg = args[i];
      validateString(arg, "path");
      if (arg.length > 0) {
        ArrayPrototypePush(path, arg);
      }
    }

    if (path.length === 0) return ".";

    const firstPart = path[0];
    let joined = ArrayPrototypeJoin(path, "\\");

    // Make sure that the joined path doesn't start with two slashes, because
    // normalize() will mistake it for a UNC path then.
    //
    // This step is skipped when it is very clear that the user actually
    // intended to point at a UNC path. This is assumed when the first
    // non-empty string arguments starts with exactly two slashes followed by
    // at least one more non-slash character.
    //
    // Note that for normalize() to treat a path as a UNC path it needs to
    // have at least 2 components, so we don't filter for that here.
    // This means that the user can use join to construct UNC paths from
    // a server name and a share name; for example:
    //   path.join('//server', 'share') -> '\\\\server\\share\\')
    let needsReplace = true;
    let slashCount = 0;
    if (isPathSeparator(StringPrototypeCharCodeAt(firstPart, 0))) {
      ++slashCount;
      const firstLen = firstPart.length;
      if (firstLen > 1 && isPathSeparator(StringPrototypeCharCodeAt(firstPart, 1))) {
        ++slashCount;
        if (firstLen > 2) {
          if (isPathSeparator(StringPrototypeCharCodeAt(firstPart, 2))) ++slashCount;
          else {
            // We matched a UNC path in the first part
            needsReplace = false;
          }
        }
      }
    }
    if (needsReplace) {
      // Find any more consecutive slashes we need to replace
      while (slashCount < joined.length && isPathSeparator(StringPrototypeCharCodeAt(joined, slashCount))) {
        slashCount++;
      }

      // Replace the slashes if needed
      if (slashCount >= 2) joined = `\\${StringPrototypeSlice(joined, slashCount)}`;
    }

    // Skip normalization when reserved device names are present
    const parts = [];
    let part = "";

    for (let i = 0; i < joined.length; i++) {
      if (joined[i] === "\\") {
        if (part) parts.push(part);
        part = "";
        // Skip consecutive backslashes
        while (i + 1 < joined.length && joined[i + 1] === "\\") i++;
      } else {
        part += joined[i];
      }
    }
    // Add the final part if any
    if (part) parts.push(part);

    // Check if any part has a Windows reserved name
    if (
      parts.some((p) => {
        const colonIndex = StringPrototypeIndexOf(p, ":");
        return colonIndex !== -1 && isWindowsReservedName(p, colonIndex);
      })
    ) {
      // Replace forward slashes with backslashes
      let result = "";
      for (let i = 0; i < joined.length; i++) {
        result += joined[i] === "/" ? "\\" : joined[i];
      }
      return result;
    }

    return win32.normalize(joined);
  },

  dirname(path: string): string {
    validateString(path, "path");
    const len = path.length;
    if (len === 0) return ".";
    let rootEnd = -1;
    let offset = 0;
    const code = StringPrototypeCharCodeAt(path, 0);

    if (len === 1) {
      // `path` contains just a path separator, exit early to avoid
      // unnecessary work or a dot.
      return isPathSeparator(code) ? path : ".";
    }

    // Try to match a root
    if (isPathSeparator(code)) {
      // Possible UNC root

      rootEnd = offset = 1;

      if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (j < len && !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (j < len && isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (j < len && !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
              j++;
            }
            if (j === len) {
              // We matched a UNC root only
              return path;
            }
            if (j !== last) {
              // We matched a UNC root with leftovers

              // Offset by 1 to include the separator after the UNC root to
              // treat it as a "normal root" on top of a (UNC) root
              rootEnd = offset = j + 1;
            }
          }
        }
      }
      // Possible device root
    } else if (isWindowsDeviceRoot(code) && StringPrototypeCharCodeAt(path, 1) === CHAR_COLON) {
      rootEnd = len > 2 && isPathSeparator(StringPrototypeCharCodeAt(path, 2)) ? 3 : 2;
      offset = rootEnd;
    }

    let end = -1;
    let matchedSlash = true;
    for (let i = len - 1; i >= offset; --i) {
      if (isPathSeparator(StringPrototypeCharCodeAt(path, i))) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1) {
      if (rootEnd === -1) return ".";

      end = rootEnd;
    }
    return StringPrototypeSlice(path, 0, end);
  },

  basename(path: string, suffix?: string): string {
    if (suffix !== undefined) validateString(suffix, "suffix");
    validateString(path, "path");
    let start = 0;
    let end = -1;
    let matchedSlash = true;

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded
    if (
      path.length >= 2 &&
      isWindowsDeviceRoot(StringPrototypeCharCodeAt(path, 0)) &&
      StringPrototypeCharCodeAt(path, 1) === CHAR_COLON
    ) {
      start = 2;
    }

    if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
      if (suffix === path) return "";
      let extIdx = suffix.length - 1;
      let firstNonSlashEnd = -1;
      for (let i = path.length - 1; i >= start; --i) {
        const code = StringPrototypeCharCodeAt(path, i);
        if (isPathSeparator(code)) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === StringPrototypeCharCodeAt(suffix, extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end) end = firstNonSlashEnd;
      else if (end === -1) end = path.length;
      return StringPrototypeSlice(path, start, end);
    }
    for (let i = path.length - 1; i >= start; --i) {
      if (isPathSeparator(StringPrototypeCharCodeAt(path, i))) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // path component
        matchedSlash = false;
        end = i + 1;
      }
    }

    if (end === -1) return "";
    return StringPrototypeSlice(path, start, end);
  },

  parse(path: string): ParsedPath {
    validateString(path, "path");

    const ret = { root: "", dir: "", base: "", ext: "", name: "" };
    if (path.length === 0) return ret;

    const len = path.length;
    let rootEnd = 0;
    let code = StringPrototypeCharCodeAt(path, 0);

    if (len === 1) {
      if (isPathSeparator(code)) {
        // `path` contains just a path separator, exit early to avoid
        // unnecessary work
        ret.root = ret.dir = path;
        return ret;
      }
      ret.base = ret.name = path;
      return ret;
    }
    // Try to match a root
    if (isPathSeparator(code)) {
      // Possible UNC root

      rootEnd = 1;
      if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (j < len && !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (j < len && isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (j < len && !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
              j++;
            }
            if (j === len) {
              // We matched a UNC root only
              rootEnd = j;
            } else if (j !== last) {
              // We matched a UNC root with leftovers
              rootEnd = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code) && StringPrototypeCharCodeAt(path, 1) === CHAR_COLON) {
      // Possible device root
      if (len <= 2) {
        // `path` contains just a drive root, exit early to avoid
        // unnecessary work
        ret.root = ret.dir = path;
        return ret;
      }
      rootEnd = 2;
      if (isPathSeparator(StringPrototypeCharCodeAt(path, 2))) {
        if (len === 3) {
          // `path` contains just a drive root, exit early to avoid
          // unnecessary work
          ret.root = ret.dir = path;
          return ret;
        }
        rootEnd = 3;
      }
    }
    if (rootEnd > 0) ret.root = StringPrototypeSlice(path, 0, rootEnd);

    let startDot = -1;
    let startPart = rootEnd;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;

    // Get non-dir info
    for (; i >= rootEnd; --i) {
      code = StringPrototypeCharCodeAt(path, i);
      if (isPathSeparator(code)) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (end !== -1) {
      if (
        startDot === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
      ) {
        ret.base = ret.name = StringPrototypeSlice(path, startPart, end);
      } else {
        ret.name = StringPrototypeSlice(path, startPart, startDot);
        ret.base = StringPrototypeSlice(path, startPart, end);
        ret.ext = StringPrototypeSlice(path, startDot, end);
      }
    }

    // If the directory is the root, use the entire root as the `dir` including
    // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
    // trailing slash (`C:\abc\def` -> `C:\abc`).
    if (startPart > 0 && startPart !== rootEnd) ret.dir = StringPrototypeSlice(path, 0, startPart - 1);
    else ret.dir = ret.root;

    return ret;
  },

  sep: "\\",
};

export const posix: PathPort = {
  normalize(path: string): string {
    validateString(path, "path");

    if (path.length === 0) return ".";

    const isAbsolute = path[0] === "/";
    const trailingSeparator = path[path.length - 1] === "/";

    // Normalize the path
    path = normalizeString(path, !isAbsolute, "/", isPosixPathSeparator);

    if (path.length === 0) {
      if (isAbsolute) return "/";
      return trailingSeparator ? "./" : ".";
    }
    if (trailingSeparator) path += "/";

    return isAbsolute ? `/${path}` : path;
  },

  isAbsolute(path: string): boolean {
    validateString(path, "path");
    return path.length > 0 && StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
  },

  join(...args: string[]): string {
    if (args.length === 0) return ".";

    const path = [];
    for (let i = 0; i < args.length; ++i) {
      const arg = args[i];
      validateString(arg, "path");
      if (arg.length > 0) {
        path.push(arg);
      }
    }

    if (path.length === 0) return ".";

    return posix.normalize(ArrayPrototypeJoin(path, "/"));
  },

  dirname(path: string): string {
    validateString(path, "path");
    if (path.length === 0) return ".";
    const hasRoot = StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
    let end = -1;
    let matchedSlash = true;
    for (let i = path.length - 1; i >= 1; --i) {
      if (StringPrototypeCharCodeAt(path, i) === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1) return hasRoot ? "/" : ".";
    if (hasRoot && end === 1) return "//";
    return StringPrototypeSlice(path, 0, end);
  },

  basename(path: string, suffix?: string): string {
    if (suffix !== undefined) validateString(suffix, "suffix");
    validateString(path, "path");

    let start = 0;
    let end = -1;
    let matchedSlash = true;

    if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
      if (suffix === path) return "";
      let extIdx = suffix.length - 1;
      let firstNonSlashEnd = -1;
      for (let i = path.length - 1; i >= 0; --i) {
        const code = StringPrototypeCharCodeAt(path, i);
        if (code === CHAR_FORWARD_SLASH) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === StringPrototypeCharCodeAt(suffix, extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end) end = firstNonSlashEnd;
      else if (end === -1) end = path.length;
      return StringPrototypeSlice(path, start, end);
    }
    for (let i = path.length - 1; i >= 0; --i) {
      if (StringPrototypeCharCodeAt(path, i) === CHAR_FORWARD_SLASH) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // path component
        matchedSlash = false;
        end = i + 1;
      }
    }

    if (end === -1) return "";
    return StringPrototypeSlice(path, start, end);
  },

  parse(path: string): ParsedPath {
    validateString(path, "path");

    const ret = { root: "", dir: "", base: "", ext: "", name: "" };
    if (path.length === 0) return ret;
    const isAbsolute = StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
    let start;
    if (isAbsolute) {
      ret.root = "/";
      start = 1;
    } else {
      start = 0;
    }
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;

    // Get non-dir info
    for (; i >= start; --i) {
      const char = path[i];
      if (char === "/") {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (char === ".") {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (end !== -1) {
      const start = startPart === 0 && isAbsolute ? 1 : startPart;
      if (
        startDot === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
      ) {
        ret.base = ret.name = StringPrototypeSlice(path, start, end);
      } else {
        ret.name = StringPrototypeSlice(path, start, startDot);
        ret.base = StringPrototypeSlice(path, start, end);
        ret.ext = StringPrototypeSlice(path, startDot, end);
      }
    }

    if (startPart > 0) ret.dir = StringPrototypeSlice(path, 0, startPart - 1);
    else if (isAbsolute) ret.dir = "/";

    return ret;
  },

  sep: "/",
};
