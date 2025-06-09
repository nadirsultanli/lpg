import React, { useState } from 'react';
import { Phone, Clock, User, FileText } from 'lucide-react';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { useSupabaseQuery } from '../hooks/useSupabase';
import { callQueries } from '../utils/supabase';
import { formatDuration, formatDateTime, formatPhone } from '../utils/formatting';
import { CallSummary } from '../types';

export const CallLogs: React.FC = () => {
  const [selectedCall, setSelectedCall] = useState<CallSummary | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const { data: calls, loading: callsLoading } = useSupabaseQuery<CallSummary[]>(
    () => callQueries.getAll(),
    []
  );

  const columns = [
    {
      key: 'call_id',
      title: 'Call ID',
      render: (value: string) => (
        <span className="font-mono text-sm text-gray-600">#{value.slice(-8)}</span>
      )
    },
    {
      key: 'phone_number',
      title: 'Phone Number',
      render: (value: string) => (
        <div className="flex items-center space-x-2">
          <Phone className="h-4 w-4 text-gray-400" />
          <span>{formatPhone(value)}</span>
        </div>
      )
    },
    {
      key: 'customer',
      title: 'Customer',
      render: (customer: any) => customer ? (
        <div className="flex items-center space-x-2">
          <User className="h-4 w-4 text-gray-400" />
          <span>{customer.name}</span>
        </div>
      ) : (
        <span className="text-gray-400">Unknown</span>
      )
    },
    {
      key: 'duration_seconds',
      title: 'Duration',
      render: (value: number) => (
        <div className="flex items-center space-x-2">
          <Clock className="h-4 w-4 text-gray-400" />
          <span>{formatDuration(value)}</span>
        </div>
      )
    },
    {
      key: 'ended_reason',
      title: 'End Reason',
      render: (value: string) => {
        const getReasonColor = (reason: string) => {
          switch (reason.toLowerCase()) {
            case 'completed': return 'bg-green-100 text-green-800';
            case 'hung_up': return 'bg-red-100 text-red-800';
            case 'no_answer': return 'bg-yellow-100 text-yellow-800';
            case 'busy': return 'bg-orange-100 text-orange-800';
            default: return 'bg-gray-100 text-gray-800';
          }
        };

        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getReasonColor(value)}`}>
            {value.replace('_', ' ')}
          </span>
        );
      }
    },
    {
      key: 'tool_calls',
      title: 'Tools Used',
      render: (value: any) => {
        const toolCount = value ? Object.keys(value).length : 0;
        return toolCount > 0 ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            {toolCount} tools
          </span>
        ) : (
          <span className="text-gray-400">None</span>
        );
      }
    },
    {
      key: 'created_at',
      title: 'Date & Time',
      render: (value: string) => (
        <span className="text-sm text-gray-600">{formatDateTime(value)}</span>
      )
    }
  ];

  const handleRowClick = (call: CallSummary) => {
    setSelectedCall(call);
    setIsDetailModalOpen(true);
  };

  // Calculate analytics
  const totalCalls = calls?.length || 0;
  const avgDuration = calls?.length ? 
    calls.reduce((sum, call) => sum + call.duration_seconds, 0) / calls.length : 0;
  const completedCalls = calls?.filter(call => call.ended_reason === 'completed').length || 0;
  const successRate = totalCalls > 0 ? (completedCalls / totalCalls * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Call Analytics</h2>
          <p className="text-gray-600">Monitor and analyze voice call performance</p>
        </div>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Calls</p>
              <p className="text-3xl font-semibold text-gray-900">{totalCalls}</p>
            </div>
            <Phone className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Duration</p>
              <p className="text-3xl font-semibold text-gray-900">{formatDuration(Math.round(avgDuration))}</p>
            </div>
            <Clock className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Success Rate</p>
              <p className="text-3xl font-semibold text-gray-900">{successRate}%</p>
            </div>
            <FileText className="h-8 w-8 text-purple-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Completed</p>
              <p className="text-3xl font-semibold text-gray-900">{completedCalls}</p>
            </div>
            <User className="h-8 w-8 text-orange-600" />
          </div>
        </div>
      </div>

      {/* Data Table */}
      <DataTable
        data={calls || []}
        columns={columns}
        loading={callsLoading}
        searchable
        exportable
        onRowClick={handleRowClick}
      />

      {/* Call Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Call Details"
        size="xl"
      >
        {selectedCall && (
          <div className="space-y-6">
            {/* Call Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  Call #{selectedCall.call_id.slice(-8)}
                </h3>
                <p className="text-gray-600">{formatDateTime(selectedCall.created_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">Duration</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatDuration(selectedCall.duration_seconds)}
                </p>
              </div>
            </div>

            {/* Call Information */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-3">Call Information</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <p className="text-sm text-gray-900">{formatPhone(selectedCall.phone_number)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                  <p className="text-sm text-gray-900">
                    {selectedCall.customer?.name || 'Unknown Customer'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Reason</label>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    selectedCall.ended_reason === 'completed' ? 'bg-green-100 text-green-800' :
                    selectedCall.ended_reason === 'hung_up' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {selectedCall.ended_reason.replace('_', ' ')}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tools Used</label>
                  <p className="text-sm text-gray-900">
                    {selectedCall.tool_calls ? Object.keys(selectedCall.tool_calls).length : 0} tools
                  </p>
                </div>
              </div>
            </div>

            {/* Call Summary */}
            {selectedCall.summary && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Call Summary</h4>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-900">{selectedCall.summary}</p>
                </div>
              </div>
            )}

            {/* Full Transcript */}
            {selectedCall.transcript && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Full Transcript</h4>
                <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                  <pre className="text-sm text-gray-900 whitespace-pre-wrap font-sans">
                    {selectedCall.transcript}
                  </pre>
                </div>
              </div>
            )}

            {/* Tool Calls */}
            {selectedCall.tool_calls && Object.keys(selectedCall.tool_calls).length > 0 && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Tool Calls</h4>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono">
                    {JSON.stringify(selectedCall.tool_calls, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};