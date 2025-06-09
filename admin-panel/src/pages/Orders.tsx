import React, { useState } from 'react';
import { Package, Filter, Calendar, Phone, MapPin } from 'lucide-react';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { useSupabaseQuery, useSupabaseMutation } from '../hooks/useSupabase';
import { orderQueries } from '../utils/supabase';
import { formatCurrency, formatDate, getOrderStatusColor } from '../utils/formatting';
import { Order } from '../types';

const statusOptions = [
  { value: '', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const Orders: React.FC = () => {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const { data: orders, loading: ordersLoading, refetch } = useSupabaseQuery<Order[]>(
    () => orderQueries.getAll(),
    []
  );

  const { mutate, loading: mutating } = useSupabaseMutation();

  // Filter orders based on status and date
  const filteredOrders = orders?.filter(order => {
    if (statusFilter && order.status !== statusFilter) return false;
    
    if (dateFilter) {
      const orderDate = new Date(order.created_at);
      const today = new Date();
      
      switch (dateFilter) {
        case 'today':
          return orderDate.toDateString() === today.toDateString();
        case 'week':
          const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
          return orderDate >= weekAgo;
        case 'month':
          const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
          return orderDate >= monthAgo;
        default:
          return true;
      }
    }
    
    return true;
  }) || [];

  const columns = [
    {
      key: 'id',
      title: 'Order ID',
      render: (value: string) => (
        <span className="font-mono text-sm text-gray-600">#{value.slice(-8)}</span>
      )
    },
    {
      key: 'customer',
      title: 'Customer',
      render: (customer: any, row: Order) => (
        <div>
          <p className="font-medium text-gray-900">{customer?.name || 'Unknown'}</p>
          <p className="text-sm text-gray-500">{customer?.phone}</p>
        </div>
      )
    },
    {
      key: 'cylinder_size',
      title: 'Product',
      render: (size: string, row: Order) => (
        <div className="flex items-center space-x-2">
          <Package className="h-4 w-4 text-gray-400" />
          <span>{row.quantity}x {size}</span>
        </div>
      )
    },
    {
      key: 'total_amount_kes',
      title: 'Total',
      render: (amount: number) => (
        <span className="font-medium text-gray-900">{formatCurrency(amount)}</span>
      )
    },
    {
      key: 'status',
      title: 'Status',
      render: (status: string) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getOrderStatusColor(status)}`}>
          {status.replace('_', ' ')}
        </span>
      )
    },
    {
      key: 'delivery_date',
      title: 'Delivery Date',
      render: (date: string) => (
        <div className="flex items-center space-x-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <span className="text-sm">{formatDate(date)}</span>
        </div>
      )
    },
    {
      key: 'created_at',
      title: 'Created',
      render: (date: string) => (
        <span className="text-sm text-gray-600">{formatDate(date)}</span>
      )
    }
  ];

  const handleRowClick = (order: Order) => {
    setSelectedOrder(order);
    setIsDetailModalOpen(true);
  };

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    const result = await mutate(() => 
      orderQueries.update(orderId, { 
        status: newStatus,
        updated_at: new Date().toISOString()
      })
    );

    if (result.success) {
      refetch();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus as any });
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Orders</h2>
          <p className="text-gray-600">Track and manage customer orders</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">Filters:</span>
          </div>
          
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {statusOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>

          {(statusFilter || dateFilter) && (
            <button
              onClick={() => {
                setStatusFilter('');
                setDateFilter('');
              }}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <DataTable
        data={filteredOrders}
        columns={columns}
        loading={ordersLoading}
        searchable
        exportable
        onRowClick={handleRowClick}
      />

      {/* Order Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Order Details"
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-6">
            {/* Order Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  Order #{selectedOrder.id.slice(-8)}
                </h3>
                <p className="text-gray-600">Created {formatDate(selectedOrder.created_at)}</p>
              </div>
              <div className="flex items-center space-x-3">
                <select
                  value={selectedOrder.status}
                  onChange={(e) => handleStatusUpdate(selectedOrder.id, e.target.value)}
                  disabled={mutating}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="out_for_delivery">Out for Delivery</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            {/* Customer Information */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-3">Customer Information</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <p className="text-sm text-gray-900">{selectedOrder.customer?.name || 'Unknown'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <div className="flex items-center space-x-2">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-900">{selectedOrder.customer?.phone}</span>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <div className="flex items-center space-x-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-900">{selectedOrder.customer?.address}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Order Details */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-3">Order Details</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Product:</span>
                  <span className="text-sm font-medium text-gray-900">
                    {selectedOrder.quantity}x {selectedOrder.cylinder_size}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Unit Price:</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(selectedOrder.price_kes)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-sm font-medium text-gray-900">Total Amount:</span>
                  <span className="text-lg font-bold text-gray-900">
                    {formatCurrency(selectedOrder.total_amount_kes)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Delivery Date:</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatDate(selectedOrder.delivery_date)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Status:</span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getOrderStatusColor(selectedOrder.status)}`}>
                    {selectedOrder.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {selectedOrder.notes && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Notes</h4>
                <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                  {selectedOrder.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};