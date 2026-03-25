import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  icon: LucideIcon;
  color: 'blue' | 'green' | 'purple' | 'orange';
}

const StatCard: React.FC<StatCardProps> = ({ title, value, trend, trendUp, icon: Icon, color }) => {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100'
  };

  return (
    <div data-cmp="StatCard" className="bg-white rounded-2xl p-6 border border-gray-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-shadow duration-300">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-xl border ${colorMap[color]}`}>
          <Icon size={24} />
        </div>
        {trend && (
          <div className={`px-2.5 py-1 rounded-full text-xs font-semibold ${trendUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {trendUp ? '+' : '-'}{trend}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-gray-500 text-sm font-medium mb-1">{title}</h3>
        <div className="text-3xl font-bold text-gray-900 tracking-tight">{value}</div>
      </div>
    </div>
  );
};

export default StatCard;