import os
import json
from datetime import datetime, date
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from supabase import create_client, Client
from dotenv import load_dotenv
import phonenumbers
from typing import Dict, Any, Optional

load_dotenv()
app = FastAPI()

# Supabase client
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

def normalize_phone(phone: str) -> str:
    """Normalize phone number to E.164 format"""
    try:
        # Try parsing as Kenyan number first
        parsed = phonenumbers.parse(phone, "KE")
        if phonenumbers.is_valid_number(parsed):
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except:
        pass
    
    # Return original if parsing fails
    return phone

def serialize_datetime(obj):
    """JSON serializer for datetime objects"""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

# ── helper ───────────────────────────────────────────
def phone_from_customer_id(cid: str) -> Optional[str]:
    """
    Look up a customer's phone number from their UUID.
    Returns None if the id isn't found.
    """
    if not cid:
        return None
    res = supabase.table("customers").select("phone").eq("id", cid).single().execute()
    return res.data["phone"] if res.data else None

@app.post("/tools")
async def tools(request: Request):
    """
    Handle Vapi tool calls.
    Always return the Vapi-v2 envelope:
    {
        "results": [
            { "toolCallId": "<id>", "result": "<string>" }
        ]
    }
    """
    try:
        body = await request.json()
        print("RAW ↓\n", json.dumps(body, indent=2))

        # 1️⃣  Find the list of calls, old or new field name.
        call_list = (
            body.get("message", {}).get("toolCallList") or   # Vapi v2
            body.get("message", {}).get("toolCalls")         # Legacy
        )
        if not call_list:
            return JSONResponse(
                status_code=400,
                content={"error": "No tool calls in payload"}
            )

        tool_call = call_list[0]
        tool_id   = tool_call["id"]                         # keep for envelope
        tool_name = tool_call.get("name") or \
                    tool_call.get("function", {}).get("name")
        params    = tool_call.get("arguments") or \
                    tool_call.get("function", {}).get("arguments")

        # 2️⃣  Vapi often leaves arguments as a raw JSON string → decode it.
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                params = {}

        print(f"Tool: {tool_name}, Params: {params}")

        # 3️⃣  Route to the correct handler.
        if tool_name == "create_customer":
            result = await handle_create_customer(params)
        elif tool_name == "place_order":
            result = await handle_place_order(params)
        elif tool_name == "get_order_status":
            result = await handle_get_order_status(params)
        else:
            result = f"Unknown tool: {tool_name}"

        # 4️⃣  Always wrap the reply for Vapi v2.
        return JSONResponse(
            status_code=200,
            content={
                "results": [
                    {"toolCallId": tool_id, "result": result}
                ]
            }
        )

    # 5️⃣  If *anything* goes wrong, still try to send the envelope
    #     (so Vapi doesn't crash waiting for toolCallId).
    except Exception as e:
        print(f"Error in /tools: {e}")
        err_msg = f"I’m sorry—there was an error: {str(e)}"
        if "tool_id" in locals():
            return JSONResponse(
                status_code=500,
                content={"results":[{"toolCallId": tool_id, "result": err_msg}]}
            )
        return JSONResponse(status_code=500, content={"error": err_msg})

async def handle_create_customer(params: Dict[str, Any]) -> str:
    """Create a new customer (or fetch existing one)"""
    try:
        # ── extract & validate ───────────────────────────────────────────
        name    = params.get("name", "").strip()
        phone   = normalize_phone(params.get("phone", ""))
        address = params.get("address", "").strip()
        email   = params.get("email", "").strip() if params.get("email") else None

        if not name or not phone:
            return "I need both your name and phone number to create an account."

        # ── call the RPC ─────────────────────────────────────────────────
        result = supabase.rpc("create_or_get_customer", {
            "p_name":    name,
            "p_phone":   phone,
            "p_address": address,
            "p_email":   email
        }).execute()
        print("create_or_get_customer →", result)

        data = result.data[0] if isinstance(result.data, list) else result.data

        if data and data.get("success"):
            if data.get("action") == "found_existing":
                return (f"Welcome back, {data.get('customer_name')}! "
                        "I found your existing account. You're all set to place orders.")
            return (f"Perfect! Your account has been created successfully, "
                    f"{data.get('customer_name')}. You can now place orders for LPG cylinders.")
        else:
            msg = data.get("message") if data else "Unknown error"
            return f"I couldn't create your account: {msg}. Please try again."

    except Exception as e:
        print("✖ create_customer:", e)
        return f"I'm sorry—there was an issue creating your account: {str(e)}"

async def handle_place_order(params: Dict[str, Any]) -> str:
    """Place a new LPG order"""
    try:
        # ── extract & validate ───────────────────────────────────────────
# ── extract & validate ───────────────────────────────
        phone_raw     = params.get("phone") or phone_from_customer_id(params.get("customer_id", ""))
        phone         = normalize_phone(phone_raw or "")
        cylinder_size = params.get("cylinder_size", "").lower()
        quantity      = int(params.get("quantity", 0))
        delivery_date = params.get("delivery_date") or params.get("notes", "")
        notes         = params.get("notes", "")

        if not phone:
            return "I need your phone number to place the order."

        if cylinder_size not in ("6kg", "13kg"):
            return "Please specify either 6kg or 13kg cylinders."
        if quantity <= 0:
            return "Please specify how many cylinders you'd like to order."

        # ── call the RPC ─────────────────────────────────────────────────
        rpc_params = {
            "p_phone":         phone,
            "p_cylinder_size": cylinder_size,
            "p_quantity":      quantity,
            "p_notes":         notes
        }
        if delivery_date:
            rpc_params["p_delivery_date"] = delivery_date

        result = supabase.rpc("place_order", rpc_params).execute()
        print("place_order →", result)

        data = result.data[0] if isinstance(result.data, list) else result.data

        if data and data.get("success"):
            order_id = str(data.get("order_id", ""))[:8]
            total    = data.get("total_amount", 0)
            delivery = data.get("delivery_date", "tomorrow")
            return (f"Excellent! Your order has been placed successfully. "
                    f"Order ID: {order_id}. "
                    f"You'll receive {quantity} × {cylinder_size} cylinders on {delivery} "
                    f"for a total of {total} KES. Our delivery team will call you before arrival.")
        else:
            msg = data.get("message") if data else "Unknown error"
            if "Customer not found" in msg:
                return ("I couldn't find your account. "
                        "Would you like me to create one for you first?")
            return f"I couldn't place your order: {msg}"

    except ValueError:
        return "Please specify a valid quantity for your order."
    except Exception as e:
        print("✖ place_order:", e)
        return f"I'm sorry—there was an issue placing your order: {str(e)}"

async def handle_get_order_status(params: Dict[str, Any]) -> str:
    """Handle order status check"""
    try:
        # Extract and validate parameters
        phone = normalize_phone(params.get("phone", ""))
        
        if not phone:
            return "I need your phone number to check your order status."
        
        # Call Supabase RPC
        result = supabase.rpc("get_last_order_status", {
            "p_phone": phone
        }).execute()
        
        print(f"RPC Result: {result}")

# ── unwrap once, then work only with `data` ───────────
        data = result.data[0] if isinstance(result.data, list) else result.data

        if data and data.get("success"):
            if not data.get("has_orders"):
                return (f"Hello {data.get('customer_name')}! I don't see any orders "
                        "in your account yet. Would you like to place a new order?")

            # Format the response
            order_id       = str(data.get("order_id", ""))[:8]
            status         = data.get("status", "unknown")
            cylinder_size  = data.get("cylinder_size", "")
            quantity       = data.get("quantity", 0)
            total          = data.get("total_amount", 0)
            delivery_date  = data.get("delivery_date", "")

            status_messages = {
                "pending":           "is being processed",
                "confirmed":         "has been confirmed",
                "out_for_delivery":  "is out for delivery",
                "delivered":         "has been delivered",
                "cancelled":         "has been cancelled",
            }
            status_msg = status_messages.get(status, "is in progress")

            return (f"I found your most recent order, {data.get('customer_name')}. "
                    f"Order {order_id} for {quantity} × {cylinder_size} cylinders "
                    f"(total: {total} KES) {status_msg}. "
                    f"Delivery is scheduled for {delivery_date}.")
        else:
            msg = data.get("message") if data else "Unknown error"
            if "Customer not found" in msg:
                return ("I couldn't find any account with that phone number. "
                        "Would you like to create a new account?")
            return f"I couldn't check your order status: {msg}"

            
    except Exception as e:
        print(f"Error in get_order_status: {e}")
        return "I'm sorry, there was an issue checking your order status. Please try again."

@app.get("/health")
async def health():
    """Health check endpoint"""
    try:
        # Test database connection
        result = supabase.table("customers").select("count", count="exact").execute()
        return {
            "status": "healthy",
            "database": "connected",
            "customer_count": result.count
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "error",
            "error": str(e)
        }

@app.get("/test-db")
async def test_db():
    """Test database connection and show sample data"""
    try:
        customers = supabase.table("customers").select("*").limit(5).execute()
        orders = supabase.table("orders").select("*").limit(5).execute()
        
        return {
            "status": "success",
            "customers": customers.data,
            "orders": orders.data,
            "customer_count": len(customers.data),
            "order_count": len(orders.data)
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }

@app.post("/test-tools/{tool_name}")
async def test_tools(tool_name: str, params: Dict[str, Any]):
    """Direct endpoint for testing individual tools"""
    if tool_name == "create_customer":
        return await handle_create_customer(params)
    elif tool_name == "place_order":
        return await handle_place_order(params)
    elif tool_name == "get_order_status":
        return await handle_get_order_status(params)
    else:
        raise HTTPException(status_code=404, detail=f"Tool {tool_name} not found")

if __name__ == "__main__":
    import uvicorn
    print(f"Starting server...")
    print(f"Supabase URL: {url}")
    print(f"Service key present: {'Yes' if key else 'No'}")
    uvicorn.run(app, host="0.0.0.0", port=8000)