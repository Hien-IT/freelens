/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { ProtobufWriter } from "../protobuf";

export interface FlowSpec {
  timeSeconds?: number;
  verdict?: number;
  dropReasonDesc?: number;
  source?: { namespace?: string; pod?: string; labels?: string[]; workload?: [string, string] };
  destination?: { namespace?: string; pod?: string; labels?: string[]; workload?: [string, string] };
  ip?: [string, string];
  tcp?: [number, number];
  udp?: [number, number];
  http?: { code?: number; method?: string; url?: string };
  dns?: { query: string; rcode?: number };
  l7Type?: number;
  latencyNs?: number;
  isReply?: boolean;
  deniedBy?: { name: string; namespace?: string; kind: string }[];
}

function writeEndpoint(writer: ProtobufWriter, endpoint: NonNullable<FlowSpec["source"]>) {
  if (endpoint.namespace) writer.string(3, endpoint.namespace);
  endpoint.labels?.forEach((label) => writer.string(4, label));
  if (endpoint.pod) writer.string(5, endpoint.pod);
  if (endpoint.workload) {
    const [name, kind] = endpoint.workload;

    writer.message(6, (workload) => workload.string(1, name).string(2, kind));
  }
}

/** A Hubble Flow message, encoded with the field numbers of flow.proto. */
export function encodeFlow(spec: FlowSpec): Uint8Array {
  const writer = new ProtobufWriter();

  if (spec.timeSeconds) writer.message(1, (time) => time.uint(1, spec.timeSeconds!).uint(2, 500_000_000));
  if (spec.verdict) writer.uint(2, spec.verdict);
  if (spec.ip) writer.message(5, (ip) => ip.string(1, spec.ip![0]).string(2, spec.ip![1]));
  if (spec.tcp) writer.message(6, (l4) => l4.message(1, (tcp) => tcp.uint(1, spec.tcp![0]).uint(2, spec.tcp![1])));
  if (spec.udp) writer.message(6, (l4) => l4.message(2, (udp) => udp.uint(1, spec.udp![0]).uint(2, spec.udp![1])));
  if (spec.source) writer.message(8, (endpoint) => writeEndpoint(endpoint, spec.source!));
  if (spec.destination) writer.message(9, (endpoint) => writeEndpoint(endpoint, spec.destination!));
  writer.string(11, "node-a");

  if (spec.http || spec.dns) {
    writer.message(15, (l7) => {
      if (spec.l7Type) l7.uint(1, spec.l7Type);
      if (spec.latencyNs) l7.uint(2, spec.latencyNs);
      if (spec.dns) l7.message(100, (dns) => dns.string(1, spec.dns!.query).uint(6, spec.dns!.rcode ?? 0));
      if (spec.http) {
        l7.message(101, (http) => {
          if (spec.http!.code) http.uint(1, spec.http!.code);
          if (spec.http!.method) http.string(2, spec.http!.method);
          if (spec.http!.url) http.string(3, spec.http!.url);
        });
      }
    });
  }

  if (spec.dropReasonDesc) writer.uint(25, spec.dropReasonDesc);
  if (spec.isReply !== undefined) writer.message(26, (reply) => reply.bool(1, spec.isReply!));
  spec.deniedBy?.forEach((policy) =>
    writer.message(21005, (inner) => {
      inner.string(1, policy.name);
      if (policy.namespace) inner.string(2, policy.namespace);
      inner.string(5, policy.kind);
    }),
  );

  return writer.finish();
}
