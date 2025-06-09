import React from 'react';
import { Users, Package, DollarSign, Phone, TrendingUp, Clock } from 'lucide-react';
import { KPICard } from '../components/common/KPICard';
import { OrdersChart } from '../components/charts/OrdersChart';
import { RevenueChart } from '../components/charts/RevenueChart';
import { useSupabaseQuery } from '../hooks/useSupabase';
import { orderQueries, customerQueries, callQueries } from '../utils/supabase';
import { formatCurrency, formatRelativeTime, getOrderStatusColor } from '../utils/formatting';
import { Order, Customer, CallSummary } from '../types';

// Mock data for charts
const ordersData = [
  { date: '2024-01-15', orders: 12 },
  { date: '2024-01-16', orders: 19 },
  { date: '2024-01-17', orders: 8 },
  { date: '2024-01-18', orders: 15 },
  { date: '2024-01-19', orders: 22 },
  { date: '2024-01-20', orders: 18 },
  { date: '2024-01-21', orders: 25 },
];

const revenueData = [
  { date: '2024-01-15', revenue: 45000 },
  { date: '2024-01-16', revenue: 52000 },
  { date: '2024-01-17', revenue: 38000 },
  { date: '2024-01-18', revenue: 61000 },
  { date: '2024-01-19', revenue: 73000 },
  { date: '2024-01-20', revenue: 55000 },
  { date: '2024-01-21', revenue: 68000 },
];

export const Dashboard: React.FC = () => {
  const { data: customers, loading: customersLoading } = useSupabaseQuery<Customer[]>(
    () => customerQueries.getAll(),
    []
  );
  
  const { data: orders, loading: ordersLoading } = useSupabaseQuery<Order[]>(
    () => orderQueries.getAll(),
    []
  );
  
  const { data: calls, loading: callsLoading } = useSupabaseQuery<CallSummary[]>(
    () => callQueries.getAll(),
    []
  );

  // Calculate KPIs
  const totalCustomers = customers?.length || 0;
  const today = new Date().toISOString().split('T')[0];
  const ordersToday = orders?.filter(order => 
    order.created_at.startsWith(today)
  ).length || 0;
  const revenueToday = orders?.filter(order => 
    order.created_at.startsWith(today)
  ).reduce((sum, order) => sum + order.total_amount_kes, 0) || 0;
  const activeCalls = calls?.filter(call => 
    call.ended_reason === 'active'
  ).length || 0;

  // Recent orders
  const recentOrders = orders?.slice(0, 5) || [];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Total Customers"
          value={totalCustomers}
          icon={Users}
          loading={customersLoading}
        />
        <KPICard
          title="Orders Today"
          value={ordersToday}
          change="+12%"
          changeType="positive"
          icon={Package}
          loading={ordersLoading}
        />
        <KPICard
          title="Revenue Today"
          value={formatCurrency(revenueToday)}
          change="+8%"
          changeType="positive"
          icon={DollarSign}
          loading={ordersLoading}
        />
        <KPICard
          title="Active Calls"
          value={activeCalls}
          icon={Phone}
          loading={callsLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrdersChart data={ordersData} />
        <RevenueChart data={revenueData} />
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">Recent Orders</h3>
              <TrendingUp className="h-5 w-5 text-gray-400" />
            </div>
          </div>
          <div className="p-6">
            {ordersLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex items-center space-x-4">
                      <div className="h-10 w-10 bg-gray-200 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-3/4" />
                        <div className="h-3 bg-gray-200 rounded w-1/2" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : recentOrders.length > 0 ? (
              <div className="space-y-4">
                {recentOrders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <Package className="h-4 w-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {order.customer?.name || 'Unknown Customer'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {order.quantity}x {order.cylinder_size} • {formatCurrency(order.total_amount_kes)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getOrderStatusColor(order.status)}`}>
                        {order.status.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatRelativeTime(order.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No recent orders</p>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">Quick Actions</h3>
              <Clock className="h-5 w-5 text-gray-400" />
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors">
                <Users className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-900">Add Customer</p>
              </button>
              <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors">
                <Package className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-900">View Orders</p>
              </button>
              <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors">
                <Phone className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-900">Call Logs</p>
              </button>
              <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors">
                <DollarSign className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-900">Revenue Report</p>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};