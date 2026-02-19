"""Import and collection endpoints for companies."""

import csv
import io
import re

from fastapi import APIRouter, BackgroundTasks, File, UploadFile
from fastapi import HTTPException

import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.company_routes.models import CompanyCollectionRequest
from api.routes.company_routes.models import CompanyCollectResponse, CompanyImportResponse
from services.web_automation.linkedin.salesnav.flows.company_collection import collect_companies_from_query
from services.web_automation.linkedin.salesnav.filter_parser import infer_company_vertical_if_missing

router = APIRouter()


@router.post("/import", response_model=CompanyImportResponse, responses=COMMON_ERROR_RESPONSES)
async def import_companies(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    imported = 0

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(targets)")
        target_columns = {str(row[1]).lower() for row in cursor.fetchall()}
        has_vertical = "vertical" in target_columns
        has_tier = "tier" in target_columns
        has_target_reason = "target_reason" in target_columns
        has_wedge = "wedge" in target_columns
        has_source = "source" in target_columns
        has_status = "status" in target_columns
        for row in reader:
            company_name = row.get("Company", "").strip()
            if not company_name:
                continue
            domain = re.sub(r"[\W_]+", "-", company_name.lower()).strip("-")
            columns = ["domain", "company_name"]
            values = [domain, company_name]
            if has_tier:
                columns.append("tier")
                values.append(row.get("Tier", "").strip())
            if has_vertical:
                csv_vertical = row.get("Vertical", "").strip()
                # Auto-classify if the CSV doesn't provide a vertical
                vertical_value = infer_company_vertical_if_missing(
                    company_name, domain, csv_vertical
                )
                columns.append("vertical")
                values.append(vertical_value or "")
            if has_target_reason:
                columns.append("target_reason")
                values.append(row.get("Why this is a good Zco target", "").strip())
            if has_wedge:
                columns.append("wedge")
                values.append(row.get("Zco wedge", "").strip())
            if has_source:
                columns.append("source")
                values.append("csv")
            if has_status:
                columns.append("status")
                values.append("pending")
            placeholders = ", ".join(["?"] * len(columns))
            cursor.execute(
                f"INSERT OR REPLACE INTO targets ({', '.join(columns)}) VALUES ({placeholders})",
                tuple(values),
            )
            imported += 1
    return CompanyImportResponse(imported=imported)


@router.post("/collect", response_model=CompanyCollectResponse, responses=COMMON_ERROR_RESPONSES)
async def collect_companies(request: CompanyCollectionRequest, background_tasks: BackgroundTasks):
    """
    Automatically collect companies from LinkedIn Sales Navigator using a natural language query.
    """
    _ = background_tasks  # Kept for compatibility with existing client calls.
    try:
        result = await collect_companies_from_query(
            query=request.query,
            max_companies=request.max_companies,
            headless=False,
            save_to_db=request.save_to_db,
        )
        return CompanyCollectResponse.model_validate(result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
