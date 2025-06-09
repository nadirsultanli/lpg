// supabase/functions/tools/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ToolCall {
  id: string;
  name?: string;
  arguments?: any;
  function?: {
    name: string;
    arguments: any;
  };
}

interface VapiRequest {
  message: {
    callId?: string;
    toolCallList?: ToolCall[];
    toolCalls?: ToolCall[];
  };
}

const PRICING = {
  "6kg": 1200,
  "13kg": 2500
};

const VALID_CYLINDER_SIZES = ["6kg", "13kg"];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const body: VapiRequest = await req.json()
    console.log('Received tool call:', JSON.stringify(body, null, 2))

    const callId = body.message?.callId
    const toolCalls = body.message?.toolCallList || body.message?.toolCalls

    if (!toolCalls || toolCalls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No tool calls in payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const toolCall = toolCalls[0]
    const toolId = toolCall.id
    const toolName = toolCall.name || toolCall.function?.name
    let params = toolCall.arguments || toolCall.function?.arguments

    if (typeof params === 'string') {
      try {
        params = JSON.parse(params)
      } catch {
        params = {}
      }
    }

    console.log(`Processing tool: ${toolName} with params:`, params)

    let result: string

    switch (toolName) {
      case 'create_customer':
        result = await handleCreateCustomer(params, supabaseClient)
        break
      case 'place_order':
        result = await handlePlaceOrder(params, supabaseClient)
        break
      case 'get_order_status':
        result = await handleGetOrderStatus(params, supabaseClient)
        break
      default:
        result = `Unknown tool: ${toolName}`
        console.error(`Unknown tool called: ${toolName}`)
    }

    console.log(`Tool ${toolName} result:`, result)

    return new Response(
      JSON.stringify({
        results: [
          { toolCallId: toolId, result: result }
        ]
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in tools function:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})

function normalizePhone(phone: string): string {
  if (!phone) return phone
  
  let normalized = phone.trim().replace(/[\s\-]/g, '')
  
  if (normalized.startsWith('0')) {
    normalized = '+254' + normalized.slice(1)
  } else if (normalized.startsWith('254') && !normalized.startsWith('+')) {
    normalized = '+' + normalized
  } else if (!normalized.startsWith('+')) {
    normalized = '+254' + normalized
  }
  
  return normalized
}

function validateCylinderSize(size: string): { valid: boolean; normalized?: string; error?: string } {
  const normalized = size.toLowerCase().trim()
  if (VALID_CYLINDER_SIZES.includes(normalized)) {
    return { valid: true, normalized }
  }
  return { valid: false, error: "Invalid cylinder size. Please choose either 6kg or 13kg." }
}

function validateQuantity(quantity: any): { valid: boolean; value?: number; error?: string } {
  try {
    const qty = parseInt(quantity)
    if (qty <= 0) {
      return { valid: false, error: "Quantity must be greater than zero." }
    }
    if (qty > 10) {
      return { valid: false, error: "For orders above 10 cylinders, please contact our sales team directly." }
    }
    return { valid: true, value: qty }
  } catch {
    return { valid: false, error: "Please provide a valid number for quantity." }
  }
}

async function handleCreateCustomer(params: any, supabase: any): Promise<string> {
  try {
    const name = params.name?.trim() || ''
    const phone = normalizePhone(params.phone || '')
    const address = params.address?.trim() || ''
    const email = params.email?.trim() || null

    console.log(`Creating customer: name=${name}, phone=${phone}, address=${address}`)

    if (!name) {
      return "I need your name to create an account. Could you please tell me your name?"
    }
    if (!phone) {
      return "I need your phone number to create an account. Could you please provide it?"
    }
    if (!address) {
      return "I need your delivery address to create an account. Could you please provide your address?"
    }

    // Check if customer already exists
    const { data: existing, error: existingError } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .single()

    if (existing && !existingError) {
      // Customer exists - return existing details WITHOUT updating
      console.log(`Found existing customer: ${existing.name} (ID: ${existing.id})`)
      return `Welcome back, ${existing.name}! I found your existing account. You're all set to place orders.`
    } 
    
    // Create new customer only if they don't exist
    console.log(`Creating new customer with phone ${phone}`)
    const { data: newCustomer, error: insertError } = await supabase
      .from('customers')
      .insert({
        name,
        phone,
        address,
        email
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating customer:', insertError)
      
      // Handle unique constraint violation (customer might exist now)
      if (insertError.code === '23505') {
        // Try to fetch the existing customer
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('*')
          .eq('phone', phone)
          .single()
        
        if (existingCustomer) {
          return `Welcome back, ${existingCustomer.name}! I found your existing account. You're all set to place orders.`
        }
      }
      
      throw insertError
    }

    console.log(`Successfully created customer: ${newCustomer.id}`)
    return `Perfect! Your account has been created successfully, ${newCustomer.name}. You can now place orders for LPG cylinders.`

  } catch (error) {
    console.error('Error in create_customer:', error)
    return `I'm sorry—there was an issue creating your account: ${error.message}. Please try again.`
  }
}

async function handlePlaceOrder(params: any, supabase: any): Promise<string> {
  try {
    const phone = normalizePhone(params.phone || '')
    
    if (!phone) {
      return "I need your phone number to place the order. Could you please provide it?"
    }

    const cylinderValidation = validateCylinderSize(params.cylinder_size || '')
    if (!cylinderValidation.valid) {
      return cylinderValidation.error!
    }

    const quantityValidation = validateQuantity(params.quantity)
    if (!quantityValidation.valid) {
      return quantityValidation.error!
    }

    const deliveryDate = params.delivery_date || null
    const notes = params.notes || ''

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .single()

    if (customerError || !customer) {
      return "I couldn't find your account. Please let me create one for you first. Could you please provide your full name and delivery address?"
    }

    const unitPrice = PRICING[cylinderValidation.normalized as keyof typeof PRICING]
    const totalAmount = unitPrice * quantityValidation.value!

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: customer.id,
        cylinder_size: cylinderValidation.normalized,
        quantity: quantityValidation.value,
        price_kes: unitPrice,
        total_amount_kes: totalAmount,
        delivery_date: deliveryDate,
        notes,
        status: 'pending'
      })
      .select()
      .single()

    if (orderError) {
      throw orderError
    }

    const shortId = order.id.slice(0, 8)
    const deliveryText = deliveryDate || "tomorrow"

    return `Excellent! Your order has been placed successfully, ${customer.name}. Order ID: ${shortId}. You'll receive ${quantityValidation.value} × ${cylinderValidation.normalized} cylinders on ${deliveryText} for a total of ${totalAmount} KES. Our delivery team will call you before arrival.`

  } catch (error) {
    console.error('Error in place_order:', error)
    return `I'm sorry—there was an issue placing your order: ${error.message}. Please try again.`
  }
}

async function handleGetOrderStatus(params: any, supabase: any): Promise<string> {
  try {
    const phone = normalizePhone(params.phone || '')

    if (!phone) {
      return "I need your phone number to check your order status."
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, name')
      .eq('phone', phone)
      .single()

    if (!customer) {
      return "I couldn't find an account with that phone number. Would you like me to create one for you first?"
    }

    const { data: orders } = await supabase
      .from('orders')
      .select('id, status, cylinder_size, quantity, total_amount_kes, delivery_date')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (!orders || orders.length === 0) {
      return `Hello ${customer.name}! I don't see any orders on file yet. Would you like to place one now?`
    }

    const order = orders[0]
    const orderId = order.id.slice(0, 8)
    const statusMessages = {
      'pending': 'is being processed',
      'confirmed': 'has been confirmed',
      'out_for_delivery': 'is out for delivery',
      'delivered': 'has been delivered',
      'cancelled': 'has been cancelled',
    }
    const statusMsg = statusMessages[order.status as keyof typeof statusMessages] || 'is in progress'

    return `I found your most recent order, ${customer.name}. Order ${orderId} for ${order.quantity} × ${order.cylinder_size} cylinders (total ${order.total_amount_kes} KES) ${statusMsg}. Delivery is scheduled for ${order.delivery_date || 'soon'}.`

  } catch (error) {
    console.error('Error in get_order_status:', error)
    return `I'm sorry, there was an issue checking your order status: ${error.message}. Please try again.`
  }
}
