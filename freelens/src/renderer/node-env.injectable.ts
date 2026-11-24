import { nodeEnvInjectionToken } from "@freelensapp/core/renderer";
import { getInjectable } from "@ogre-tools/injectable";

export const nodeEnvInjectable = getInjectable({
  id: "node-env",
  instantiate: () => (import.meta.env.DEV ? "development" : "production"),
  injectionToken: nodeEnvInjectionToken,
});
