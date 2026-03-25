import React from "react";
import SettingsRuntimeSection from "@/pages/SettingsRuntimeSection";

const VCenterSettings: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl pb-12">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">vCenter 设置</h1>
        <p className="text-sm text-gray-500">vCenter 连接与虚拟机 SSH 默认凭据。</p>
      </div>
      <SettingsRuntimeSection variant="vcenter" />
    </div>
  );
};

export default VCenterSettings;
