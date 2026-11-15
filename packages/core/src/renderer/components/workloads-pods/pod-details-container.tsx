/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./pod-details-container.scss";

import { podDetailsContainerMetricsInjectionToken } from "@freelensapp/metrics";
import { cssNames, isDefined } from "@freelensapp/utilities";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import React from "react";
import { ClusterMetricsResourceType } from "../../../common/cluster-types";
import enabledMetricsInjectable from "../../api/catalog/entity/metrics-enabled.injectable";
import portForwardStoreInjectable from "../../port-forward/port-forward-store/port-forward-store.injectable";
import { Badge } from "../badge";
import { findOptimalDefaultContainerOfPod } from "../dock/logs/default-container-helper";
import { DrawerItem } from "../drawer";
import { DurationAbsoluteTimestamp } from "../events";
import { StatusBrick } from "../status-brick";
import { formatTermination, getLastTermination, hasRestarted } from "./container-restart";
import { containerStatusClassName } from "./container-status-class-name";
import { ContainerEnvironment } from "./pod-container-env";
import { PodContainerPort } from "./pod-container-port";

import type {
  ContainerStateTerminated,
  ContainerWithType,
  EphemeralContainerWithType,
  Pod,
  PodContainerStatus,
} from "@freelensapp/kube-object";
import type { PodDetailsContainerMetricsComponent } from "@freelensapp/metrics";

import type { IComputedValue } from "mobx";

import type { PortForwardStore } from "../../port-forward";

export interface PodDetailsContainerProps {
  pod: Pod;
  container: ContainerWithType | EphemeralContainerWithType;
}

/**
 * The id of a container's section in the pod details, which the Target
 * Container link of an ephemeral container points to.
 */
const containerAnchorId = (pod: Pod, containerName: string) => `pod-container-id-${pod.getName()}-${containerName}`;

interface Dependencies {
  portForwardStore: PortForwardStore;
  containerMetricsVisible: IComputedValue<boolean>;
  containerMetrics: PodDetailsContainerMetricsComponent[];
}

@observer
class NonInjectedPodDetailsContainer extends React.Component<PodDetailsContainerProps & Dependencies> {
  private readonly disposers: (() => void)[] = [];

  componentDidMount() {
    this.disposers.push(this.props.portForwardStore.watch());
  }

  componentWillUnmount() {
    this.disposers.forEach((dispose) => dispose());
  }

  renderStatus(container: ContainerWithType | EphemeralContainerWithType, status?: PodContainerStatus) {
    const state = status ? Object.keys(status?.state ?? {})[0] : "unknown";
    const terminated = status?.state?.terminated;
    const waiting = status?.state?.waiting;

    return (
      <>
        <span className={cssNames("status", containerStatusClassName(container, status))}>
          {state}
          {container.type === "initContainers" ? ", init" : ""}
          {container.type === "ephemeralContainers" ? ", ephemeral" : ""}
          {status?.restartCount ? ", restarted" : ""}
          {status?.ready ? ", ready" : ""}
          {terminated ? ` - ${formatTermination(terminated)}` : ""}
          {waiting?.reason ? ` - ${waiting.reason}` : ""}
        </span>
        {waiting?.message && (
          <>
            <br />
            {waiting.message}
          </>
        )}
      </>
    );
  }

  renderLastState(terminated: ContainerStateTerminated) {
    const { reason, exitCode, signal, message, startedAt, finishedAt } = terminated;

    return (
      <span>
        {"terminated"}
        <br />
        {reason ? `Reason: ${reason} - exit code: ${exitCode}` : `Exit code: ${exitCode}`}
        <br />
        {signal ? (
          <>
            {`Signal: ${signal}`}
            <br />
          </>
        ) : null}
        {message ? (
          <>
            {`Message: ${message}`}
            <br />
          </>
        ) : null}
        {"Started: "}
        {<DurationAbsoluteTimestamp timestamp={startedAt} />}
        <br />
        {"Finished: "}
        {<DurationAbsoluteTimestamp timestamp={finishedAt} />}
        <br />
      </span>
    );
  }

  render() {
    const { pod, container, containerMetricsVisible, containerMetrics } = this.props;

    if (!pod || !container) return null;
    const { name, image, imagePullPolicy, ports, volumeMounts, command, args, resources, resizePolicy } = container;
    const id = containerAnchorId(pod, name);
    const targetContainerName = "targetContainerName" in container ? container.targetContainerName : undefined;
    const status = pod.getContainerStatuses().find((status) => status.name === container.name);
    const lastTermination = getLastTermination(status);
    const imageId = status ? status.imageID : "";
    const liveness = pod.getLivenessProbe(container);
    const readiness = pod.getReadinessProbe(container);
    const startup = pod.getStartupProbe(container);
    const containersType = container.type;
    const isMetricVisible = containerMetricsVisible.get();
    const requests = Object.entries(resources?.requests ?? {});
    const limits = Object.entries(resources?.limits ?? {});
    const isDefaultContainer = findOptimalDefaultContainerOfPod(pod)?.name === name;

    return (
      <div className="PodDetailsContainer">
        <div className="pod-container-title" id={id}>
          <StatusBrick className={containerStatusClassName(container, status)} />
          {name}
          {isDefaultContainer && <span className="text-secondary font-normal">{" (default)"}</span>}
        </div>
        {isMetricVisible && containersType === "containers" && (
          <>
            {containerMetrics.map((ContainerMetrics) => (
              <ContainerMetrics.Component key={ContainerMetrics.id} container={container} pod={pod} />
            ))}
          </>
        )}
        {targetContainerName && (
          <DrawerItem name="Target Container">
            <a href={`#${containerAnchorId(pod, targetContainerName)}`}>{targetContainerName}</a>
          </DrawerItem>
        )}
        {status && <DrawerItem name="Status">{this.renderStatus(container, status)}</DrawerItem>}
        {hasRestarted(status) && <DrawerItem name="Restarts">{status.restartCount}</DrawerItem>}
        {lastTermination && <DrawerItem name="Last Status">{this.renderLastState(lastTermination)}</DrawerItem>}
        <DrawerItem name="Image">
          <Badge label={image} tooltip={imageId} />
        </DrawerItem>
        {imagePullPolicy && imagePullPolicy !== "IfNotPresent" && (
          <DrawerItem name="ImagePullPolicy">{imagePullPolicy}</DrawerItem>
        )}
        {ports && ports.length > 0 && (
          <DrawerItem name="Ports">
            {ports.filter(isDefined).map((port) => (
              <PodContainerPort
                pod={pod}
                port={port}
                key={`${container.name}-port-${port.containerPort}-${port.protocol}`}
              />
            ))}
          </DrawerItem>
        )}
        {<ContainerEnvironment pod={pod} container={container} namespace={pod.getNs()} />}
        {volumeMounts && volumeMounts.length > 0 && (
          <DrawerItem name="Mounts">
            {volumeMounts.map((mount) => {
              const { name, mountPath, readOnly } = mount;

              return (
                <React.Fragment key={name + mountPath}>
                  <span className="mount-path">{mountPath}</span>
                  <span className="mount-from">{`from ${name} (${readOnly ? "ro" : "rw"})`}</span>
                </React.Fragment>
              );
            })}
          </DrawerItem>
        )}
        {liveness.length > 0 && (
          <DrawerItem name="Liveness" labelsOnly>
            {liveness.map((value, index) => (
              <Badge key={index} label={value} />
            ))}
          </DrawerItem>
        )}
        {readiness.length > 0 && (
          <DrawerItem name="Readiness" labelsOnly>
            {readiness.map((value, index) => (
              <Badge key={index} label={value} />
            ))}
          </DrawerItem>
        )}
        {startup.length > 0 && (
          <DrawerItem name="Startup" labelsOnly>
            {startup.map((value, index) => (
              <Badge key={index} label={value} />
            ))}
          </DrawerItem>
        )}
        {command && <DrawerItem name="Command">{command.join(" ")}</DrawerItem>}

        {args && <DrawerItem name="Arguments">{args.join(" ")}</DrawerItem>}

        {requests.length > 0 && (
          <DrawerItem name="Requests" labelsOnly>
            {requests.map(([key, value], index) => (
              <Badge key={index} label={`${key}=${value}`} />
            ))}
          </DrawerItem>
        )}

        {limits.length > 0 && (
          <DrawerItem name="Limits" labelsOnly>
            {limits.map(([key, value], index) => (
              <Badge key={index} label={`${key}=${value}`} />
            ))}
          </DrawerItem>
        )}
        {resizePolicy && resizePolicy.length > 0 && (
          <DrawerItem name="Resize Policy" labelsOnly>
            {resizePolicy.map(({ resourceName, restartPolicy }, index) => (
              <Badge key={`${resourceName}-${restartPolicy}-${index}`} label={`${resourceName}=${restartPolicy}`} />
            ))}
          </DrawerItem>
        )}
      </div>
    );
  }
}

export const PodDetailsContainer = withInjectables<Dependencies, PodDetailsContainerProps>(
  NonInjectedPodDetailsContainer,
  {
    getProps: (di, props) => ({
      ...props,
      portForwardStore: di.inject(portForwardStoreInjectable),
      containerMetricsVisible: di.inject(enabledMetricsInjectable, ClusterMetricsResourceType.Container),
      containerMetrics: di.injectMany(podDetailsContainerMetricsInjectionToken),
    }),
  },
);
