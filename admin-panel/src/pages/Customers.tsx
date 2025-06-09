import React, { useState } from 'react';
import { Plus, MapPin, Phone, Mail, Calendar } from 'lucide-react';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { useSupabaseQuery, useSupabaseMutation } from '../hooks/useSupabase';
import { customerQueries, orderQueries } from '../utils/supabase';
import { formatPhone, formatDate, formatRelativeTime } from '../utils/formatting';
import { Customer, Order } from '../types';
import { useForm } from 'react-hook-form';

interface CustomerFormData {
  name: string;
  phone: string;
  email?: string;
  address: string;
  gps_lat?: number;
  gps_lon?: number;
}

export const Customers: React.FC = () => {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const { data: customers, loading: customersLoading, refetch } = useSupabaseQuery<Customer[]>(
    () => customerQueries.getAll(),
    []
  );

  const { data: customerOrders, loading: ordersLoading } = useSupabaseQuery<Order[]>(
    () => selectedCustomer ? orderQueries.getByCustomer(selectedCustomer.id) : Promise.resolve({ data: [], error: null }),
    [selectedCustomer?.id]
  );

  const { mutate, loading: mutating } = useSupabaseMutation();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CustomerFormData>();

  const columns = [
    {
      key: 'name',
      title: 'Name',
      sortable: true,
      render: (value: string, row: Customer) => (
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-sm font-medium text-blue-600">
              {value.split(' ').map(n => n[0]).join('').toUpperCase()}
            </span>
          </div>
          <span className="font-medium text-gray-900">{value}</span>
        </div>
      )
    },
    {
      key: 'phone',
      title: 'Phone',
      render: (value: string) => (
        <div className="flex items-center space-x-2">
          <Phone className="h-4 w-4 text-gray-400" />
          <span>{formatPhone(value)}</span>
        </div>
      )
    },
    {
      key: 'email',
      title: 'Email',
      render: (value: string) => value ? (
        <div className="flex items-center space-x-2">
          <Mail className="h-4 w-4 text-gray-400" />
          <span>{value}</span>
        </div>
      ) : (
        <span className="text-gray-400">—</span>
      )
    },
    {
      key: 'address',
      title: 'Address',
      render: (value: string) => (
        <div className="flex items-center space-x-2">
          <MapPin className="h-4 w-4 text-gray-400" />
          <span className="truncate max-w-xs">{value}</span>
        </div>
      )
    },
    {
      key: 'total_orders',
      title: 'Total Orders',
      render: (value: number = 0) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          {value}
        </span>
      )
    },
    {
      key: 'created_at',
      title: 'Joined',
      render: (value: string) => (
        <div className="flex items-center space-x-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-600">{formatDate(value)}</span>
        </div>
      )
    }
  ];

  const handleRowClick = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsDetailModalOpen(true);
  };

  const handleAddCustomer = () => {
    setEditingCustomer(null);
    reset();
    setIsFormModalOpen(true);
  };

  const handleEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    reset({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || '',
      address: customer.address,
      gps_lat: customer.gps_lat,
      gps_lon: customer.gps_lon,
    });
    setIsFormModalOpen(true);
  };

  const onSubmit = async (data: CustomerFormData) => {
    const customerData = {
      ...data,
      updated_at: new Date().toISOString(),
      ...(editingCustomer ? {} : { created_at: new Date().toISOString() })
    };

    const result = editingCustomer
      ? await mutate(() => customerQueries.update(editingCustomer.id, customerData))
      : await mutate(() => customerQueries.create(customerData));

    if (result.success) {
      setIsFormModalOpen(false);
      refetch();
      reset();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
          <p className="text-gray-600">Manage your customer database</p>
        </div>
        <button
          onClick={handleAddCustomer}
          className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Add Customer</span>
        </button>
      </div>

      {/* Data Table */}
      <DataTable
        data={customers || []}
        columns={columns}
        loading={customersLoading}
        searchable
        exportable
        onRowClick={handleRowClick}
      />

      {/* Customer Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Customer Details"
        size="lg"
      >
        {selectedCustomer && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-4">
                <div className="h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-xl font-bold text-blue-600">
                    {selectedCustomer.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedCustomer.name}</h3>
                  <p className="text-gray-600">{formatPhone(selectedCustomer.phone)}</p>
                  {selectedCustomer.email && (
                    <p className="text-gray-600">{selectedCustomer.email}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleEditCustomer(selectedCustomer)}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
              >
                Edit
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <p className="text-sm text-gray-900">{selectedCustomer.address}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Member Since</label>
                <p className="text-sm text-gray-900">{formatDate(selectedCustomer.created_at)}</p>
              </div>
            </div>

            {/* Order History */}
            <div>
              <h4 className="text-lg font-medium text-gray-900 mb-4">Order History</h4>
              {ordersLoading ? (
                <div className="animate-pulse space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 bg-gray-200 rounded" />
                  ))}
                </div>
              ) : customerOrders && customerOrders.length > 0 ? (
                <div className="space-y-3">
                  {customerOrders.slice(0, 5).map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">
                          {order.quantity}x {order.cylinder_size}
                        </p>
                        <p className="text-sm text-gray-600">
                          {formatDate(order.created_at)} • KES {order.total_amount_kes.toLocaleString()}
                        </p>
                      </div>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No orders yet</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Customer Form Modal */}
      <Modal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={editingCustomer ? 'Edit Customer' : 'Add Customer'}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              {...register('name', { required: 'Name is required' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.name && (
              <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone *
            </label>
            <input
              type="tel"
              {...register('phone', { required: 'Phone is required' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.phone && (
              <p className="text-red-500 text-sm mt-1">{errors.phone.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              {...register('email')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address *
            </label>
            <textarea
              {...register('address', { required: 'Address is required' })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.address && (
              <p className="text-red-500 text-sm mt-1">{errors.address.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GPS Latitude
              </label>
              <input
                type="number"
                step="any"
                {...register('gps_lat')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GPS Longitude
              </label>
              <input
                type="number"
                step="any"
                {...register('gps_lon')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={() => setIsFormModalOpen(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutating}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {mutating ? 'Saving...' : (editingCustomer ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};