/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import hideDetailsInjectable from "../../../../renderer/components/kube-detail-params/hide-details.injectable";
import { type DiRender, renderFor } from "../../../../renderer/components/test-utils/renderFor";
import { getDiForUnitTesting } from "../../../../renderer/getDiForUnitTesting";
import createPodFilesTabInjectable from "../create-pod-files-tab.injectable";
import { PodFilesMenu } from "../pod-files-menu";
import podFilesMenuInjectable from "../pod-files-menu.injectable";

import type { Container } from "@freelensapp/kube-object";

import type { DiContainer } from "@ogre-tools/injectable";
import type { Mock } from "vitest";

import type { NodePodMenuItemProps } from "../../../../renderer/components/node-pod-menu/pod-menu-item";

let menuItemProps: NodePodMenuItemProps | undefined;

vi.mock("../../../../renderer/components/node-pod-menu/pod-menu-item", () => ({
  __esModule: true,
  default: (props: NodePodMenuItemProps) => {
    menuItemProps = props;

    return <div data-testid="pod-menu-item">{props.title}</div>;
  },
}));

const runningPod = (nodeSelector?: Record<string, string>) => ({
  apiVersion: "v1",
  kind: "Pod",
  metadata: {
    name: "web-0",
    namespace: "shop",
    uid: "uid-web-0",
    resourceVersion: "1",
    selfLink: "/api/v1/namespaces/shop/pods/web-0",
  },
  spec: {
    nodeSelector,
    containers: [{ name: "app" }, { name: "sidecar" }, { name: "stopped" }],
  },
  status: {
    containerStatuses: [
      { name: "app", state: { running: {} } },
      { name: "sidecar", state: { running: {} } },
      { name: "stopped", state: { terminated: {} } },
    ],
  },
});

describe("pod files menu", () => {
  let di: DiContainer;
  let render: DiRender;
  let createPodFilesTab: Mock;
  let hideDetails: Mock;

  beforeEach(() => {
    menuItemProps = undefined;
    di = getDiForUnitTesting();
    createPodFilesTab = vi.fn();
    hideDetails = vi.fn();
    di.override(createPodFilesTabInjectable, () => createPodFilesTab);
    di.override(hideDetailsInjectable, () => hideDetails);
    render = renderFor(di);
  });

  it("is a menu item of pods after Attach, Shell and Logs", () => {
    const item = di.inject(podFilesMenuInjectable);

    expect(item).toMatchObject({ kind: "Pod", apiVersions: ["v1"], orderNumber: 4 });
    expect(item.enabled.get()).toBe(true);
  });

  it("renders nothing without an object", () => {
    const { container } = render(<PodFilesMenu object={undefined} toolbar={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a malformed object", () => {
    const { container } = render(<PodFilesMenu object={{} as never} toolbar={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a pod on a Windows node", () => {
    const { container } = render(
      <PodFilesMenu object={runningPod({ "kubernetes.io/os": "windows" }) as never} toolbar={false} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("offers the running containers of the pod", () => {
    const { getByTestId } = render(<PodFilesMenu object={runningPod() as never} toolbar={false} />);

    expect(getByTestId("pod-menu-item").textContent).toBe("Files");
    expect(menuItemProps?.containers.map(({ name }) => name)).toEqual(["app", "sidecar"]);
  });

  it("opens a file browser tab for the chosen container and hides the details", () => {
    render(<PodFilesMenu object={runningPod() as never} toolbar={true} />);

    menuItemProps?.onMenuItemClick({ name: "sidecar" } as Container);

    expect(createPodFilesTab).toHaveBeenCalledWith({
      namespace: "shop",
      pod: "web-0",
      container: "sidecar",
      containers: ["app", "sidecar"],
    });
    expect(hideDetails).toHaveBeenCalledTimes(1);
  });
});
