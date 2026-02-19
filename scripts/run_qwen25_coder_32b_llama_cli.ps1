Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location "C:\llm\llama"

.\llama-cli.exe -m "C:\llm\models\qwen2.5-coder-32b\Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf" `
  --n-gpu-layers 999 `
  --tensor-split 0.35,0.65 `
  --main-gpu 1 `
  -c 8192 `
  -n 16 `
  -p "Reply with: OK"
