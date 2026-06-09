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

function Write-SafeBodyPreview {
    param(
        [Parameter(Mandatory = $false)]
        [string]$BodyText
    )

    if ([string]::IsNullOrWhiteSpace($BodyText)) {
        Write-Host "Body: <empty>"
        return
    }

    $cleanBody = $BodyText -replace '\s+', ' '
    Write-Host "Body: $($cleanBody.Substring(0, [Math]::Min(200, $cleanBody.Length)))"
}

foreach ($test in $tests) {
    Write-Host "`n--- $($test.Name) ---"
    try {
        $params = @{
            Uri = "$baseUrl$($test.Path)"
            Method = $test.Method
            ContentType = "application/json"
            UseBasicParsing = $true
            MaximumRedirection = 0
            ErrorAction = "Stop"
        }
        if ($test.Body) { $params.Body = $test.Body }
        $response = Invoke-WebRequest @params
        Write-Host "Status: $($response.StatusCode)"
        Write-SafeBodyPreview -BodyText $response.Content
    } catch {
        $response = $_.Exception.Response
        if ($response) {
            try {
                Write-Host "Status: $([int]$response.StatusCode)"
            } catch {
                Write-Host "Status: <unavailable>"
            }

            $bodyText = $null
            try {
                $stream = $response.GetResponseStream()
                if ($null -ne $stream) {
                    $reader = New-Object System.IO.StreamReader($stream)
                    $bodyText = $reader.ReadToEnd()
                }
            } catch {
                $bodyText = $null
            }

            Write-SafeBodyPreview -BodyText $bodyText
        } else {
            $errorMessage = $_.Exception.Message
            if ($test.Method -eq "GET") {
                try {
                    $curlStatus = curl.exe -s -o NUL -w "%{http_code}" "$baseUrl$($test.Path)"
                    if ($curlStatus -match '^[0-9]{3}$') {
                        Write-Host "Status: $curlStatus"
                        Write-Host "Body: <empty>"
                        continue
                    }
                } catch {
                    # If curl fallback fails, print the original web cmdlet error below.
                }
            }

            Write-Host "Error: $errorMessage"
        }
    }
}
