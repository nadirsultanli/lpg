// supabase/functions/summary/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const body = await req.json()
    console.log('Received call summary webhook')

    // Vapi sends the payload in a 'message' wrapper
    const message = body.message || {}
    
    // Extract call information from the nested structure
    const callData = message.call || {}
    const callId = callData.id
    
    // Get phone number - it might be in different places depending on call type
    const phoneNumber = callData.phoneNumber || callData.customer?.phone
    
    // Calculate duration from start/end times if not provided directly
    const startTime = message.startTime
    const endTime = message.endTime
    let duration = null
    if (startTime && endTime) {
      duration = Math.floor((endTime - startTime) / 1000) // Convert to seconds
    }
    
    // Get ended reason
    const endedReason = message.endedReason || 'unknown'
    
    // Build transcript from messages
    const transcriptMessages = message.messages || []
    const transcriptLines: string[] = []
    for (const msg of transcriptMessages) {
      const role = msg.role || 'unknown'
      const text = msg.message || ''
      if (text) {
        transcriptLines.push(`${role}: ${text}`)
      }
    }
    const transcript = transcriptLines.join('\n')
    
    // Extract tool calls from assistant configuration
    const assistantData = message.assistant || {}
    const modelData = assistantData.model || {}
    const toolIds = modelData.toolIds || []
    const tools = modelData.tools || []
    
    // Build summary from the conversation
    let summary = `Call lasted ${duration} seconds. `
    summary += `Ended due to: ${endedReason}.`
    
    // Only store if we have a call_id
    if (callId) {
      // Prepare summary data
      const summaryData: any = {
        call_id: callId,
        phone_number: phoneNumber,
        duration_seconds: duration,
        transcript: transcript?.slice(0, 10000) || '', // Limit transcript length
        summary: summary,
        ended_reason: endedReason,
        tool_calls: JSON.stringify({ tool_ids: toolIds, tools_count: tools.length })
      }
      
      // Remove null/undefined values to avoid database errors
      Object.keys(summaryData).forEach(key => {
        if (summaryData[key] === null || summaryData[key] === undefined) {
          delete summaryData[key]
        }
      })
      
      // Store in database using upsert to handle duplicates
      const { error } = await supabaseClient
        .from('call_summaries')
        .upsert(summaryData, { 
          onConflict: 'call_id',
          ignoreDuplicates: false 
        })
      
      if (error) {
        console.error('Error storing call summary:', error)
        throw error
      }
      
      console.log(`Call summary stored for call ${callId}`)
    } else {
      console.warn('No call_id found in webhook payload')
    }
    
    return new Response(
      JSON.stringify({ status: 'success' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
    
  } catch (error) {
    console.error('Error processing call summary:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})