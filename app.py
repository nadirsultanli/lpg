import os
from fastapi import FastAPI, Request
from supabase import create_client, Client
from dotenv import load_dotenv
import json

load_dotenv()
app = FastAPI()

# Supabase client
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

@app.post("/tools")
async def tools(request: Request):
    body = await request.json()
    print(f"Received: {json.dumps(body, indent=2)}")
    
    try:
        # Extract parameters from Vapi format
        params = {}
        if "message" in body and "toolCalls" in body["message"]:
            tool_call = body["message"]["toolCalls"][0]
            params = tool_call["function"]["arguments"]
            print(f"Extracted params: {params}")
        
        name = params.get("name", "")
        phone = params.get("phone", "")
        address = params.get("address", "")
        
        if not name or not phone:
            return "Please provide both name and phone number"
        
        # Check if customer already exists
        existing = supabase.table("customers").select("*").eq("phone", phone).execute()
        print(f"Existing customer check: {existing}")
        
        if existing.data and len(existing.data) > 0:
            # Customer already exists
            customer_name = existing.data[0]["name"]
            return f"Great! I found your existing account, {customer_name}. You're all set to place orders."
        else:
            # Create new customer
            result = supabase.table("customers").insert({
                "name": name,
                "phone": phone,
                "address": address
            }).execute()
            print(f"Database insert result: {result}")
            
            if result.data:
                return f"Perfect! Your account has been created successfully, {name}. You can now place orders for LPG cylinders."
            else:
                return "I'm sorry, there was an issue creating your account. Please try again."
        
    except Exception as e:
        print(f"Error: {e}")
        return "I'm sorry, there was an issue processing your request. Please try again."

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/test-db")
async def test_db():
    """Test database connection"""
    try:
        result = supabase.table("customers").select("*").limit(5).execute()
        return {"status": "success", "data": result.data}
    except Exception as e:
        return {"status": "error", "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)