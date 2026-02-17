from typing import Any
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from openai import AsyncOpenAI

from api.observability import compute_openai_cost_usd, record_cost
import database as db

router = APIRouter(prefix='/api/chat', tags=['chat'])
DEFAULT_CHAT_MODEL = (
  os.getenv('CHAT_DEFAULT_MODEL')
  or os.getenv('LLM_MODEL_SMART')
  or os.getenv('LLM_MODEL')
  or 'gpt-4o-mini'
)


class ChatRequest(BaseModel):
  messages: list[dict[str, Any]]
  tools: list[dict[str, Any]] | None = None
  model: str = DEFAULT_CHAT_MODEL
  provider: str = 'openai'
  temperature: float = 0.3
  top_p: float | None = None
  top_k: int | None = None


class ChatResponse(BaseModel):
  message: dict[str, Any]
  usage: dict[str, Any] | None = None


class ChatTraceRequest(BaseModel):
  user_message: str | None = None
  route: str | None = None
  route_reason: str | None = None
  model_used: str | None = None
  tool_brain_name: str | None = None
  tool_brain_model: str | None = None
  tools_used: list[str] = Field(default_factory=list)
  fallback_used: bool = False
  success: bool = True
  failure_reason: str | None = None
  native_tool_calls: int | None = None
  token_tool_calls: int | None = None
  selected_tools: list[str] = Field(default_factory=list)
  model_switches: list[dict[str, str]] = Field(default_factory=list)
  response_preview: str | None = None


@router.post('/completions', response_model=ChatResponse)
async def chat_completion(req: ChatRequest, request: Request) -> ChatResponse:
  try:
    provider = (req.provider or 'openai').strip().lower()
    model = req.model or DEFAULT_CHAT_MODEL
    tools_payload = req.tools if req.tools else None
    completion_kwargs: dict[str, Any] = {
      'model': model,
      'messages': req.messages,
      'temperature': req.temperature,
      'top_p': req.top_p,
    }
    if tools_payload:
      completion_kwargs['tools'] = tools_payload
      completion_kwargs['tool_choice'] = 'auto'
    if provider == 'openrouter':
      openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
      if not openrouter_key:
        raise HTTPException(status_code=400, detail={'code': 'missing_openrouter_key', 'message': 'OPENROUTER_API_KEY is not configured'})
      client = AsyncOpenAI(
        base_url='https://openrouter.ai/api/v1',
        api_key=openrouter_key,
      )
      extra_body: dict[str, Any] = {}
      if req.top_k is not None:
        extra_body['top_k'] = req.top_k
      completion = await client.chat.completions.create(**{
        **completion_kwargs,
        'extra_body': extra_body or None,
        'extra_headers': {
          "HTTP-Referer": "http://localhost",
          "X-Title": "Hello Chat Engine",
        },
      })
    else:
      client = AsyncOpenAI()
      completion = await client.chat.completions.create(**completion_kwargs)
    usage = completion.usage
    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    record_cost(
      provider=provider,
      model=model,
      feature='chat',
      endpoint='/api/chat/completions',
      usd=compute_openai_cost_usd(model, prompt_tokens, completion_tokens),
      input_tokens=prompt_tokens,
      output_tokens=completion_tokens,
      request_id=getattr(request.state, 'request_id', None),
      correlation_id=getattr(request.state, 'correlation_id', None),
    )
  except Exception as exc:
    raise HTTPException(status_code=500, detail={'code': 'openai_error', 'message': str(exc)}) from exc

  return ChatResponse(
    message=completion.choices[0].message.model_dump(),
    usage=completion.usage.model_dump() if completion.usage else None,
  )


@router.post('/trace')
async def chat_trace(req: ChatTraceRequest, request: Request) -> dict[str, Any]:
  try:
    tools_used = req.tools_used or []
    model_used = req.model_used or "unknown"
    route = req.route or "unknown"
    route_reason = req.route_reason or "unknown"
    status = "ok" if req.success else "failed"
    tool_summary = ", ".join(tools_used[:4]) if tools_used else "none"
    message = f"chat_trace {status} model={model_used} route={route} reason={route_reason} tools={tool_summary}"

    db.insert_log(
      {
        "level": "info" if req.success else "warn",
        "feature": "chat_trace",
        "source": "chat_ui",
        "message": message,
        "correlation_id": getattr(request.state, "correlation_id", None),
        "request_id": getattr(request.state, "request_id", None),
        "status_code": 200,
        "meta_json": req.model_dump(),
      }
    )
    return {"ok": True}
  except Exception as exc:
    raise HTTPException(status_code=500, detail={"code": "trace_error", "message": str(exc)}) from exc
