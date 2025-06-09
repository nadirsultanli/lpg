import React from 'react';
import { DivideIcon as LucideIcon } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: LucideIcon;
  loading?: boolean;
}

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  change,
  changeType = 'neutral',
  icon: Icon,
  loading = false
}) => {
  const changeColors = {
    positive: 'text-green-600',
    negative: 'text-red-600',
    neutral: 'text-gray-600'
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <div className="mt-2 flex items-baseline">
            {loading ? (
              <div className="animate-pulse bg-gray-200 h-8 w-20 rounded" />
            ) : (
              <p className="text-3xl font-semibold text-gray-900">{value}</p>
            )}
            {change && !loading && (
              <p className={`ml-2 text-sm ${changeColors[changeType]}`}>
                {change}
              </p>
            )}
          </div>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
          <Icon className="h-6 w-6 text-blue-600" />
        </div>
      </div>
    </div>
  );
};