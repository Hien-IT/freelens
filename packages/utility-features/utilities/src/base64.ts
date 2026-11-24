/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Encode/decode utf-8 base64 string, with what a browser page and Node both have
const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2,3})?$/;

function assertBase64(data: string): string {
  if (!base64Regex.test(data)) {
    throw new Error("Input is not valid base64");
  }

  return data.padEnd(data.length + ((4 - (data.length % 4)) % 4), "=");
}

/**
 * Computes utf-8 from base64
 * @param data A Base64 encoded string
 * @returns The original utf-8 string
 * @throws if the decoded bytes are not valid utf-8 (e.g. the input was not
 *   actually base64-encoded), matching the previous crypto-js behavior that
 *   callers rely on to detect non-base64 input
 */
function decode(data: string): string {
  const binary = atob(assertBase64(data));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Computes base64 from utf-8
 * @param data A normal string
 * @returns A base64 encoded version
 */
function encode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";

  // in chunks, because String.fromCharCode takes its arguments on the stack
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

export const base64 = {
  encode,
  decode,
};
