/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { ClusterInfo, Recommendation, SourceStatus } from "../common/types";
import type { ClusterAccess, KubeObjectJson } from "./cluster-access";

const providerPlatforms: [prefix: string, platform: string][] = [
  ["gce://", "gke"],
  ["gke://", "gke"],
  ["aws://", "eks"],
  ["azure://", "aks"],
  ["kind://", "kind"],
  ["nutanix://", "nutanix"],
];

/** The platform that a node of the cluster runs on, from its provider ID, labels and name. */
export function platformOfNode(node: KubeObjectJson | undefined, serverVersion = ""): string {
  if (serverVersion.includes("+rke2r") || node?.status?.nodeInfo?.kubeletVersion?.includes("+rke2r")) {
    return "rke2";
  }

  if (!node) {
    return "generic";
  }

  const providerId: string = node.spec?.providerID ?? "";
  const byProvider = providerPlatforms.find(([prefix]) => providerId.startsWith(prefix));

  if (byProvider) {
    return byProvider[1];
  }

  const labels = node.metadata.labels ?? {};
  const has = (label: string) => label in labels;

  if (has("cloud.google.com/gke-nodepool")) return "gke";
  if (has("eks.amazonaws.com/nodegroup") || has("eks.amazonaws.com/capacityType")) return "eks";
  if (Object.keys(labels).some((label) => label.startsWith("kubernetes.azure.com/"))) return "aks";
  if (has("node.openshift.io/os_id")) return "openshift";
  if (has("rke.cattle.io/machine")) return "rancher";

  const { name } = node.metadata;

  if (name.includes("kind-")) return "kind";
  if (name === "minikube" || name.startsWith("minikube-")) return "minikube";
  if (name === "docker-desktop") return "docker-desktop";

  return "generic";
}

async function daemonSetExists(access: ClusterAccess, name: string, namespaces: string[]): Promise<boolean> {
  for (const namespace of namespaces) {
    if (await access.get(`/apis/apps/v1/namespaces/${namespace}/daemonsets/${name}`).catch(() => undefined)) {
      return true;
    }
  }

  return false;
}

/** The CNI of the cluster, and whether it is Cilium with Hubble turned on. */
async function detectCni(access: ClusterAccess, platform: string): Promise<{ cni: string; hubble: boolean }> {
  const ciliumConfig = await access
    .get("/api/v1/namespaces/kube-system/configmaps/cilium-config")
    .catch(() => undefined);

  if (ciliumConfig) {
    return { cni: "cilium", hubble: ciliumConfig.data?.["enable-hubble"] === "true" };
  }

  const cilium = await access.get("/apis/apps/v1/namespaces/kube-system/daemonsets/cilium").catch(() => undefined);

  if (cilium) {
    const containers: { env?: { name: string; value?: string }[] }[] = cilium.spec?.template?.spec?.containers ?? [];
    const hubble = containers.some((container) =>
      container.env?.some((variable) => variable.name === "HUBBLE_ENABLED" && variable.value === "true"),
    );

    return { cni: "cilium", hubble };
  }

  // GKE Dataplane V2 runs Cilium as anetd.
  if (await daemonSetExists(access, "anetd", ["kube-system"])) return { cni: "cilium", hubble: false };
  if (await daemonSetExists(access, "rke2-canal", ["kube-system"])) return { cni: "canal", hubble: false };
  if (await daemonSetExists(access, "canal", ["kube-system"])) return { cni: "canal", hubble: false };
  if (await daemonSetExists(access, "calico-node", ["kube-system", "calico-system"]))
    return { cni: "calico", hubble: false };
  if (await daemonSetExists(access, "kube-flannel-ds", ["kube-system", "kube-flannel"])) {
    return { cni: "flannel", hubble: false };
  }
  if (await daemonSetExists(access, "aws-node", ["kube-system"])) return { cni: "vpc-cni", hubble: false };
  if (await daemonSetExists(access, "azure-cni", ["kube-system"])) return { cni: "azure-cni", hubble: false };
  if (platform === "gke") return { cni: "gke-native", hubble: false };

  return { cni: "unknown", hubble: false };
}

export async function detectClusterInfo(access: ClusterAccess): Promise<ClusterInfo> {
  const [node] = await access.list("/api/v1/nodes?limit=1").catch(() => [] as KubeObjectJson[]);
  const version = await access.get<{ gitVersion?: string }>("/version").catch(() => undefined);
  const platform = platformOfNode(node, version?.gitVersion);
  const { cni, hubble } = await detectCni(access, platform);

  return { platform, cni, dataplaneV2: hubble };
}

const carettaDocs = "https://github.com/groundcover-com/caretta";
const carettaChart = {
  repo: "groundcover",
  repoUrl: "https://helm.groundcover.com/",
  chartName: "caretta",
  values: "resources:\n  limits:\n    memory: 512Mi\n",
};

const cniTitles: Record<string, string> = {
  calico: "Calico",
  canal: "Canal",
  flannel: "Flannel",
  "vpc-cni": "the AWS VPC CNI on EKS",
  "azure-cni": "Azure CNI on AKS",
};

/** What to install for traffic visibility, given the cluster and what detection found; nothing when a source works. */
export function recommend(info: ClusterInfo, detected: readonly SourceStatus[]): Recommendation | undefined {
  if (detected.some((status) => status.status === "available")) {
    return undefined;
  }

  if (info.cni === "cilium") {
    // Hubble is installed but unusable: its message says what to fix.
    if (detected.some((status) => status.name === "hubble" && status.status === "present")) {
      return undefined;
    }

    if (info.platform === "gke") {
      return {
        name: "hubble",
        reason: "This GKE cluster runs Cilium (Dataplane V2). Turn on its observability to get Hubble flows.",
        installCommand:
          "gcloud container clusters update CLUSTER_NAME --location=LOCATION --enable-dataplane-v2-observability",
        docsUrl: "https://cloud.google.com/kubernetes-engine/docs/how-to/dataplane-v2-observability",
      };
    }

    return {
      name: "hubble",
      reason: "The cluster uses the Cilium CNI. Turn on Hubble, its flow API, for traffic visibility with L7 detail.",
      installCommand: "cilium hubble enable --ui",
      docsUrl: "https://docs.cilium.io/en/stable/gettingstarted/hubble/",
    };
  }

  const on = cniTitles[info.cni] ?? (info.platform === "generic" ? "this cluster" : info.platform);

  return {
    name: "caretta",
    reason: `Caretta provides lightweight eBPF-based traffic visibility for ${on}, without changing the network of the cluster.`,
    docsUrl: carettaDocs,
    helmChart: carettaChart,
    installCommand: `helm repo add ${carettaChart.repo} ${carettaChart.repoUrl} && helm install caretta ${carettaChart.repo}/${carettaChart.chartName} --namespace caretta --create-namespace --set resources.limits.memory=512Mi`,
    ...(info.cni === "gke-native"
      ? {
          alternativeName: "hubble" as const,
          alternativeReason: "GKE Dataplane V2 runs Cilium, whose observability gives Hubble flows with L7 detail.",
          alternativeDocsUrl: "https://cloud.google.com/kubernetes-engine/docs/how-to/dataplane-v2",
        }
      : {}),
  };
}
