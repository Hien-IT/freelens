/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { LinkToNamespace } from "../../../../../renderer/components/kube-object-link";
import { WithTooltip } from "../../../../../renderer/components/with-tooltip";

export type { GatewayPageProps } from "../../components/available-version";

export function namespaceCell(namespace: string | undefined) {
  if (!namespace) {
    return <WithTooltip>-</WithTooltip>;
  }

  return <LinkToNamespace namespace={namespace} />;
}
