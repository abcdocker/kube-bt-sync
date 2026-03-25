import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";

const AppLayout: React.FC = () => {
  return (
    <div
      data-cmp="AppLayout"
      className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-[#F1F5F9] font-sans"
    >
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-white shadow-custom">
        <Sidebar />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <Header />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <div className="app-main-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8">
              <div className="mx-auto w-full max-w-[1920px] min-w-0 flex-1">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
