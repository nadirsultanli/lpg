import os
import json
import logging
import redis
from datetime import datetime, date, timedelta
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from dotenv import load_dotenv
import phonenumbers
from typing import Dict, Any, Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()
app = FastAPI(title="Proto Energy LPG Assistant", version="1.0.0")

# Add CORS middleware for potential web integrations
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supabase client
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

# Redis client for state management
redis_client = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=0,
    decode_responses=True
)

# Pricing constants (easier to maintain)
PRICING = {
    "6kg": 1200,
    "13kg": 2500
}

# Valid cylinder sizes
VALID_CYLINDER_SIZES = ["6kg", "13kg"]

def get_call_state(call_id: str) -> Dict[str, Any]:
    """Get call state from Redis"""
    try:
        key = f"call:{call_id}"
        state = redis_client.get(key)
        if state:
            return json.loads(state)
        return {}
    except Exception as e:
        logger.error(f"Error getting call state: {e}")
        return {}

def set_call_state(call_id: str, state: Dict[str, Any], ttl: int = 600):
    """Set call state in Redis with 10-minute TTL"""
    try:
        key = f"call:{call_id}"
        redis_client.setex(key, ttl, json.dumps(state))
    except Exception as e:
        logger.error(f"Error setting call state: {e}")

def update_call_state(call_id: str, updates: Dict[str, Any]):
    """Update existing call state"""
    state = get_call_state(call_id)
    state.update(updates)
    set_call_state(call_id, state)

def log_tool_call(tool_name: str, params: Dict[str, Any], result: str, call_id: str = None):
    """Log tool calls to database for analytics"""
    try:
        log_data = {
            "tool_name": tool_name,
            "parameters": json.dumps(params),
            "result": result,
            "call_id": call_id,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Create tool_logs table if not exists
        supabase.table("tool_logs").insert(log_data).execute()
    except Exception as e:
        logger.error(f"Error logging tool call: {e}")

def normalize_phone(phone: str) -> str:
    """Normalize phone number to E.164 format"""
    try:
        # Handle common Kenyan formats
        phone = phone.strip().replace(" ", "").replace("-", "")
        
        # Try parsing as Kenyan number first
        parsed = phonenumbers.parse(phone, "KE")
        if phonenumbers.is_valid_number(parsed):
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception as e:
        logger.warning(f"Phone parsing failed for {phone}: {e}")
    
    # Return original if parsing fails
    return phone

def validate_cylinder_size(size: str) -> tuple[bool, str]:
    """Validate cylinder size and return normalized value"""
    normalized = size.lower().strip()
    if normalized in VALID_CYLINDER_SIZES:
        return True, normalized
    return False, f"Invalid cylinder size. Please choose either 6kg or 13kg."

def validate_quantity(quantity: Any) -> tuple[bool, int, str]:
    """Validate quantity and return integer value"""
    try:
        qty = int(quantity)
        if qty <= 0:
            return False, 0, "Quantity must be greater than zero."
        if qty > 10:
            return False, 0, "For orders above 10 cylinders, please contact our sales team directly."
        return True, qty, ""
    except (ValueError, TypeError):
        return False, 0, "Please provide a valid number for quantity."

def serialize_datetime(obj):
    """JSON serializer for datetime objects"""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

def phone_from_customer_id(cid: str) -> Optional[str]:
    """
    Look up a customer's phone number from their UUID.
    Returns None if the id isn't found.
    """
    if not cid:
        return None
    try:
        res = supabase.table("customers").select("phone").eq("id", cid).single().execute()
        return res.data["phone"] if res.data else None
    except Exception as e:
        logger.error(f"Error fetching phone for customer {cid}: {e}")
        return None

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
        logger.info(f"Received tool call: {json.dumps(body, indent=2)}")
        
        # Extract call ID for state management
        call_id = body.get("message", {}).get("callId") or body.get("callId")

        # Find the list of calls, old or new field name
        call_list = (
            body.get("message", {}).get("toolCallList") or   # Vapi v2
            body.get("message", {}).get("toolCalls")         # Legacy
        )
        if not call_list:
            logger.error("No tool calls in payload")
            return JSONResponse(
                status_code=400,
                content={"error": "No tool calls in payload"}
            )

        tool_call = call_list[0]
        tool_id   = tool_call["id"]
        tool_name = tool_call.get("name") or \
                    tool_call.get("function", {}).get("name")
        params    = tool_call.get("arguments") or \
                    tool_call.get("function", {}).get("arguments")

        # Vapi often leaves arguments as a raw JSON string → decode it
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                params = {}

        logger.info(f"Processing tool: {tool_name} with params: {params}")

        # Route to the correct handler
        if tool_name == "create_customer":
            result = await handle_create_customer(params, call_id)
        elif tool_name == "place_order":
            result = await handle_place_order(params, call_id)
        elif tool_name == "get_order_status":
            result = await handle_get_order_status(params, call_id)
        else:
            result = f"Unknown tool: {tool_name}"
            logger.error(f"Unknown tool called: {tool_name}")

        # Log the tool call
        log_tool_call(tool_name, params, result, call_id)
        
        logger.info(f"Tool {tool_name} result: {result}")

        # Always wrap the reply for Vapi v2
        return JSONResponse(
            status_code=200,
            content={
                "results": [
                    {"toolCallId": tool_id, "result": result}
                ]
            }
        )

    except Exception as e:
        logger.error(f"Error in /tools: {e}")
        err_msg = f"I'm sorry—there was an error: {str(e)}"
        if "tool_id" in locals():
            return JSONResponse(
                status_code=500,
                content={"results":[{"toolCallId": tool_id, "result": err_msg}]}
            )
        return JSONResponse(status_code=500, content={"error": err_msg})

async def handle_create_customer(params: Dict[str, Any], call_id: str = None) -> str:
    """Create a new customer (or fetch existing one)"""
    try:
        # Extract & validate
        name    = params.get("name", "").strip()
        phone   = normalize_phone(params.get("phone", ""))
        address = params.get("address", "").strip()
        email   = params.get("email", "").strip() if params.get("email") else None

        # Input validation
        if not name:
            return "I need your name to create an account. Could you please tell me your name?"
        if not phone:
            return "I need your phone number to create an account. Could you please provide your phone number?"
        if not address:
            return "I need your delivery address to create an account. Could you please provide your address?"

        logger.info(f"Creating/getting customer: {name}, {phone}")

        # Call the RPC
        result = supabase.rpc("create_or_get_customer", {
            "p_name":    name,
            "p_phone":   phone,
            "p_address": address,
            "p_email":   email
        }).execute()
        
        logger.info(f"create_or_get_customer result: {result}")

        data = result.data[0] if isinstance(result.data, list) else result.data

        if data and data.get("success"):
            # Store customer info in call state
            if call_id:
                update_call_state(call_id, {
                    "customer_id": data.get("customer_id"),
                    "customer_phone": phone,
                    "customer_name": data.get("customer_name")
                })
            
            if data.get("action") == "found_existing":
                return (f"Welcome back, {data.get('customer_name')}! "
                        "I found your existing account. You're all set to place orders.")
            return (f"Perfect! Your account has been created successfully, "
                    f"{data.get('customer_name')}. You can now place orders for LPG cylinders.")
        else:
            msg = data.get("message") if data else "Unknown error"
            logger.error(f"Customer creation failed: {msg}")
            return f"I couldn't create your account: {msg}. Please try again."

    except Exception as e:
        logger.error(f"Error in create_customer: {e}")
        return f"I'm sorry—there was an issue creating your account: {str(e)}"

async def handle_place_order(params: Dict[str, Any], call_id: str = None) -> str:
    """Place a new LPG order"""
    try:
        # Get call state to check for stored customer info
        call_state = get_call_state(call_id) if call_id else {}
        
        # Extract & validate
        phone_raw = params.get("phone") or call_state.get("customer_phone") or phone_from_customer_id(params.get("customer_id", ""))
        phone = normalize_phone(phone_raw or "")
        cylinder_size = params.get("cylinder_size", "").lower()
        quantity_raw = params.get("quantity", 0)
        delivery_date = params.get("delivery_date") or params.get("notes", "")
        notes = params.get("notes", "")

        if not phone:
            return "I need your phone number to place the order. Could you please provide it?"

        # Validate cylinder size
        valid_size, normalized_size = validate_cylinder_size(cylinder_size)
        if not valid_size:
            return normalized_size  # This contains the error message

        # Validate quantity
        valid_qty, quantity, qty_error = validate_quantity(quantity_raw)
        if not valid_qty:
            return qty_error

        logger.info(f"Placing order: {phone}, {normalized_size}, qty: {quantity}")

        # Calculate total
        unit_price = PRICING[normalized_size]
        total_amount = unit_price * quantity

        # Call the RPC
        rpc_params = {
            "p_phone": phone,
            "p_cylinder_size": normalized_size,
            "p_quantity": quantity,
            "p_notes": notes
        }
        if delivery_date:
            rpc_params["p_delivery_date"] = delivery_date

        result = supabase.rpc("place_order", rpc_params).execute()
        logger.info(f"place_order result: {result}")

        data = result.data[0] if isinstance(result.data, list) else result.data

        if data and data.get("success"):
            order_id = str(data.get("order_id", ""))[:8]
            total = data.get("total_amount", total_amount)
            delivery = data.get("delivery_date", "tomorrow")
            
            # Store order info in call state
            if call_id:
                update_call_state(call_id, {
                    "last_order_id": order_id,
                    "last_order_total": total
                })
            
            return (f"Excellent! Your order has been placed successfully. "
                    f"Order ID: {order_id}. "
                    f"You'll receive {quantity} × {normalized_size} cylinders on {delivery} "
                    f"for a total of {int(total)} KES. Our delivery team will call you before arrival.")
        else:
            msg = data.get("message") if data else "Unknown error"
            if "Customer not found" in msg:
                return ("I couldn't find your account. "
                        "Would you like me to create one for you first?")
            logger.error(f"Order placement failed: {msg}")
            return f"I couldn't place your order: {msg}"

    except ValueError as ve:
        return str(ve)
    except Exception as e:
        logger.error(f"Error in place_order: {e}")
        return f"I'm sorry—there was an issue placing your order: {str(e)}"

async def handle_get_order_status(params: Dict[str, Any], call_id: str = None) -> str:
    """Handle order status check - fixed for actual RPC format"""
    try:
        # Get call state to check for stored customer info
        call_state = get_call_state(call_id) if call_id else {}
        
        # Extract and validate parameters
        phone_raw = params.get("phone", "") or call_state.get("customer_phone", "")
        phone = normalize_phone(phone_raw)
        
        logger.info(f"=== ORDER STATUS DEBUG ===")
        logger.info(f"Raw phone input: '{phone_raw}'")
        logger.info(f"Normalized phone: '{phone}'")
        
        if not phone:
            logger.error("No phone number provided")
            return "I need your phone number to check your order status."
        
        # Call Supabase RPC
        logger.info(f"Calling get_order_status RPC with phone: {phone}")
        result = supabase.rpc("get_order_status", {
            "p_phone": phone
        }).execute()
        
        logger.info(f"RPC Result RAW: {result}")
        logger.info(f"RPC Result Data: {result.data}")
        
        # Check if we got any data back
        if not result.data or len(result.data) == 0:
            logger.info("No orders found for this phone number")
            
            # Try to get customer name by checking if customer exists
            try:
                customer_result = supabase.table("customers").select("name").eq("phone", phone).execute()
                customer_name = customer_result.data[0].get("name", "there") if customer_result.data else "there"
            except:
                customer_name = "there"
                
            return (f"Hello {customer_name}! I don't see any orders "
                    "in your account yet. Would you like to place a new order?")

        # Get the first (most recent) order
        order_data = result.data[0]
        logger.info(f"Processing order data: {order_data}")

        # Extract order information
        order_id = str(order_data.get("order_id", ""))[:8]
        status = order_data.get("status", "unknown")
        cylinder_size = order_data.get("cylinder_size", "")
        quantity = order_data.get("quantity", 0)
        price_kes = order_data.get("price_kes", 0)
        total_amount = price_kes * quantity if price_kes and quantity else 0
        
        # Get delivery date (might need to calculate or get from another field)
        created_at = order_data.get("created_at", "")
        delivery_date = order_data.get("delivery_date", "tomorrow")
        
        # Get customer name
        try:
            customer_result = supabase.table("customers").select("name").eq("phone", phone).execute()
            customer_name = customer_result.data[0].get("name", "Customer") if customer_result.data else "Customer"
        except:
            customer_name = "Customer"

        logger.info(f"Order found: ID={order_id}, status={status}, customer={customer_name}")

        # Status messages
        status_messages = {
            "pending": "is being processed",
            "confirmed": "has been confirmed", 
            "out_for_delivery": "is out for delivery",
            "delivered": "has been delivered",
            "cancelled": "has been cancelled",
        }
        status_msg = status_messages.get(status, "is in progress")

        return (f"I found your most recent order, {customer_name}. "
                f"Order {order_id} for {quantity} x {cylinder_size} cylinders "
                f"(total: {int(total_amount)} KES) {status_msg}. "
                f"Delivery is scheduled for {delivery_date}.")
        
    except Exception as e:
        logger.error(f"Exception in get_order_status: {e}")
        logger.error(f"Exception type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return "I'm sorry, there was an issue checking your order status. Please try again."
    
@app.get("/")
async def root():
    """Root endpoint with API info"""
    return {
        "service": "Proto Energy LPG Assistant",
        "version": "1.0.0",
        "status": "active",
        "endpoints": ["/tools", "/health", "/test-db", "/redis-test"]
    }

@app.get("/health")
async def health():
    """Health check endpoint"""
    try:
        # Test database connection
        result = supabase.table("customers").select("count", count="exact").execute()
        
        # Test Redis connection
        redis_status = "connected"
        try:
            redis_client.ping()
        except:
            redis_status = "error"
        
        return {
            "status": "healthy",
            "database": "connected",
            "redis": redis_status,
            "customer_count": result.count,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "database": "error",
            "redis": "unknown",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

@app.get("/redis-test")
async def redis_test():
    """Test Redis functionality"""
    try:
        # Test set/get
        test_key = "test:ping"
        test_value = {"timestamp": datetime.utcnow().isoformat(), "status": "ok"}
        
        redis_client.setex(test_key, 60, json.dumps(test_value))
        retrieved = redis_client.get(test_key)
        
        # Test call state
        test_call_id = "test-123"
        set_call_state(test_call_id, {"customer_phone": "+254712345678", "test": True})
        call_state = get_call_state(test_call_id)
        
        return {
            "status": "success",
            "basic_test": json.loads(retrieved) if retrieved else None,
            "call_state_test": call_state,
            "ttl": redis_client.ttl(f"call:{test_call_id}")
        }
    except Exception as e:
        logger.error(f"Redis test failed: {e}")
        return {
            "status": "error",
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
        logger.error(f"Database test failed: {e}")
        return {
            "status": "error",
            "error": str(e)
        }

@app.post("/test-tools/{tool_name}")
async def test_tools(tool_name: str, params: Dict[str, Any]):
    """Direct endpoint for testing individual tools"""
    try:
        # Generate a test call ID
        test_call_id = f"test-{datetime.utcnow().timestamp()}"
        
        if tool_name == "create_customer":
            return {"result": await handle_create_customer(params, test_call_id)}
        elif tool_name == "place_order":
            return {"result": await handle_place_order(params, test_call_id)}
        elif tool_name == "get_order_status":
            return {"result": await handle_get_order_status(params, test_call_id)}
        else:
            raise HTTPException(status_code=404, detail=f"Tool {tool_name} not found")
    except Exception as e:
        logger.error(f"Tool test failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Proto Energy LPG Assistant server...")
    logger.info(f"Supabase URL: {url}")
    logger.info(f"Service key present: {'Yes' if key else 'No'}")
    logger.info(f"Redis connection: Testing...")
    try:
        redis_client.ping()
        logger.info("Redis: Connected successfully")
    except Exception as e:
        logger.error(f"Redis: Connection failed - {e}")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)