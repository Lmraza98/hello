# export-signatures.ps1
# Simple signature export: class/def/function declarations with line numbers.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\export-signatures.ps1

$ProjectDir = (Get-Location).Path
$OutputFile = Join-Path $ProjectDir "SIGNATURES.txt"

Write-Host "Starting signature export from: $ProjectDir" -ForegroundColor Cyan

# Find all Python files (skip common junk dirs)
$pyFiles = Get-ChildItem -Path $ProjectDir -Filter "*.py" -Recurse -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\__pycache__\\' -and
    $_.FullName -notmatch '\\\.git\\' -and
    $_.FullName -notmatch '\\\.venv\\' -and
    $_.FullName -notmatch '\\venv\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\build\\' -and
    $_.FullName -notmatch '\\claude_chunks'
}

# Find all TS/TSX files
$tsFiles = Get-ChildItem -Path $ProjectDir -Filter "*.ts" -Recurse -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\\.git\\' -and
    $_.FullName -notmatch '\\\.venv\\' -and
    $_.FullName -notmatch '\\venv\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\build\\'
}
$tsxFiles = Get-ChildItem -Path $ProjectDir -Filter "*.tsx" -Recurse -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\\.git\\' -and
    $_.FullName -notmatch '\\\.venv\\' -and
    $_.FullName -notmatch '\\venv\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\build\\'
}

$allFiles = @()
if ($pyFiles) { $allFiles += $pyFiles }
if ($tsFiles) { $allFiles += $tsFiles }
if ($tsxFiles) { $allFiles += $tsxFiles }

Write-Host "Found $($allFiles.Count) source files" -ForegroundColor Cyan

if ($allFiles.Count -eq 0) {
    Write-Host "ERROR: No source files found in $ProjectDir" -ForegroundColor Red
    Write-Host "Make sure you cd into your project directory first." -ForegroundColor Yellow
    exit 1
}

$results = @()
$results += "# SIGNATURES EXPORT"
$results += "# Generated: $(Get-Date)"
$results += "# Project: $ProjectDir"
$results += "# Files: $($allFiles.Count)"
$results += "#"
$results += "# Shows: class/def/function declarations with line numbers"
$results += "# ========================================================"
$results += ""

foreach ($file in ($allFiles | Sort-Object FullName)) {
    $relPath = $file.FullName.Replace($ProjectDir, "").TrimStart("\")
    $sizeKB = [math]::Round($file.Length / 1024, 1)
    $ext = $file.Extension.ToLower()

    $lines = Get-Content $file.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }

    $fileSignatures = @()

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        $trimmed = $line.TrimStart()
        $lineNum = $i + 1

        if ($ext -eq ".py") {
            # Decorators (FastAPI routes, etc)
            if ($trimmed.StartsWith("@")) {
                $fileSignatures += "  $trimmed"
            }
            # Class definitions
            elseif ($trimmed -match '^class\s+\w+') {
                $sig = $trimmed.TrimEnd(":", " ")
                $fileSignatures += "  L${lineNum}: $sig"
            }
            # Function definitions (def and async def)
            elseif ($trimmed -match '^(async\s+)?def\s+\w+') {
                # Grab continuation lines if signature spans multiple lines
                $sig = $trimmed
                while (-not $sig.Contains("):") -and -not $sig.Contains(") :") -and -not $sig.Contains(") ->") -and ($i + 1) -lt $lines.Count) {
                    $i++
                    $sig += " " + $lines[$i].TrimStart()
                    if ($sig.Length -gt 400) { break }
                }
                # Clean up: collapse whitespace, remove body
                $sig = $sig -replace '\s+', ' '
                $sig = $sig -replace '\s*:\s*$', ''
                # Truncate if still too long
                if ($sig.Length -gt 250) {
                    $sig = $sig.Substring(0, 247) + "..."
                }
                $indent = if ($line -match '^\s{4,}') { "    " } else { "" }
                $fileSignatures += "  ${indent}L${lineNum}: $sig"
            }
        }
        else {
            # TypeScript/JavaScript
            # export function, export const X = (, function X(
            if ($trimmed -match '^export\s+(default\s+)?(async\s+)?function\s+\w+' -or
                $trimmed -match '^(async\s+)?function\s+\w+' -or
                $trimmed -match '^export\s+(const|let|var)\s+\w+\s*=' -or
                $trimmed -match '^(const|let|var)\s+\w+\s*=\s*(async\s+)?\(') {
                $sig = $trimmed -replace '\s+', ' '
                $sig = $sig -replace '\{.*$', ''
                if ($sig.Length -gt 250) { $sig = $sig.Substring(0, 247) + "..." }
                $fileSignatures += "  L${lineNum}: $sig"
            }
            # interface / type
            elseif ($trimmed -match '^(export\s+)?(interface|type)\s+\w+') {
                $sig = $trimmed -replace '\{.*$', '' -replace '=.*$', ''
                $fileSignatures += "  L${lineNum}: $sig"
            }
            # class
            elseif ($trimmed -match '^(export\s+)?(default\s+)?class\s+\w+') {
                $sig = $trimmed -replace '\{.*$', ''
                $fileSignatures += "  L${lineNum}: $sig"
            }
        }
    }

    if ($fileSignatures.Count -gt 0) {
        $results += "=== $relPath ($sizeKB KB) ==="
        $results += $fileSignatures
        $results += ""
    }
}

# Write output
$results | Out-File -FilePath $OutputFile -Encoding UTF8

$outSize = [math]::Round((Get-Item $OutputFile).Length / 1024, 1)
Write-Host ""
Write-Host "DONE! Output: $OutputFile ($outSize KB)" -ForegroundColor Green
Write-Host "Paste that file's contents into Claude." -ForegroundColor Yellow
