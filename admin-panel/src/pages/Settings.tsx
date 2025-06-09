import React, { useState } from 'react';
import { Users, Settings as SettingsIcon, Activity, DollarSign, Clock, MapPin } from 'lucide-react';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { useSupabaseQuery, useSupabaseMutation } from '../hooks/useSupabase';
import { adminQueries } from '../utils/supabase';
import { formatDate } from '../utils/formatting';
import { AdminUser } from '../types';
import { useForm } from 'react-hook-form';

interface AdminFormData {
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'operator';
  active: boolean;
}

export const Settings: React.FC = () => {
  const [selectedSection, setSelectedSection] = useState('admins');
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);

  const { data: admins, loading: adminsLoading, refetch } = useSupabaseQuery<AdminUser[]>(
    () => adminQueries.getAll(),
    []
  );

  const { mutate, loading: mutating } = useSupabaseMutation();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AdminFormData>();

  const adminColumns = [
    {
      key: 'name',
      title: 'Name',
      render: (value: string, row: AdminUser) => (
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
      key: 'email',
      title: 'Email',
      render: (value: string) => (
        <span className="text-gray-900">{value}</span>
      )
    },
    {
      key: 'role',
      title: 'Role',
      render: (value: string) => {
        const roleColors = {
          admin: 'bg-purple-100 text-purple-800',
          manager: 'bg-blue-100 text-blue-800',
          operator: 'bg-green-100 text-green-800'
        };
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleColors[value as keyof typeof roleColors]}`}>
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </span>
        );
      }
    },
    {
      key: 'active',
      title: 'Status',
      render: (value: boolean) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {value ? 'Active' : 'Inactive'}
        </span>
      )
    },
    {
      key: 'created_at',
      title: 'Created',
      render: (value: string) => (
        <span className="text-sm text-gray-600">{formatDate(value)}</span>
      )
    }
  ];

  const handleAddAdmin = () => {
    setEditingAdmin(null);
    reset({
      name: '',
      email: '',
      role: 'operator',
      active: true
    });
    setIsAdminModalOpen(true);
  };

  const handleEditAdmin = (admin: AdminUser) => {
    setEditingAdmin(admin);
    reset({
      name: admin.name,
      email: admin.email,
      role: admin.role,
      active: admin.active
    });
    setIsAdminModalOpen(true);
  };

  const onSubmitAdmin = async (data: AdminFormData) => {
    const adminData = {
      ...data,
      updated_at: new Date().toISOString(),
      ...(editingAdmin ? {} : { created_at: new Date().toISOString() })
    };

    const result = editingAdmin
      ? await mutate(() => adminQueries.update(editingAdmin.id, adminData))
      : await mutate(() => adminQueries.create(adminData));

    if (result.success) {
      setIsAdminModalOpen(false);
      refetch();
      reset();
    }
  };

  const sections = [
    { id: 'admins', name: 'Admin Users', icon: Users },
    { id: 'system', name: 'System Settings', icon: SettingsIcon },
    { id: 'pricing', name: 'Pricing', icon: DollarSign },
    { id: 'zones', name: 'Delivery Zones', icon: MapPin },
    { id: 'status', name: 'API Status', icon: Activity },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="text-gray-600">Manage system configuration and admin users</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Settings Navigation */}
        <div className="lg:col-span-1">
          <nav className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setSelectedSection(section.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2 text-left text-sm font-medium rounded-md transition-colors ${
                  selectedSection === section.id
                    ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <section.icon className="h-5 w-5" />
                <span>{section.name}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Settings Content */}
        <div className="lg:col-span-3">
          {selectedSection === 'admins' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Admin Users</h3>
                <button
                  onClick={handleAddAdmin}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Add Admin
                </button>
              </div>
              
              <DataTable
                data={admins || []}
                columns={adminColumns}
                loading={adminsLoading}
                searchable
                onRowClick={handleEditAdmin}
              />
            </div>
          )}

          {selectedSection === 'system' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">System Settings</h3>
              
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Business Hours
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Open Time</label>
                        <input
                          type="time"
                          defaultValue="08:00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Close Time</label>
                        <input
                          type="time"
                          defaultValue="18:00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Default Delivery Time (Hours)
                    </label>
                    <input
                      type="number"
                      defaultValue="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedSection === 'pricing' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Pricing Configuration</h3>
              
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        6kg Cylinder Price (KES)
                      </label>
                      <input
                        type="number"
                        defaultValue="1500"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        13kg Cylinder Price (KES)
                      </label>
                      <input
                        type="number"
                        defaultValue="2500"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Delivery Fee (KES)
                    </label>
                    <input
                      type="number"
                      defaultValue="200"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    Update Pricing
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedSection === 'zones' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Delivery Zones</h3>
              
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="space-y-4">
                  <div className="text-sm text-gray-600">
                    Configure delivery zones and their respective fees. This feature will be expanded in future updates.
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                    <div className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900">Nairobi Central</h4>
                          <p className="text-sm text-gray-600">Main delivery zone</p>
                        </div>
                        <span className="text-sm font-medium text-green-600">Active</span>
                      </div>
                    </div>
                    
                    <div className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900">Westlands</h4>
                          <p className="text-sm text-gray-600">Extended delivery zone</p>
                        </div>
                        <span className="text-sm font-medium text-green-600">Active</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedSection === 'status' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">API Status</h3>
              
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-3 w-3 bg-green-400 rounded-full"></div>
                      <div>
                        <h4 className="font-medium text-gray-900">Supabase Database</h4>
                        <p className="text-sm text-gray-600">Database connection status</p>
                      </div>
                    </div>
                    <span className="text-sm font-medium text-green-600">Online</span>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-3 w-3 bg-green-400 rounded-full"></div>
                      <div>
                        <h4 className="font-medium text-gray-900">Voice API (Vapi)</h4>
                        <p className="text-sm text-gray-600">Voice calling service status</p>
                      </div>
                    </div>
                    <span className="text-sm font-medium text-green-600">Online</span>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-3 w-3 bg-yellow-400 rounded-full"></div>
                      <div>
                        <h4 className="font-medium text-gray-900">Redis Cache</h4>
                        <p className="text-sm text-gray-600">Caching service status</p>
                      </div>
                    </div>
                    <span className="text-sm font-medium text-yellow-600">Warning</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Admin Form Modal */}
      <Modal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        title={editingAdmin ? 'Edit Admin User' : 'Add Admin User'}
      >
        <form onSubmit={handleSubmit(onSubmitAdmin)} className="space-y-4">
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
              Email *
            </label>
            <input
              type="email"
              {...register('email', { required: 'Email is required' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {errors.email && (
              <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role *
            </label>
            <select
              {...register('role', { required: 'Role is required' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="operator">Operator</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            {errors.role && (
              <p className="text-red-500 text-sm mt-1">{errors.role.message}</p>
            )}
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              {...register('active')}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label className="ml-2 block text-sm text-gray-900">
              Active User
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={() => setIsAdminModalOpen(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutating}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {mutating ? 'Saving...' : (editingAdmin ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};