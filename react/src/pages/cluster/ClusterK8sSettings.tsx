import React from "react";
import SettingsPrometheusSection from "@/pages/SettingsPrometheusSection";
import SettingsRuntimeSection from "@/pages/SettingsRuntimeSection";

const ClusterK8sSettings: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">Cluster settings</h1>
        <p className="text-sm text-gray-500">
          Kubernetes API connection and Prometheus. Saved to <code className="text-xs">runtime-config.json</code>.
        </p>
      </div>
      <SettingsRuntimeSection variant="k8s" />
      <SettingsPrometheusSection locale="en" />
    </div>
  );
};

export default ClusterK8sSettings;
