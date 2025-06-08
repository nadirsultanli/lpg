# Option 1: Create the file and then run it
@'
# test_webhook_clean.ps1 - Test the call summary webhook

$baseUrl = "http://localhost:8000"

Write-Host "Testing Call Summary Webhook with Vapi Payload" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

# Generate test call ID
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$testCallId = "test-call-$timestamp"

# Create test payload
$vapiPayload = @{
    message = @{
        call = @{
            id = $testCallId
            orgId = "test-org-id"
            type = "webCall"
            phoneNumber = "+254700123456"
        }
        startTime = 1749384163651
        endTime = 1749384180598
        endedReason = "hangup"
        messages = @(
            @{
                role = "bot"
                message = "Hello! I am Rafiki, your LPG gas delivery assistant. How can I help you today?"
                time = 1749384165371
                endTime = 1749384170031
                secondsFromStart = 1.72
                duration = 4660
            },
            @{
                role = "user"
                message = "I want to order gas"
                time = 1749384170430
                endTime = 1749384171431
                secondsFromStart = 6.78
                duration = 1000
            },
            @{
                role = "bot"  
                message = "I would be happy to help you order gas cylinders. Are you an existing customer?"
                time = 1749384174250
                endTime = 1749384176750
                secondsFromStart = 10.60
                duration = 2500
            }
        )
        assistant = @{
            id = "test-assistant-id"
            model = @{
                toolIds = @("tool1", "tool2", "tool3")
                tools = @(
                    @{ name = "create_customer" },
                    @{ name = "place_order" },
                    @{ name = "get_order_status" }
                )
            }
        }
    }
}

Write-Host ""
Write-Host "Sending test webhook payload..." -ForegroundColor Yellow

try {
    $jsonPayload = $vapiPayload | ConvertTo-Json -Depth 10
    $response = Invoke-RestMethod -Uri "$baseUrl/summary" -Method POST -Body $jsonPayload -ContentType "application/json"
    
    Write-Host "Success! Webhook accepted!" -ForegroundColor Green
    $response | ConvertTo-Json | Write-Host
    
    Write-Host ""
    Write-Host "Checking database for saved summary..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    
    $dbCheck = Invoke-RestMethod -Uri "$baseUrl/test-db"
    Write-Host "Database check complete" -ForegroundColor Green
    
} catch {
    Write-Host "Webhook failed!" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response body: $responseBody" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Green
Write-Host "Check your Supabase call_summaries table for the test entry" -ForegroundColor Yellow
Write-Host "The call_id should be: $testCallId" -ForegroundColor Cyan
'@ | Out-File -FilePath "test_webhook_clean.ps1" -Encoding UTF8

# Now run it
.\test_webhook_clean.ps1