---
summary: "Failure-capture to supervised fine-tune workflow for FunctionGemma tool calling."
read_when:
  - You are improving tool routing with new training examples
  - You need to regenerate train/test JSONL datasets
title: "FunctionGemma Fine-Tune Workflow"
---

# FunctionGemma Fine-Tune Workflow

## 1) Capture failures in UI
- Use chat normally.
- Tool-route failures are auto-captured in localStorage (`functiongemma_finetune_failures_v1`).

## 2) Export bundle from browser console
- `exportFunctionGemmaTrainingBundle()`
- This downloads a JSON file containing:
  - `tools` (exact tool schemas from `ui/src/chat/tools.ts`)
  - `failures` (captured FunctionGemma misses)

## 3) Build annotation template
```bash
python scripts/functiongemma_make_annotation_template.py ^
  --bundle data/functiongemma_training_bundle.json ^
  --out data/functiongemma_annotations.jsonl
```

## 4) Label the template
For each JSONL line:
- set `label_tool_name` to the correct tool
- set `label_arguments` to correct args object
- optionally set `skip: true` for unusable rows

## 5) Build SFT dataset
```bash
python scripts/functiongemma_build_sft_dataset.py ^
  --bundle data/functiongemma_training_bundle.json ^
  --annotations data/functiongemma_annotations.jsonl ^
  --out-train data/functiongemma_train.jsonl ^
  --out-test data/functiongemma_test.jsonl ^
  --test-size 0.2
```

Outputs are Hugging Face SFT-ready JSONL with:
- `messages` (`developer`, `user`, `assistant.tool_calls`)
- `tools` (schemas)

## 6) Train (Colab / Kaggle)
Use your FunctionGemma SFT notebook and load:
- `data/functiongemma_train.jsonl`
- `data/functiongemma_test.jsonl`

System prompt should remain:
- `You are a model that can do function calling with the following functions`

## Notes
- This pipeline is model-driven and intended for iterative fine-tuning.
- Keep adding fresh failures, re-export bundle, re-label, and retrain.

## Tiered Planner Integration

The tool planner now uses a [tiered prompt system](/concepts/tool-planner-tiering) that significantly improves FunctionGemma viability:

- **`minimal` tier** queries (simple lookups like "find Lucas Raza") send ~100 tokens of system prompt with only 3-8 preselected tools. FunctionGemma can handle these in 1-2 seconds.
- **`standard` tier** queries get ~400-600 tokens — still much smaller than the original 3000+ token prompt.
- **`full` tier** queries (browser automation, complex workflows) use the original prompt and are better suited for qwen3/devstral.

When `PLANNER_BACKEND=functiongemma`, the `minimal` tier is the primary path for most user queries. Training data should prioritize these simple lookup patterns.
