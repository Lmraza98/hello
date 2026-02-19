Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$LlamaDir = $env:LLAMA_CPP_TOOL_BRAIN_DIR
if ([string]::IsNullOrWhiteSpace($LlamaDir)) {
  $LlamaDir = "C:\llm\llama"
}

$ModelPath = $env:LLAMA_CPP_TOOL_BRAIN_MODEL_PATH
if ([string]::IsNullOrWhiteSpace($ModelPath)) {
  $ModelPath = "C:\llm\models\qwen2.5-coder-32b\Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf"
}

Set-Location $LlamaDir

.\llama-server.exe `
  -m $ModelPath `
  --alias qwen2.5-coder-32b `
  --host 0.0.0.0 `
  --port 8080 `
  --ctx-size 8192 `
  --n-gpu-layers 999 `
  --tensor-split 0.35,0.65 `
  --main-gpu 1
