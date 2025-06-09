import requests
import json

# Base URL for your local server
BASE_URL = "http://localhost:8000"

def test_create_customer():
    """Test customer creation"""
    print("\n=== Testing Create Customer ===")
    
    test_customer = {
        "name": "John Doe",
        "phone": "+254712345678",
        "address": "123 Test Street, Nairobi",
        "email": "john@example.com"
    }
    
    response = requests.post(
        f"{BASE_URL}/test-tools/create_customer",
        json=test_customer
    )
    
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.json()

def test_place_order():
    """Test order placement"""
    print("\n=== Testing Place Order ===")
    
    test_order = {
        "phone": "+254712345678",
        "cylinder_size": "13kg",
        "quantity": 2,
        "delivery_date": "2025-06-10",
        "notes": "Please call before delivery"
    }
    
    response = requests.post(
        f"{BASE_URL}/test-tools/place_order",
        json=test_order
    )
    
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.json()

def test_get_order_status():
    """Test order status check"""
    print("\n=== Testing Get Order Status ===")
    
    test_status = {
        "phone": "+254712345678"
    }
    
    response = requests.post(
        f"{BASE_URL}/test-tools/get_order_status",
        json=test_status
    )
    
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.json()

def test_database():
    """Check database contents"""
    print("\n=== Checking Database ===")
    
    response = requests.get(f"{BASE_URL}/test-db")
    print(f"Status: {response.status_code}")
    data = response.json()
    
    if data.get("status") == "success":
        print(f"Customers in DB: {data.get('customer_count', 0)}")
        print(f"Orders in DB: {data.get('order_count', 0)}")
        
        if data.get("customers"):
            print("\nSample Customers:")
            for customer in data["customers"][:2]:
                print(f"  - {customer.get('name')} ({customer.get('phone')})")
                
        if data.get("orders"):
            print("\nSample Orders:")
            for order in data["orders"][:2]:
                print(f"  - Order {order.get('id')[:8]}: {order.get('quantity')}x {order.get('cylinder_size')}")
    else:
        print(f"Database error: {data.get('error')}")

def main():
    """Run all tests"""
    print("Starting Proto Energy LPG Assistant Tests")
    print("========================================")
    
    # Test health first
    print("\n=== Testing Health Check ===")
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"Health Status: {response.json()}")
    except Exception as e:
        print(f"Health check failed: {e}")
        print("Make sure the server is running!")
        return
    
    # Run tests
    try:
        # Create customer
        test_create_customer()
        
        # Place order
        test_place_order()
        
        # Check order status
        test_get_order_status()
        
        # Check database
        test_database()
        
    except Exception as e:
        print(f"\nError during tests: {e}")

if __name__ == "__main__":
    main()