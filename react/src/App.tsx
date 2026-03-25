import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/auth/auth-context";
import AppLayout from "./components/AppLayout";
import RequireAuth from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import IngressList from "./pages/IngressList";
import BaotaSync from "./pages/BaotaSync";
import Settings from "./pages/Settings";
import AccountSettings from "./pages/account/AccountSettings";
import ClusterK8sSettings from "./pages/cluster/ClusterK8sSettings";
import ClusterLayout from "./pages/cluster/ClusterLayout";
import ClusterOverview from "./pages/cluster/ClusterOverview";
import ClusterPods from "./pages/cluster/ClusterPods";
import ClusterPodDetail from "./pages/cluster/ClusterPodDetail";
import ClusterServices from "./pages/cluster/ClusterServices";
import ClusterNamespacePicker from "./pages/cluster/ClusterNamespacePicker";
import ClusterNamespaceResourcesLayout from "./pages/cluster/ClusterNamespaceResourcesLayout";
import LegacyPodDetailRedirect from "./pages/cluster/LegacyPodDetailRedirect";
import {
  ClusterConfigMapsScoped,
  ClusterDaemonSets,
  ClusterDeploymentsScoped,
  ClusterPVCsScoped,
  ClusterStatefulSetsScoped,
} from "./pages/cluster/ClusterWorkloadPages";
import ClusterNodes from "./pages/cluster/ClusterNodes";
import VCenterList from "./pages/vcenter/VCenterList";
import VCenterHosts from "./pages/vcenter/VCenterHosts";
import VCenterHostDetail from "./pages/vcenter/VCenterHostDetail";
import VCenterVMDetail from "./pages/vcenter/VCenterVMDetail";
import VCenterSettings from "./pages/vcenter/VCenterSettings";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Setup from "./pages/Setup";
import SetupGate from "./components/SetupGate";
import { Toaster } from "sonner";

const queryClient = new QueryClient();

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Toaster position="top-center" richColors closeButton />
        <BrowserRouter>
          <Routes>
            <Route element={<SetupGate />}>
              <Route path="/setup" element={<Setup />} />
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="ingress" element={<IngressList />} />
                <Route path="baota" element={<BaotaSync />} />
                <Route path="settings" element={<Settings />} />
                <Route path="account/settings" element={<AccountSettings />} />
                <Route path="cluster" element={<ClusterLayout />}>
                  <Route index element={<ClusterOverview />} />
                  <Route path="ns" element={<ClusterNamespacePicker />} />
                  <Route path="ns/:namespace" element={<ClusterNamespaceResourcesLayout />}>
                    <Route index element={<Navigate to="pods" replace />} />
                    <Route path="pods/:podName" element={<ClusterPodDetail />} />
                    <Route path="pods" element={<ClusterPods />} />
                    <Route path="deployments" element={<ClusterDeploymentsScoped />} />
                    <Route path="statefulsets" element={<ClusterStatefulSetsScoped />} />
                    <Route path="services" element={<ClusterServices />} />
                    <Route path="pvcs" element={<ClusterPVCsScoped />} />
                    <Route path="configmaps" element={<ClusterConfigMapsScoped />} />
                  </Route>
                  <Route
                    path="pods/:namespace/:podName"
                    element={<LegacyPodDetailRedirect />}
                  />
                  <Route
                    path="pods"
                    element={<Navigate to="/cluster/ns?resource=pods" replace />}
                  />
                  <Route
                    path="statefulsets"
                    element={
                      <Navigate to="/cluster/ns?resource=statefulsets" replace />
                    }
                  />
                  <Route
                    path="services"
                    element={<Navigate to="/cluster/ns?resource=services" replace />}
                  />
                  <Route
                    path="pvcs"
                    element={<Navigate to="/cluster/ns?resource=pvcs" replace />}
                  />
                  <Route
                    path="configmaps"
                    element={
                      <Navigate to="/cluster/ns?resource=configmaps" replace />
                    }
                  />
                  <Route
                    path="deployments"
                    element={<Navigate to="/cluster/ns?resource=deployments" replace />}
                  />
                  <Route path="daemonsets" element={<ClusterDaemonSets />} />
                  <Route path="nodes" element={<ClusterNodes />} />
                  <Route path="settings" element={<ClusterK8sSettings />} />
                  <Route path="vcenter/hosts/:moref" element={<VCenterHostDetail />} />
                  <Route path="vcenter/hosts" element={<VCenterHosts />} />
                  <Route path="vcenter/settings" element={<VCenterSettings />} />
                  <Route path="vcenter" element={<VCenterList />} />
                  <Route path="vcenter/:moref" element={<VCenterVMDetail />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
