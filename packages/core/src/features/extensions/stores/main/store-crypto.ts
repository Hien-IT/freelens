/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The encryption of conf 16.0.0, under this notice:
//
// MIT License
//
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

import crypto from "node:crypto";

const separatorCodePoint = ":".codePointAt(0) as number;

type Key = string | Uint8Array;

/** The text of a file conf encrypted with the key, or the file as it is when it is not encrypted. */
export const decryptStoreData = (data: Uint8Array, encryptionKey: Key, encryptionAlgorithm = "aes-256-cbc"): string => {
  const asText = () => Buffer.from(data).toString("utf8");

  if (data[16] !== separatorCodePoint) {
    if (encryptionAlgorithm === "aes-256-cbc") {
      return asText();
    }

    throw new Error("Failed to decrypt config data.");
  }

  const initializationVector = Buffer.from(data.slice(0, 16));
  let ciphertext = Buffer.from(data.slice(17));
  let authenticationTag: Buffer | undefined;

  if (encryptionAlgorithm === "aes-256-gcm") {
    const authenticationTagStart = ciphertext.length - 16;

    if (authenticationTagStart < 0) {
      throw new Error("Failed to decrypt config data.");
    }

    authenticationTag = ciphertext.subarray(authenticationTagStart);
    ciphertext = ciphertext.subarray(0, authenticationTagStart);
  }

  for (const salt of [initializationVector, initializationVector.toString()]) {
    try {
      const password = crypto.pbkdf2Sync(encryptionKey, salt, 10_000, 32, "sha512");
      const decipher = crypto.createDecipheriv(
        encryptionAlgorithm,
        password,
        initializationVector,
      ) as crypto.DecipherGCM;

      if (authenticationTag) {
        decipher.setAuthTag(authenticationTag);
      }

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // the next salt, as conf tries the legacy one too
    }
  }

  if (encryptionAlgorithm === "aes-256-cbc") {
    return asText();
  }

  throw new Error("Failed to decrypt config data.");
};

/** The bytes conf writes for the text with the key. */
export const encryptStoreData = (text: string, encryptionKey: Key, encryptionAlgorithm = "aes-256-cbc"): Buffer => {
  const initializationVector = crypto.randomBytes(16);
  const password = crypto.pbkdf2Sync(encryptionKey, initializationVector, 10_000, 32, "sha512");
  const cipher = crypto.createCipheriv(encryptionAlgorithm, password, initializationVector) as crypto.CipherGCM;
  const parts = [
    initializationVector,
    Buffer.of(separatorCodePoint),
    Buffer.concat([cipher.update(text, "utf8"), cipher.final()]),
  ];

  if (encryptionAlgorithm === "aes-256-gcm") {
    parts.push(cipher.getAuthTag());
  }

  return Buffer.concat(parts);
};
