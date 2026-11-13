/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import svgIcon from "./gateway-api.svg?raw";

import type { IconProps } from "@freelensapp/icon";

export function GatewayApiIcon(props: Omit<IconProps, "svg">) {
  return <Icon {...props} svg={svgIcon} />;
}
