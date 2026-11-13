/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import http2 from "node:http2";

/**
 * A minimal gRPC client over HTTP/2 for unary and server-streaming calls with
 * uncompressed messages, which is what Hubble Relay answers. It keeps one
 * session per address and reconnects when the session closes.
 */

export interface GrpcTlsOptions {
  ca?: string;
  cert?: string;
  key?: string;
  /** The name to verify the server certificate against, when it differs from the host. */
  servername?: string;
}

export class GrpcError extends Error {
  constructor(
    message: string,
    /** The gRPC status code; 14 (UNAVAILABLE) for a transport failure. */
    public readonly code: number,
  ) {
    super(message);
  }
}

export const grpcStatus = {
  ok: 0,
  cancelled: 1,
  deadlineExceeded: 4,
  notFound: 5,
  permissionDenied: 7,
  resourceExhausted: 8,
  unimplemented: 12,
  unavailable: 14,
} as const;

/** Frames a message: a zero compression flag and a big-endian length, then the message. */
export function frameMessage(message: Uint8Array): Uint8Array {
  const framed = new Uint8Array(5 + message.length);

  new DataView(framed.buffer).setUint32(1, message.length, false);
  framed.set(message, 5);

  return framed;
}

/** Splits a stream of framed messages, keeping a partial frame for the next chunk. */
export class FrameDecoder {
  private pending = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const buffer = new Uint8Array(this.pending.length + chunk.length);

    buffer.set(this.pending);
    buffer.set(chunk, this.pending.length);

    const messages: Uint8Array[] = [];
    let offset = 0;

    while (buffer.length - offset >= 5) {
      if (buffer[offset] !== 0) {
        throw new GrpcError("The server sent a compressed message", grpcStatus.unimplemented);
      }

      const length = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4).getUint32(0, false);

      if (buffer.length - offset - 5 < length) {
        break;
      }

      messages.push(buffer.slice(offset + 5, offset + 5 + length));
      offset += 5 + length;
    }

    this.pending = buffer.slice(offset);

    return messages;
  }
}

export interface StreamCallOptions {
  /** Stops the call after this many milliseconds; the messages read so far are kept. */
  timeoutMs: number;
  /** Stops the call once this many messages have arrived. */
  maxMessages?: number;
  /** Called for every message, which the result then leaves out; returning false stops the call. */
  onMessage?: (message: Uint8Array) => boolean | void;
}

export interface StreamCallResult {
  messages: Uint8Array[];
  /** The call stopped on the timeout or the message limit rather than at the end of the stream. */
  cutShort: boolean;
}

export class GrpcClient {
  private session?: http2.ClientHttp2Session;

  constructor(
    private readonly authority: string,
    private readonly tls?: GrpcTlsOptions,
  ) {}

  private connect(): http2.ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session;
    }

    const session = http2.connect(this.authority, this.tls ? { ...this.tls } : {});

    // An error of the session fails the streams on it, which report it; the
    // listener only keeps an error from being unhandled.
    session.on("error", () => {});
    session.on("close", () => {
      if (this.session === session) {
        this.session = undefined;
      }
    });
    this.session = session;

    return session;
  }

  /** Calls `path` (`/package.Service/Method`) and reads the messages of the reply. */
  call(path: string, request: Uint8Array, options: StreamCallOptions): Promise<StreamCallResult> {
    return new Promise((resolve, reject) => {
      let stream: http2.ClientHttp2Stream;

      try {
        stream = this.connect().request({
          ":method": "POST",
          ":path": path,
          "content-type": "application/grpc",
          te: "trailers",
          "grpc-timeout": `${Math.max(1, Math.ceil(options.timeoutMs))}m`,
        });
      } catch (error) {
        reject(new GrpcError(String(error), grpcStatus.unavailable));

        return;
      }

      const decoder = new FrameDecoder();
      const messages: Uint8Array[] = [];
      let received = 0;
      let settled = false;
      let status: number | undefined;
      let statusMessage = "";

      const finish = (cutShort: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (!stream.closed) {
          stream.close(http2.constants.NGHTTP2_CANCEL);
        }

        resolve({ messages, cutShort });
      };

      const fail = (error: GrpcError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(error);
      };

      const timer = setTimeout(() => finish(true), options.timeoutMs);

      const readStatus = (headers: http2.IncomingHttpHeaders) => {
        const value = headers["grpc-status"];

        if (value !== undefined) {
          status = Number(value);
          statusMessage = decodeURIComponent(String(headers["grpc-message"] ?? ""));
        }
      };

      stream.on("response", (headers) => {
        const httpStatus = Number(headers[":status"]);

        if (httpStatus !== 200) {
          fail(new GrpcError(`The server answered HTTP ${httpStatus}`, grpcStatus.unavailable));

          return;
        }

        // A reply without messages carries its status in the headers.
        readStatus(headers);
      });
      stream.on("trailers", readStatus);
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;

        let frames: Uint8Array[];

        try {
          frames = decoder.push(chunk);
        } catch (error) {
          fail(error instanceof GrpcError ? error : new GrpcError(String(error), grpcStatus.unavailable));

          return;
        }

        for (const frame of frames) {
          received++;

          // A caller that reads each message keeps what it needs of it.
          if (options.onMessage) {
            let more: boolean | void;

            try {
              more = options.onMessage(frame);
            } catch (error) {
              fail(new GrpcError(`Cannot read a message: ${String(error)}`, grpcStatus.unavailable));

              return;
            }

            if (more === false) {
              finish(true);

              return;
            }
          } else {
            messages.push(frame);
          }

          if (options.maxMessages !== undefined && received >= options.maxMessages) {
            finish(true);

            return;
          }
        }
      });
      stream.on("end", () => {
        if (settled) return;

        if (status === undefined || status === grpcStatus.ok) {
          finish(false);
        } else if (status === grpcStatus.deadlineExceeded) {
          finish(true);
        } else {
          fail(new GrpcError(statusMessage || `gRPC status ${status}`, status));
        }
      });
      stream.on("error", (error) => fail(new GrpcError(error.message, grpcStatus.unavailable)));

      stream.end(frameMessage(request));
    });
  }

  close() {
    this.session?.close();
    this.session = undefined;
  }
}
