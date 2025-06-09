import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Database query functions
export const customerQueries = {
  getAll: () => supabase.from('customers').select('*').order('created_at', { ascending: false }),
  getById: (id: string) => supabase.from('customers').select('*').eq('id', id).single(),
  create: (customer: any) => supabase.from('customers').insert(customer),
  update: (id: string, customer: any) => supabase.from('customers').update(customer).eq('id', id),
  delete: (id: string) => supabase.from('customers').delete().eq('id', id),
};

export const orderQueries = {
  getAll: () => supabase
    .from('orders')
    .select(`
      *,
      customer:customers(name, phone, email)
    `)
    .order('created_at', { ascending: false }),
  getById: (id: string) => supabase
    .from('orders')
    .select(`
      *,
      customer:customers(*)
    `)
    .eq('id', id)
    .single(),
  create: (order: any) => supabase.from('orders').insert(order),
  update: (id: string, order: any) => supabase.from('orders').update(order).eq('id', id),
  delete: (id: string) => supabase.from('orders').delete().eq('id', id),
  getByCustomer: (customerId: string) => supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false }),
};

export const callQueries = {
  getAll: () => supabase
    .from('call_summaries')
    .select(`
      *,
      customer:customers(name, phone)
    `)
    .order('created_at', { ascending: false }),
  getById: (id: string) => supabase
    .from('call_summaries')
    .select(`
      *,
      customer:customers(*)
    `)
    .eq('id', id)
    .single(),
};

export const adminQueries = {
  getAll: () => supabase.from('admin_users').select('*').order('created_at', { ascending: false }),
  create: (admin: any) => supabase.from('admin_users').insert(admin),
  update: (id: string, admin: any) => supabase.from('admin_users').update(admin).eq('id', id),
  delete: (id: string) => supabase.from('admin_users').delete().eq('id', id),
};