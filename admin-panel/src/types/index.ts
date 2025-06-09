export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  gps_lat?: number;
  gps_lon?: number;
  created_at: string;
  updated_at: string;
  total_orders?: number;
  last_order_date?: string;
}

export interface Order {
  id: string;
  customer_id: string;
  cylinder_size: '6kg' | '13kg';
  quantity: number;
  price_kes: number;
  total_amount_kes: number;
  delivery_date: string;
  status: 'pending' | 'confirmed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  notes?: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
}

export interface CallSummary {
  id: string;
  call_id: string;
  phone_number: string;
  customer_id?: string;
  duration_seconds: number;
  transcript?: string;
  summary?: string;
  ended_reason: string;
  tool_calls?: any;
  created_at: string;
  customer?: Customer;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'operator';
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KPIData {
  totalCustomers: number;
  ordersToday: number;
  revenueToday: number;
  activeCalls: number;
}