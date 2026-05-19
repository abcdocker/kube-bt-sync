import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DnsDashboard from "./DnsDashboard";
import DnsAccounts from "./DnsAccounts";
import DnsDomains from "./DnsDomains";
import DnsRecords from "./DnsRecords";
import DnsFailover from "./DnsFailover";
import DnsScheduled from "./DnsScheduled";
import DnsCerts from "./DnsCerts";

const DnsLayout: React.FC = () => {
  return (
    <div className="mx-auto w-full max-w-[min(100%,80rem)] space-y-4 px-3 pb-10 pt-3 sm:px-4 sm:pt-4 lg:px-8">
      <Routes>
        <Route index element={<DnsDashboard />} />
        <Route path="accounts" element={<DnsAccounts />} />
        <Route path="domains" element={<DnsDomains />} />
        <Route path="records" element={<DnsRecords />} />
        <Route path="failover" element={<DnsFailover />} />
        <Route path="scheduled" element={<DnsScheduled />} />
        <Route path="certs" element={<DnsCerts />} />
        <Route path="*" element={<Navigate to="/cluster/apps/dns" replace />} />
      </Routes>
    </div>
  );
};

export default DnsLayout;
