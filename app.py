import os
import json
import logging
import redis
import hashlib
from datetime import datetime, date, timedelta
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from dotenv import load_dotenv
import phonenumbers
from typing import Dict, Any, Optional
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
import time
import traceback

# Configure logging with more detail
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
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

# Prometheus metrics
tool_calls_counter = Counter('lpg_tool_calls_total', 'Total number of tool calls', ['tool_name', 'status'])
tool_call_duration = Histogram('lpg_tool_call_duration_seconds', 'Tool call duration', ['tool_name'])
api_requests_counter = Counter('lpg_api_requests_total', 'Total API requests', ['endpoint', 'method', 'status'])
active_calls_counter = Counter('lpg_active_calls_total', 'Total active calls')

# Pricing constants (easier to maintain)
PRICING = {
    "6kg": 1200,
    "13kg": 2500
}

# Valid cylinder sizes
VALID_CYLINDER_SIZES = ["6kg", "13kg"]

# Error codes for structured errors
class ErrorCode:
    VALIDATION_ERROR = "VALIDATION_ERROR"
    CUSTOMER_NOT_FOUND = "CUSTOMER_NOT_FOUND"
    INVALID_CYLINDER_SIZE = "INVALID_CYLINDER_SIZE"
    INVALID_QUANTITY = "INVALID_QUANTITY"
    DATABASE_ERROR = "DATABASE_ERROR"
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    DUPLICATE_REQUEST = "DUPLICATE_REQUEST"

def structured_error(code: str, message: str, details: Dict[str, Any] = None) -> Dict[str, Any]:
    """Create a structured error response"""
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "timestamp": datetime.utcnow().isoformat()
        }
    }

def generate_idempotency_key(call_id: str, tool_name: str, args: Dict[str, Any]) -> str:
    """Generate SHA256 hash for idempotency"""
    # Sort args to ensure consistent hashing
    sorted_args = json.dumps(args, sort_keys=True)
    key_string = f"{call_id}|{tool_name}|{sorted_args}"
    return hashlib.sha256(key_string.encode()).hexdigest()

def check_idempotency(idempotency_key: str) -> Optional[str]:
    """Check if this request was already processed"""
    try:
        result = supabase.table("tool_call_idempotency")\
            .select("result")\
            .eq("idempotency_key", idempotency_key)\
            .single()\
            .execute()
        
        if result.data:
            logger.info(f"Idempotent request detected: {idempotency_key}")
            return result.data.get("result")
    except Exception as e:
        # Not found is expected for new requests
        logger.debug(f"No idempotency record found (expected for new requests): {e}")
    return None

def save_idempotency(idempotency_key: str, tool_name: str, call_id: str, 
                    params: Dict[str, Any], result: str):
    """Save idempotency record"""
    try:
        supabase.table("tool_call_idempotency").insert({
            "idempotency_key": idempotency_key,
            "tool_name": tool_name,
            "call_id": call_id,
            "parameters": json.dumps(params),
            "result": result
        }).execute()
        logger.debug(f"Saved idempotency record: {idempotency_key}")
    except Exception as e:
        logger.error(f"Error saving idempotency record: {e}")

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
        
        supabase.table("tool_logs").insert(log_data).execute()
        logger.debug(f"Logged tool call: {tool_name}")
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
    
# -----------------------------------------------------------------
# Direct DB helpers – replace the missing Supabase RPCs
# -----------------------------------------------------------------
def db_upsert_customer(name: str, phone: str, address: str, email: str | None):
    """Create a customer or fetch the existing one, return row as dict"""
    try:
        # First, try to find existing customer
        existing = supabase.table("customers")\
            .select("*")\
            .eq("phone", phone)\
            .execute()
        
        if existing.data and len(existing.data) > 0:
            logger.info(f"Found existing customer with phone {phone}")
            # Update the existing customer's details
            updated = supabase.table("customers")\
                .update({
                    "name": name,
                    "address": address,
                    "email": email,
                    "updated_at": datetime.utcnow().isoformat()
                })\
                .eq("phone", phone)\
                .execute()
            
            if updated.data:
                return updated.data[0]
            else:
                logger.error(f"Failed to update customer: {updated}")
                raise RuntimeError("Failed to update customer")
        else:
            # Create new customer
            logger.info(f"Creating new customer with phone {phone}")
            row = {
                "name": name,
                "phone": phone,
                "address": address,
                "email": email,
            }
            res = supabase.table("customers").insert(row).execute()
            
            if res.data:
                logger.info(f"Successfully created customer: {res.data[0]['id']}")
                return res.data[0]
            else:
                logger.error(f"Failed to create customer: {res}")
                raise RuntimeError("Failed to create customer")
                
    except Exception as e:
        logger.error(f"Database error in db_upsert_customer: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise RuntimeError(f"Database error: {str(e)}")


def db_insert_order(customer_id: str, cylinder_size: str, quantity: int,
                    delivery_date: str | None, notes: str):
    """Insert an order and return the row as dict"""
    try:
        unit_price = PRICING[cylinder_size]
        order_row = {
            "customer_id": customer_id,
            "cylinder_size": cylinder_size,
            "quantity": quantity,
            "price_kes": unit_price,
            "total_amount_kes": unit_price * quantity,
            "delivery_date": delivery_date,
            "notes": notes,
            "status": "pending",
        }
        logger.info(f"Inserting order: {order_row}")
        res = supabase.table("orders").insert(order_row).execute()
        
        if res.data:
            logger.info(f"Successfully created order: {res.data[0]['id']}")
            return res.data[0]
        else:
            logger.error(f"Failed to create order: {res}")
            raise RuntimeError("Failed to create order")
            
    except Exception as e:
        logger.error(f"Database error in db_insert_order: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise RuntimeError(f"Database error: {str(e)}")
# -----------------------------------------------------------------

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

@app.middleware("http")
async def track_metrics(request: Request, call_next):
    """Track request metrics"""
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    
    # Track API request
    api_requests_counter.labels(
        endpoint=request.url.path,
        method=request.method,
        status=response.status_code
    ).inc()
    
    return response

@app.post("/tools")
async def tools(request: Request):
    """
    Handle Vapi tool calls with idempotency and structured errors.
    Always return the Vapi-v2 envelope:
    {
        "results": [
            { "toolCallId": "<id>", "result": "<string>" }
        ]
    }
    """
    start_time = time.time()
    
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

        # Generate idempotency key
        idempotency_key = generate_idempotency_key(call_id, tool_name, params)
        
        # Check if already processed
        existing_result = check_idempotency(idempotency_key)
        if existing_result:
            tool_calls_counter.labels(tool_name=tool_name, status="duplicate").inc()
            return JSONResponse(
                status_code=200,
                content={
                    "results": [
                        {"toolCallId": tool_id, "result": existing_result}
                    ]
                }
            )

        # Route to the correct handler
        try:
            if tool_name == "create_customer":
                result = await handle_create_customer(params, call_id)
            elif tool_name == "place_order":
                result = await handle_place_order(params, call_id)
            elif tool_name == "get_order_status":
                result = await handle_get_order_status(params, call_id)
            else:
                result = f"Unknown tool: {tool_name}"
                logger.error(f"Unknown tool called: {tool_name}")
                tool_calls_counter.labels(tool_name=tool_name, status="unknown").inc()
        except Exception as e:
            # Log full error details
            logger.error(f"Error in tool handler {tool_name}: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            tool_calls_counter.labels(tool_name=tool_name, status="error").inc()
            
            # Create user-friendly error message but log the real error
            if "database" in str(e).lower():
                result = "I'm having trouble accessing the database. Please try again in a moment."
            elif "unique constraint" in str(e).lower():
                result = "It looks like you already have an account. Let me check your existing information."
            else:
                result = f"I encountered an error processing your request: {str(e)}. Please try again."

        # Track success
        tool_calls_counter.labels(tool_name=tool_name, status="success").inc()
        
        # Track duration
        duration = time.time() - start_time
        tool_call_duration.labels(tool_name=tool_name).observe(duration)

        # Save idempotency record
        save_idempotency(idempotency_key, tool_name, call_id, params, result)
        
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
        logger.error(f"Traceback: {traceback.format_exc()}")
        err_msg = "I'm sorry—there was an unexpected error. Please try again."
        if "tool_id" in locals():
            return JSONResponse(
                status_code=500,
                content={"results":[{"toolCallId": tool_id, "result": err_msg}]}
            )
        return JSONResponse(status_code=500, content={"error": err_msg})

async def handle_create_customer(params: Dict[str, Any], call_id: str = None) -> str:
    """Create a new customer (or fetch existing one) with structured error handling"""
    try:
        name    = params.get("name", "").strip()
        phone   = normalize_phone(params.get("phone", ""))
        address = params.get("address", "").strip()
        email   = params.get("email", "").strip() if params.get("email") else None

        logger.info(f"Creating customer: name={name}, phone={phone}, address={address}, email={email}")

        if not name:
            return "I need your name to create an account. Could you please tell me your name?"
        if not phone:
            return "I need your phone number to create an account. Could you please provide it?"
        if not address:
            return "I need your delivery address to create an account. Could you please provide your address?"

        # Upsert customer directly in the DB
        customer = db_upsert_customer(name, phone, address, email)

        # Store in Redis state for the call
        if call_id:
            update_call_state(call_id, {
                "customer_id":   customer["id"],
                "customer_phone": phone,
                "customer_name":  customer["name"],
            })

        # Check if this is a new or existing customer by comparing timestamps
        created_at = customer.get("created_at")
        updated_at = customer.get("updated_at")
        
        # For existing customers, we'll have different timestamps
        if created_at and updated_at and created_at != updated_at:
            return (f"Welcome back, {customer['name']}! "
                    "I found your existing account. You're all set to place orders.")
        else:
            return (f"Perfect! Your account has been created successfully, "
                    f"{customer['name']}. You can now place orders for LPG cylinders.")

    except Exception as e:
        logger.error(f"Error in create_customer: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        if "already exists" in str(e).lower():
            return "It looks like you already have an account with this phone number. You can proceed to place an order."
        return f"I'm sorry—there was an issue creating your account: {str(e)}. Please try again."

async def handle_place_order(params: Dict[str, Any], call_id: str = None) -> str:
    """Place a new LPG order with structured error handling"""
    try:
        # Fetch phone (from params → call-state → customer_id)
        phone_raw = params.get("phone") or get_call_state(call_id).get("customer_phone") \
                    or phone_from_customer_id(params.get("customer_id", ""))
        phone = normalize_phone(phone_raw or "")
        
        logger.info(f"Placing order with phone: {phone}, params: {params}")
        
        if not phone:
            return "I need your phone number to place the order. Could you please provide it?"

        cylinder_size = params.get("cylinder_size", "").lower()
        ok_size, cylinder_size_or_msg = validate_cylinder_size(cylinder_size)
        if not ok_size:
            return cylinder_size_or_msg

        ok_qty, quantity, qty_msg = validate_quantity(params.get("quantity", 0))
        if not ok_qty:
            return qty_msg

        delivery_date = params.get("delivery_date")  # Optional
        notes = params.get("notes", "")

        # Find existing customer by phone (don't update their info during order placement)
        try:
            existing = supabase.table("customers")\
                .select("*")\
                .eq("phone", phone)\
                .execute()
            
            if existing.data and len(existing.data) > 0:
                customer = existing.data[0]
                logger.info(f"Found existing customer: {customer['name']} (ID: {customer['id']})")
            else:
                # Customer doesn't exist - this shouldn't happen if they went through create_customer first
                # But we'll handle it gracefully
                logger.warning(f"No customer found with phone {phone} during order placement")
                return ("I couldn't find your account. Please let me create one for you first. "
                       "Could you please provide your full name and delivery address?")
        
        except Exception as e:
            logger.error(f"Error finding customer: {e}")
            return ("I'm having trouble finding your account. Please try again or "
                   "let me create a new account for you.")

        # Insert order using the existing customer's ID
        order = db_insert_order(
            customer_id=customer["id"],
            cylinder_size=cylinder_size_or_msg,
            quantity=quantity,
            delivery_date=delivery_date,
            notes=notes,
        )

        # Cache order info in Redis
        if call_id:
            update_call_state(call_id, {
                "last_order_id":    order["id"],
                "last_order_total": order["total_amount_kes"],
                "customer_id":      customer["id"],  # Keep the real customer ID
            })

        short_id = str(order["id"])[:8]
        delivery_text = delivery_date if delivery_date else "tomorrow"
        
        return (f"Excellent! Your order has been placed successfully, {customer['name']}. "
                f"Order ID: {short_id}. You'll receive {quantity} × {cylinder_size_or_msg} "
                f"cylinders on {delivery_text} for a total of "
                f"{int(order['total_amount_kes'])} KES. Our delivery team will call you before arrival.")

    except ValueError as ve:
        return str(ve)
    except Exception as e:
        logger.error(f"Error in place_order: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return f"I'm sorry—there was an issue placing your order: {str(e)}. Please try again."

async def handle_get_order_status(params: Dict[str, Any], call_id: str = None) -> str:
    """Handle order status check with structured error handling"""
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
        # --- ❶ Look up the customer by phone ---------------------------------
        cust_resp = (
            supabase.table("customers")
                    .select("id,name")
                    .eq("phone", phone)
                    .single()
                    .execute()
        )

        customer = cust_resp.data
        if not customer:
            return ("I couldn’t find an account with that phone number. "
                    "Would you like me to create one for you first?")

        customer_id   = customer["id"]
        customer_name = customer.get("name", "there")

        # --- ❷ Grab their latest order ---------------------------------------
        order_resp = (
            supabase.table("orders")
                    .select(
                        "id,status,cylinder_size,quantity,price_kes,total_amount_kes,delivery_date"
                    )
                    .eq("customer_id", customer_id)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
        )

        if not order_resp.data:
            return (f"Hello {customer_name}! I don’t see any orders on file yet. "
                    "Would you like to place one now?")

        order = order_resp.data[0]

        # --- ❸ Build a friendly voice reply ----------------------------------
        order_id      = str(order["id"])[:8]
        status        = order.get("status", "pending")
        cylinder_size = order["cylinder_size"]
        qty           = order["quantity"]
        total         = int(order["total_amount_kes"])
        deliver_on    = order.get("delivery_date", "soon")

        status_text = {
            "pending":          "is being processed",
            "confirmed":        "has been confirmed",
            "out_for_delivery": "is out for delivery",
            "delivered":        "has been delivered",
            "cancelled":        "has been cancelled",
        }.get(status, "is in progress")

        return (f"I found your most recent order, {customer_name}. "
                f"Order {order_id} for {qty} × {cylinder_size} cylinder(s) "
                f"(total {total} KES) {status_text}. "
                f"Delivery is scheduled for {deliver_on}.")

        
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
        
        # Get delivery date
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
        logger.error(f"Traceback: {traceback.format_exc()}")
        return f"I'm sorry, there was an issue checking your order status: {str(e)}. Please try again."

@app.post("/summary")
async def call_summary_webhook(request: Request):
    """
    Handle Vapi end-of-call webhook to store call summaries
    """
    try:
        body = await request.json()
        logger.info(f"Received call summary webhook")
        
        # Vapi sends the payload in a 'message' wrapper
        message = body.get("message", {})
        
        # Extract call information from the nested structure
        call_data = message.get("call", {})
        call_id = call_data.get("id")
        
        # Get phone number - it might be in different places depending on call type
        phone_number = call_data.get("phoneNumber") or call_data.get("customer", {}).get("phone")
        
        # Calculate duration from start/end times if not provided directly
        start_time = message.get("startTime")
        end_time = message.get("endTime")
        duration = None
        if start_time and end_time:
            duration = int((end_time - start_time) / 1000)  # Convert to seconds
        
        # Get ended reason
        ended_reason = message.get("endedReason", "unknown")
        
        # Build transcript from messages
        transcript_messages = message.get("messages", [])
        transcript_lines = []
        for msg in transcript_messages:
            role = msg.get("role", "unknown")
            text = msg.get("message", "")
            if text:
                transcript_lines.append(f"{role}: {text}")
        transcript = "\n".join(transcript_lines)
        
        # Extract tool calls from assistant configuration
        assistant_data = message.get("assistant", {})
        model_data = assistant_data.get("model", {})
        tool_ids = model_data.get("toolIds", [])
        tools = model_data.get("tools", [])
        
        # Get customer ID from Redis state if available
        call_state = get_call_state(call_id) if call_id else {}
        customer_id = call_state.get("customer_id")
        
        # Build summary from the conversation
        summary = f"Call lasted {duration} seconds. "
        if customer_id:
            summary += f"Customer ID: {customer_id}. "
        summary += f"Ended due to: {ended_reason}."
        
        # Only store if we have a call_id
        if call_id:
            # Store in database
            summary_data = {
                "call_id": call_id,
                "phone_number": phone_number,
                "customer_id": customer_id,
                "duration_seconds": duration,
                "transcript": transcript[:10000] if transcript else "",  # Limit transcript length
                "summary": summary,
                "ended_reason": ended_reason,
                "tool_calls": json.dumps({"tool_ids": tool_ids, "tools_count": len(tools)})
            }
            
            # Remove None values to avoid database errors
            summary_data = {k: v for k, v in summary_data.items() if v is not None}
            
            supabase.table("call_summaries") \
                .upsert(summary_data, on_conflict="call_id") \
                .execute()
            
            # Increment active calls counter
            active_calls_counter.inc()
            
            logger.info(f"Call summary stored for call {call_id}")
        else:
            logger.warning("No call_id found in webhook payload")
        
        return JSONResponse(status_code=200, content={"status": "success"})
        
    except Exception as e:
        logger.error(f"Error processing call summary: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/metrics")
async def metrics():
    """Expose Prometheus metrics"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/")
async def root():
    """Root endpoint with API info"""
    return {
        "service": "Proto Energy LPG Assistant",
        "version": "1.0.0",
        "status": "active",
        "endpoints": ["/tools", "/health", "/test-db", "/redis-test", "/metrics", "/summary"]
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
    
    # Cleanup old idempotency keys on startup
    try:
        supabase.rpc("cleanup_old_idempotency_keys").execute()
        logger.info("Cleaned up old idempotency keys")
    except Exception as e:
        logger.error(f"Failed to cleanup idempotency keys: {e}")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)