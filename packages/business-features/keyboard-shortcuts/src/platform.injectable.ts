import { getInjectable } from "@ogre-tools/injectable";

export const allPlatforms = ["win32", "darwin", "linux"] as const;

/** The platform of a `navigator.platform`: "MacIntel", "Win32", "Linux x86_64" and the like. */
export const platformOfNavigator = (navigatorPlatform: string): (typeof allPlatforms)[number] => {
  if (navigatorPlatform.startsWith("Mac")) {
    return "darwin";
  }

  if (navigatorPlatform.startsWith("Win")) {
    return "win32";
  }

  return "linux";
};

// The keyboard shortcuts run in a view, which has no Node: the platform comes from the browser.
const platformInjectable = getInjectable({
  id: "platform",
  instantiate: () => platformOfNavigator(globalThis.navigator.platform),
  causesSideEffects: true,
});

export default platformInjectable;
