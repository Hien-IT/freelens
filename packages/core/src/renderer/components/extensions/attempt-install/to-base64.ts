/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/** Bytes as base64, which a channel carries; in chunks, as `String.fromCharCode` takes its arguments on the stack. */
export const toBase64 = (bytes: Uint8Array) => {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
};

export const fromBase64 = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
