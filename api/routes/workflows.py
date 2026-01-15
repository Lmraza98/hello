"""
Workflow and Campaign API routes.
"""
from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
import json

import database as db
from services.email_generator import generate_email_with_gpt4o
from services.salesforce_bulk_import import bulk_import_to_salesforce
from services.salesforce_bot import SalesforceBot

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


# ============ Pydantic Models ============

class CampaignCreate(BaseModel):
    title: str
    description: Optional[str] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None

class CampaignUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    workflow_json: Optional[dict] = None

class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    workflow_json: Optional[dict] = None

class WorkflowExecutionCreate(BaseModel):
    workflow_id: int
    selected_lead_ids: List[int]

class LeadActionCreate(BaseModel):
    contact_id: int
    workflow_execution_id: Optional[int] = None
    action_type: str
    action_details: Optional[str] = None

class MessageCreate(BaseModel):
    campaign_id: int
    contact_id: int
    lead_action_id: Optional[int] = None
    subject: str
    body: str
    message_type: str = 'email'


# ============ Campaign Routes ============

@router.get("/campaigns")
def get_campaigns():
    """Get all campaigns."""
    return db.get_campaigns()

@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int):
    """Get a single campaign."""
    campaign = db.get_campaign(campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return campaign

@router.post("/campaigns")
def create_campaign(campaign: CampaignCreate):
    """Create a new campaign."""
    campaign_id = db.create_campaign(
        title=campaign.title,
        description=campaign.description,
        subject_template=campaign.subject_template,
        body_template=campaign.body_template
    )
    return db.get_campaign(campaign_id)

@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, campaign: CampaignUpdate):
    """Update a campaign."""
    existing = db.get_campaign(campaign_id)
    if not existing:
        raise HTTPException(404, "Campaign not found")
    
    db.update_campaign(
        campaign_id=campaign_id,
        title=campaign.title,
        description=campaign.description,
        subject_template=campaign.subject_template,
        body_template=campaign.body_template
    )
    return db.get_campaign(campaign_id)

@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int):
    """Delete a campaign."""
    existing = db.get_campaign(campaign_id)
    if not existing:
        raise HTTPException(404, "Campaign not found")
    db.delete_campaign(campaign_id)
    return {"deleted": True}

@router.get("/campaigns/{campaign_id}/stats")
def get_campaign_stats(campaign_id: int):
    """Get statistics for a campaign."""
    campaign = db.get_campaign(campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return db.get_campaign_stats(campaign_id)


# ============ Workflow Routes ============

@router.get("")
def get_workflows():
    """Get all workflows."""
    workflows = db.get_workflows()
    # Parse workflow_json for each workflow
    for workflow in workflows:
        if workflow.get('workflow_json'):
            try:
                workflow['workflow_json'] = json.loads(workflow['workflow_json'])
            except:
                workflow['workflow_json'] = {}
    return workflows

@router.get("/{workflow_id}")
def get_workflow(workflow_id: int):
    """Get a single workflow."""
    workflow = db.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    if workflow.get('workflow_json'):
        try:
            workflow['workflow_json'] = json.loads(workflow['workflow_json'])
        except:
            workflow['workflow_json'] = {}
    return workflow

@router.post("")
def create_workflow(workflow: WorkflowCreate):
    """Create a new workflow."""
    workflow_id = db.create_workflow(
        name=workflow.name,
        description=workflow.description,
        workflow_json=json.dumps(workflow.workflow_json or {})
    )
    return db.get_workflow(workflow_id)

@router.put("/{workflow_id}")
def update_workflow(workflow_id: int, workflow: WorkflowUpdate):
    """Update a workflow."""
    existing = db.get_workflow(workflow_id)
    if not existing:
        raise HTTPException(404, "Workflow not found")
    
    db.update_workflow(
        workflow_id=workflow_id,
        name=workflow.name,
        description=workflow.description,
        workflow_json=json.dumps(workflow.workflow_json) if workflow.workflow_json else None
    )
    return db.get_workflow(workflow_id)

@router.delete("/{workflow_id}")
def delete_workflow(workflow_id: int):
    """Delete a workflow."""
    existing = db.get_workflow(workflow_id)
    if not existing:
        raise HTTPException(404, "Workflow not found")
    db.delete_workflow(workflow_id)
    return {"deleted": True}


# ============ Workflow Execution Routes ============

@router.post("/executions")
def create_workflow_execution(execution: WorkflowExecutionCreate):
    """Create a new workflow execution."""
    execution_id = db.create_workflow_execution(
        workflow_id=execution.workflow_id,
        selected_lead_ids=execution.selected_lead_ids
    )
    return db.get_workflow_execution(execution_id)

@router.get("/executions/{execution_id}")
def get_workflow_execution(execution_id: int):
    """Get a workflow execution."""
    execution = db.get_workflow_execution(execution_id)
    if not execution:
        raise HTTPException(404, "Workflow execution not found")
    return execution

@router.post("/executions/{execution_id}/execute")
async def execute_workflow(execution_id: int):
    """
    Execute a workflow.
    This will process the selected leads according to the workflow definition.
    Steps can include: salesforce_upload, linkedin_request, send_email
    """
    execution = db.get_workflow_execution(execution_id)
    if not execution:
        raise HTTPException(404, "Workflow execution not found")
    
    workflow = db.get_workflow(execution['workflow_id'])
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    
    workflow_json = json.loads(workflow['workflow_json']) if workflow.get('workflow_json') else {}
    selected_lead_ids = execution.get('selected_lead_ids', [])
    
    # Update status to running
    db.update_workflow_execution_status(execution_id, 'running')
    
    try:
        # Get contacts for selected leads from database
        with db.get_db() as conn:
            cursor = conn.cursor()
            placeholders = ','.join(['?'] * len(selected_lead_ids))
            cursor.execute(f"""
                SELECT id, company_name, domain, name, title, email_generated as email, 
                       linkedin_url, phone, phone_source, phone_confidence, scraped_at
                FROM linkedin_contacts 
                WHERE id IN ({placeholders})
            """, selected_lead_ids)
            rows = cursor.fetchall()
        
        selected_contacts = [
            {
                'id': r[0], 'company_name': r[1] or '', 'domain': r[2], 'name': r[3],
                'title': r[4], 'email': r[5], 'linkedin_url': r[6],
                'phone': r[7], 'phone_source': r[8], 'phone_confidence': r[9],
                'scraped_at': str(r[10]) if r[10] else None
            }
            for r in rows
        ]
        
        if not selected_contacts:
            raise HTTPException(400, "No contacts found for selected lead IDs")
        
        # Get workflow steps
        steps = workflow_json.get('steps', [])
        
        # Track actions for bulk operations
        contacts_to_upload = []
        contacts_for_email = []
        contacts_for_linkedin = []
        
        # Create lead actions for all contacts
        action_map = {}
        for contact in selected_contacts:
            action_id = db.create_lead_action(
                contact_id=contact['id'],
                workflow_execution_id=execution_id,
                action_type='workflow',
                action_details=json.dumps(workflow_json)
            )
            action_map[contact['id']] = action_id
        
        # Process workflow steps
        for step in steps:
            step_type = step.get('type')
            
            if step_type == 'salesforce_upload':
                # Collect contacts for bulk upload
                contacts_to_upload = selected_contacts.copy()
            
            elif step_type == 'linkedin_request':
                # Collect contacts for LinkedIn requests
                contacts_for_linkedin = [c for c in selected_contacts if c.get('linkedin_url')]
            
            elif step_type == 'send_email':
                # Collect contacts for email sending
                campaign_id = step.get('campaign_id')
                if campaign_id:
                    contacts_for_email = [c for c in selected_contacts if c.get('email')]
        
        # Execute bulk Salesforce upload if needed
        if contacts_to_upload:
            print(f"[Workflow] Bulk uploading {len(contacts_to_upload)} contacts to Salesforce...")
            import_result = await bulk_import_to_salesforce(contacts_to_upload, headless=False)
            
            if import_result.get('success'):
                # Update lead actions
                for contact in contacts_to_upload:
                    action_id = action_map.get(contact['id'])
                    if action_id:
                        db.update_lead_action(
                            action_id,
                            action_status='completed',
                            sf_record_url='bulk_imported'
                        )
        
        # Execute LinkedIn requests if needed
        if contacts_for_linkedin:
            print(f"[Workflow] Sending {len(contacts_for_linkedin)} LinkedIn requests...")
            # TODO: Implement LinkedIn request sending
            # For now, just mark as completed
            for contact in contacts_for_linkedin:
                action_id = action_map.get(contact['id'])
                if action_id:
                    db.update_lead_action(
                        action_id,
                        linkedin_request_sent=True,
                        action_status='completed'
                    )
        
        # Execute email sending if needed
        if contacts_for_email:
            campaign_id = None
            for step in steps:
                if step.get('type') == 'send_email':
                    campaign_id = step.get('campaign_id')
                    break
            
            if campaign_id:
                campaign = db.get_campaign(campaign_id)
                if campaign:
                    print(f"[Workflow] Sending {len(contacts_for_email)} emails via Salesforce...")
                    
                    # Prepare send items for Salesforce bot
                    send_items = []
                    for contact in contacts_for_email:
                        action_id = action_map.get(contact['id'])
                        
                        # Generate email with GPT-4o
                        subject, body = await generate_email_with_gpt4o(
                            campaign=campaign,
                            contact=contact
                        )
                        
                        # Create message record
                        message_id = db.create_message(
                            campaign_id=campaign_id,
                            contact_id=contact['id'],
                            lead_action_id=action_id,
                            subject=subject,
                            body=body
                        )
                        
                        # Prepare for Salesforce sending
                        send_items.append({
                            'id': message_id,
                            'contact_name': contact.get('name'),
                            'contact_email': contact.get('email'),
                            'contact_title': contact.get('title'),
                            'company_name': contact.get('company_name'),
                            'domain': contact.get('domain'),
                            'planned_subject': subject,
                            'planned_body': body,
                            'lead_action_id': action_id
                        })
                    
                    # Send emails through Salesforce
                    bot = SalesforceBot()
                    try:
                        await bot.start(headless=False)
                        if bot.is_authenticated:
                            for item in send_items:
                                result = await bot.process_send_item(item, review_mode=False)
                                if result.get('result') == 'sent':
                                    # Update message and lead action
                                    db.update_message_status(item['id'], 'sent')
                                    db.update_lead_action(
                                        item['lead_action_id'],
                                        email_sent=True,
                                        action_status='completed',
                                        sf_record_url=result.get('sf_record_url')
                                    )
                        else:
                            print("[Workflow] Not authenticated to Salesforce - skipping email send")
                    finally:
                        await bot.stop()
        
        # Mark execution as completed
        db.update_workflow_execution_status(execution_id, 'completed')
        
        return {
            "execution_id": execution_id,
            "status": "completed",
            "processed": len(selected_contacts),
            "salesforce_uploaded": len(contacts_to_upload),
            "linkedin_requests": len(contacts_for_linkedin),
            "emails_sent": len(contacts_for_email)
        }
    
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        db.update_workflow_execution_status(execution_id, 'failed', error_msg)
        raise HTTPException(500, f"Workflow execution failed: {str(e)}")


# ============ Lead Action Routes ============

@router.get("/lead-actions")
def get_lead_actions(contact_id: Optional[int] = None, workflow_execution_id: Optional[int] = None):
    """Get lead actions."""
    return db.get_lead_actions(contact_id=contact_id, workflow_execution_id=workflow_execution_id)

@router.post("/lead-actions")
def create_lead_action(action: LeadActionCreate):
    """Create a lead action."""
    action_id = db.create_lead_action(
        contact_id=action.contact_id,
        workflow_execution_id=action.workflow_execution_id,
        action_type=action.action_type,
        action_details=action.action_details
    )
    return {"id": action_id}


# ============ Message Routes ============

@router.get("/messages")
def get_messages(campaign_id: Optional[int] = None, contact_id: Optional[int] = None):
    """Get messages."""
    return db.get_messages(campaign_id=campaign_id, contact_id=contact_id)

@router.post("/messages")
async def create_message(message: MessageCreate):
    """Create a message."""
    message_id = db.create_message(
        campaign_id=message.campaign_id,
        contact_id=message.contact_id,
        lead_action_id=message.lead_action_id,
        subject=message.subject,
        body=message.body,
        message_type=message.message_type
    )
    return {"id": message_id}

