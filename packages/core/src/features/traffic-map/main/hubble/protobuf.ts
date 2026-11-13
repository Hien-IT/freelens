/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/**
 * The few parts of the protobuf wire format that the Hubble client needs: a
 * reader that walks the fields of a message, and a writer for the request.
 * Unknown fields are skipped, as protobuf requires, so a decoder written for
 * a subset of a message reads every version of it.
 */

export const WireType = {
  varint: 0,
  fixed64: 1,
  lengthDelimited: 2,
  fixed32: 5,
} as const;

export type WireTypeValue = (typeof WireType)[keyof typeof WireType];

export class ProtobufError extends Error {}

export interface ProtobufField {
  readonly number: number;
  readonly wireType: WireTypeValue;
  /** The value of a varint, fixed32 or fixed64 field, as a number (exact up to 2^53). */
  readonly value: number;
  /** The bytes of a length-delimited field. */
  readonly bytes: Uint8Array;
}

const empty = new Uint8Array(0);
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** Reads the varint at `offset`, returning its value and the offset after it. */
export function readVarint(buffer: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0;
  let multiplier = 1;
  let position = offset;

  for (let index = 0; index < 10; index++) {
    if (position >= buffer.length) {
      throw new ProtobufError("Truncated varint");
    }

    const byte = buffer[position++];

    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;

    if ((byte & 0x80) === 0) {
      return [value, position];
    }
  }

  throw new ProtobufError("Varint longer than ten bytes");
}

/** The fields of a message, in the order they are encoded. */
export function* readFields(buffer: Uint8Array): Generator<ProtobufField> {
  let offset = 0;

  while (offset < buffer.length) {
    const [tag, afterTag] = readVarint(buffer, offset);
    const number = Math.floor(tag / 8);
    const wireType = tag % 8;

    offset = afterTag;

    switch (wireType) {
      case WireType.varint: {
        const [value, next] = readVarint(buffer, offset);

        offset = next;
        yield { number, wireType, value, bytes: empty };
        break;
      }
      case WireType.fixed64: {
        if (offset + 8 > buffer.length) {
          throw new ProtobufError("Truncated fixed64");
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
        const value = view.getUint32(0, true) + view.getUint32(4, true) * 2 ** 32;

        offset += 8;
        yield { number, wireType, value, bytes: empty };
        break;
      }
      case WireType.lengthDelimited: {
        const [length, start] = readVarint(buffer, offset);
        const end = start + length;

        if (end > buffer.length) {
          throw new ProtobufError("Truncated length-delimited field");
        }

        offset = end;
        yield { number, wireType, value: length, bytes: buffer.subarray(start, end) };
        break;
      }
      case WireType.fixed32: {
        if (offset + 4 > buffer.length) {
          throw new ProtobufError("Truncated fixed32");
        }

        const value = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, true);

        offset += 4;
        yield { number, wireType, value, bytes: empty };
        break;
      }
      default:
        throw new ProtobufError(`Unsupported wire type ${wireType}`);
    }
  }
}

export function decodeString(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** An int32 that was encoded as a varint: negative values take ten bytes and come back as 2^64 - n. */
export function toInt32(value: number): number {
  return value >= 2 ** 63 ? value - 2 ** 64 : value;
}

/** Builds a message field by field. */
export class ProtobufWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  private push(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  private varint(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ProtobufError(`Cannot encode ${value} as a varint`);
    }

    const bytes: number[] = [];
    let rest = value;

    while (rest >= 0x80) {
      bytes.push((rest % 128) | 0x80);
      rest = Math.floor(rest / 128);
    }

    bytes.push(rest);
    this.push(Uint8Array.from(bytes));
  }

  private tag(number: number, wireType: WireTypeValue) {
    this.varint(number * 8 + wireType);
  }

  uint(number: number, value: number): this {
    this.tag(number, WireType.varint);
    this.varint(value);

    return this;
  }

  bool(number: number, value: boolean): this {
    return this.uint(number, value ? 1 : 0);
  }

  bytes(number: number, value: Uint8Array): this {
    this.tag(number, WireType.lengthDelimited);
    this.varint(value.length);
    this.push(value);

    return this;
  }

  string(number: number, value: string): this {
    return this.bytes(number, textEncoder.encode(value));
  }

  message(number: number, build: (writer: ProtobufWriter) => void): this {
    const writer = new ProtobufWriter();

    build(writer);

    return this.bytes(number, writer.finish());
  }

  finish(): Uint8Array {
    const result = new Uint8Array(this.length);
    let offset = 0;

    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }
}
