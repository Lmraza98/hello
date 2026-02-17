"""LLM helper for research route modules."""

import json
import os

import httpx

from api.observability import compute_openai_cost_usd, record_cost

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


async def llm_assess(prompt: str, max_tokens: int = 400) -> dict:
    """Use OpenAI to assess ICP fit. Returns parsed JSON or error."""
    if not OPENAI_API_KEY:
        return {"error": "OPENAI_API_KEY not configured"}

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=20.0,
            )
            data = response.json()
            usage = data.get("usage") or {}
            prompt_tokens = int(usage.get("prompt_tokens") or 0)
            completion_tokens = int(usage.get("completion_tokens") or 0)
            model = "gpt-4o-mini"
            record_cost(
                provider="openai",
                model=model,
                feature="research",
                endpoint="/api/research/assess",
                usd=compute_openai_cost_usd(model, prompt_tokens, completion_tokens),
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
            )
            content = data["choices"][0]["message"]["content"].strip()
            content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            return json.loads(content)
        except json.JSONDecodeError:
            return {"error": "LLM returned non-JSON response", "raw": content[:300]}
        except Exception as exc:
            return {"error": str(exc)}
