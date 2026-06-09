$payload = @{
	venue_name = "Test"
	date = "2023-12-25"
	gig_type = "Wedding"
	requested_fee = "1000"
	contact_email = "test@example.com"
	notes = "Test"
} | ConvertTo-Json

$targets = @(
	"https://preview--book-jukebox.base44.app/api/webhook/receiveExternalBooking",
	"https://book-jukebox.base44.app/api/webhook/receiveExternalBooking"
)

foreach ($target in $targets) {
	Write-Host "`n--- POST $target ---"
	try {
		$response = Invoke-WebRequest -Uri $target -Method Post -Body $payload -ContentType "application/json" -UseBasicParsing
		Write-Host "Status: $($response.StatusCode)"
		if ([string]::IsNullOrWhiteSpace($response.Content)) {
			Write-Host "Body: <empty>"
		} else {
			$body = $response.Content -replace '\s+', ' '
			Write-Host "Body: $($body.Substring(0, [Math]::Min(200, $body.Length)))"
		}
	} catch {
		if ($_.Exception.Response) {
			Write-Host "Status: $([int]$_.Exception.Response.StatusCode)"
			Write-Host "Body: <empty>"
		} else {
			Write-Host "Error: $($_.Exception.Message)"
		}
	}
}
