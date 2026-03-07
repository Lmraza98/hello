from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

import config
from services.leadforge.store import export_leads_csv, get_credit_summary, list_leads_by_ids, list_run_leads, save_leads_to_contacts


router = APIRouter(prefix='/api/leads', tags=['leads'])


class ExportLeadsRequest(BaseModel):
    run_id: str | None = None
    lead_ids: list[int] = Field(default_factory=list)


class SaveLeadsRequest(BaseModel):
    lead_ids: list[int] = Field(default_factory=list)
    target: str = 'contacts'
    list_id: str | None = None


class ExportCrmRequest(BaseModel):
    provider: str
    run_id: str | None = None
    lead_ids: list[int] = Field(default_factory=list)


def _webhook_for_provider(provider: str) -> str:
    p = provider.strip().lower()
    if p == 'hubspot':
        return config.LEADFORGE_HUBSPOT_WEBHOOK_URL
    if p == 'pipedrive':
        return config.LEADFORGE_PIPEDRIVE_WEBHOOK_URL
    return ''


@router.post('/export/csv')
def export_leads(req: ExportLeadsRequest):
    if not req.run_id and not req.lead_ids:
        raise HTTPException(status_code=400, detail={'error': 'run_id_or_lead_ids_required'})
    filename, csv_text = export_leads_csv(run_id=req.run_id, lead_ids=req.lead_ids)
    headers = {'Content-Disposition': f'attachment; filename={filename}'}
    return Response(content=csv_text, media_type='text/csv', headers=headers)


@router.post('/save')
def save_leads(req: SaveLeadsRequest):
    if req.target != 'contacts':
        raise HTTPException(status_code=400, detail={'error': 'unsupported_target', 'supported': ['contacts']})
    if not req.lead_ids:
        raise HTTPException(status_code=400, detail={'error': 'lead_ids_required'})
    stats = save_leads_to_contacts(req.lead_ids)
    return {'ok': True, **stats}


@router.post('/export/crm')
def export_leads_crm(req: ExportCrmRequest):
    provider = (req.provider or '').strip().lower()
    if provider not in {'hubspot', 'pipedrive'}:
        raise HTTPException(status_code=400, detail={'error': 'unsupported_provider', 'supported': ['hubspot', 'pipedrive']})
    webhook_url = _webhook_for_provider(provider)
    if not webhook_url:
        raise HTTPException(
            status_code=400,
            detail={'error': 'webhook_not_configured', 'provider': provider},
        )

    rows = []
    if req.lead_ids:
        rows = list_leads_by_ids(req.lead_ids)
    elif req.run_id:
        rows = list_run_leads(req.run_id)
    else:
        raise HTTPException(status_code=400, detail={'error': 'run_id_or_lead_ids_required'})

    payload = {
        'provider': provider,
        'sent_at': datetime.now(timezone.utc).isoformat(),
        'count': len(rows),
        'leads': rows,
    }
    body = json.dumps(payload, ensure_ascii=True).encode('utf-8')
    request = Request(
        webhook_url,
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=15) as response:
            status = int(getattr(response, 'status', 200) or 200)
    except Exception as exc:
        raise HTTPException(status_code=502, detail={'error': 'crm_export_failed', 'message': str(exc), 'provider': provider}) from exc

    return {'ok': True, 'provider': provider, 'sent': len(rows), 'status_code': status}


@router.get('/credits')
def get_lead_credits(user_id: str | None = None):
    summary = get_credit_summary(user_id=user_id, monthly_limit=config.LEADFORGE_FREE_LEADS_PER_MONTH)
    return {'ok': True, **summary}


@router.get('/runs/{run_id}')
def get_run_leads(run_id: str):
    rows = list_run_leads(run_id)
    return {'ok': True, 'run_id': run_id, 'count': len(rows), 'items': rows}
