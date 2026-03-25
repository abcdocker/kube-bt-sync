import React from "react";
import SettingsRuntimeSection from "@/pages/SettingsRuntimeSection";

const AccountSettings: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl pb-12">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">账户与平台</h1>
        <p className="text-sm text-gray-500">
          仅平台层配置（数据库、Redis、宝塔、登录与 OIDC），与 Kubernetes / vCenter 集群菜单独立。保存后写入{" "}
          <code className="text-xs">runtime-config.json</code> 并热重载。
        </p>
      </div>
      <SettingsRuntimeSection variant="account" />
    </div>
  );
};

export default AccountSettings;
