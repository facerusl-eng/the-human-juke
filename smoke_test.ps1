$baseUrl = "https://www.the-human-jukebox.org"
$tests = @(
    @{ Name = "1) GET /api/keepwarm"; Method = "GET"; Path = "/api/keepwarm"; Body = $null },
    @{ Name = "2) POST /api/event-cover?id=demo-event-001"; Method = "POST"; Path = "/api/event-cover?id=demo-event-001"; Body = $null },
    @{ Name = "3) POST /api/get-updates (Invalid Email)"; Method = "POST"; Path = "/api/get-updates"; Body = "{\""email\"":\""not-an-email\"",\""lang\"":\""en\""}" },
    @{ Name = "4) POST /api/get-updates (Valid Email)"; Method = "POST"; Path = "/api/get-updates"; Body = "{\""email\"":\""ops+smoke-test@the-human-jukebox.org\"",\""lang\"":\""en\""}" },
    @{ Name = "5) POST /api/book-show (Missing venue_name)"; Method = "POST"; Path = "/api/book-show"; Body = "{\""contact_name\"":\""Test\""}" },
    @{ Name = "6) POST /api/report-issue (Empty Body)"; Method = "POST"; Path = "/api/report-issue"; Body = "{}" },
    @{ Name = "7) GET /api/join-meta?event=demo-event-001"; Method = "GET"; Path = "/api/join-meta?event=demo-event-001"; Body = $null }
)

foreach ($test in $tests) {
    Write-Host "`n--- $($test.Name) ---"
    try {
        $params = @{
            Uri = "$baseUrl$($test.Path)"
            Method = $test.Method
            ContentType = "application/json"
            MaximumRedirection = 0
            ErrorAction = "Stop"
        }
        if ($test.Body) { $params.Body = $test.Body }
        $response = Invoke-WebRequest @params
        Write-Host "Status: $($response.StatusCode)"
        if ($response.Headers.Location) { Write-Host "Location: $($response.Headers.Location)" }
        $cleanBody = $response.Content -replace '\s+', ' '
        Write-Host "Body: $($cleanBody.Substring(0, [Math]::Min(200, $cleanBody.Length)))"
    } catch {
        if ($_.Exception.Response) {
            Write-Host "Status: $([int]$_.Exception.Response.StatusCode)"
            if ($_.Exception.Response.Headers.Location) { Write-Host "Location: $($_.Exception.Response.Headers.Location)" }
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $content = $reader.ReadToEnd() -replace '\s+', ' '
            Write-Host "Body: $($content.Substring(0, [Math]::Min(200, $content.Length)))"
        } else {
            Write-Host "Error: $($_.Exception.Message)"
        }
    }
}
