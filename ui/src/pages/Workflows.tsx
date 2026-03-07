import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Workflow, 
  Plus, 
  Trash2, 
  Save,
  X,
  Mail,
  Building2,
  Users,
  FolderKanban
} from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';

type WorkflowStep = {
  id: string;
  type: 'salesforce_upload' | 'linkedin_request' | 'send_email';
  campaign_id?: number;
  position: { x: number; y: number };
};

type WorkflowData = {
  id?: number;
  name: string;
  description?: string;
  workflow_json: {
    steps: WorkflowStep[];
  };
};

export default function Workflows() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [activeTab, setActiveTab] = useState<'workflows' | 'campaigns'>('workflows');
  const queryClient = useQueryClient();

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      const res = await fetch('/api/workflows');
      if (!res.ok) {
        console.error('Failed to fetch workflows:', res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/workflows/campaigns');
      if (!res.ok) {
        console.error('Failed to fetch campaigns:', res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const createWorkflow = useMutation({
    mutationFn: async (data: WorkflowData) => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setIsCreating(false);
      setWorkflowName('');
      setWorkflowDescription('');
      setWorkflowSteps([]);
    },
  });

  const updateWorkflow = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: WorkflowData }) => {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setSelectedWorkflow(null);
    },
  });

  const deleteWorkflow = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'DELETE',
      });
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      if (selectedWorkflow === id) {
        setSelectedWorkflow(null);
      }
    },
  });


  const handleAddStep = (type: WorkflowStep['type']) => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      type,
      position: {
        x: workflowSteps.length * 200 + 100,
        y: 150,
      },
    };
    setWorkflowSteps([...workflowSteps, newStep]);
  };

  const handleRemoveStep = (stepId: string) => {
    setWorkflowSteps(workflowSteps.filter(s => s.id !== stepId));
  };

  const handleSaveWorkflow = () => {
    if (!workflowName.trim()) return;

    const workflowData: WorkflowData = {
      name: workflowName,
      description: workflowDescription,
      workflow_json: {
        steps: workflowSteps,
      },
    };

    if (selectedWorkflow) {
      updateWorkflow.mutate({ id: selectedWorkflow, data: workflowData });
    } else {
      createWorkflow.mutate(workflowData);
    }
  };

  const handleLoadWorkflow = (workflow: any) => {
    setSelectedWorkflow(workflow.id);
    setWorkflowName(workflow.name);
    setWorkflowDescription(workflow.description || '');
    const json = workflow.workflow_json || {};
    setWorkflowSteps(json.steps || []);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="pt-3 px-3 pb-3 md:pt-4 md:px-4 md:pb-4">
      <PageHeader
        title="Workflows & Campaigns"
        subtitle="Create automated workflows for lead management and outreach"
        desktopActions={activeTab === 'workflows' ? (
          <button
            onClick={() => {
              setIsCreating(true);
              setSelectedWorkflow(null);
              setWorkflowName('');
              setWorkflowDescription('');
              setWorkflowSteps([]);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Workflow
          </button>
        ) : undefined}
        mobileActions={activeTab === 'workflows' ? (
          <button
            onClick={() => {
              setIsCreating(true);
              setSelectedWorkflow(null);
              setWorkflowName('');
              setWorkflowDescription('');
              setWorkflowSteps([]);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        ) : undefined}
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('workflows')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'workflows'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-muted hover:text-text'
          }`}
        >
          <Workflow className="w-4 h-4 inline mr-2" />
          Workflows
        </button>
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'campaigns'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-muted hover:text-text'
          }`}
        >
          <FolderKanban className="w-4 h-4 inline mr-2" />
          Campaigns
        </button>
      </div>

      {activeTab === 'workflows' ? (
      <div className="grid grid-cols-3 gap-6">
        {/* Workflows List */}
        <div className="col-span-1 bg-surface border border-border rounded-xl p-4">
          <h2 className="font-medium text-text mb-4">Saved Workflows</h2>
          <div className="space-y-2">
            {workflows.map((workflow: any) => (
              <div
                key={workflow.id}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedWorkflow === workflow.id
                    ? 'bg-accent/10 border-accent'
                    : 'bg-surface-hover border-border hover:border-accent/50'
                }`}
                onClick={() => handleLoadWorkflow(workflow)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-text text-sm">{workflow.name}</h3>
                    {workflow.description && (
                      <p className="text-xs text-text-dim mt-1">{workflow.description}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteWorkflow.mutate(workflow.id);
                    }}
                    className="p-1 hover:bg-surface rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-text-dim" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Workflow Builder */}
        <div className="col-span-2 bg-surface border border-border rounded-xl p-6">
          {(isCreating || selectedWorkflow) ? (
            <div className="space-y-4">
              {/* Workflow Info */}
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Workflow Name"
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  className="w-full px-4 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                />
                <textarea
                  placeholder="Description (optional)"
                  value={workflowDescription}
                  onChange={(e) => setWorkflowDescription(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent resize-none"
                />
              </div>

              {/* Step Types */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm text-text-muted">Add Step:</span>
                <button
                  onClick={() => handleAddStep('salesforce_upload')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-surface-hover border border-border rounded-lg text-sm text-text hover:border-accent transition-colors"
                >
                  <Building2 className="w-4 h-4" />
                  Salesforce Upload
                </button>
                <button
                  onClick={() => handleAddStep('linkedin_request')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-surface-hover border border-border rounded-lg text-sm text-text hover:border-accent transition-colors"
                >
                  <Users className="w-4 h-4" />
                  LinkedIn Request
                </button>
                <button
                  onClick={() => handleAddStep('send_email')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-surface-hover border border-border rounded-lg text-sm text-text hover:border-accent transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  Send Email
                </button>
              </div>

              {/* Workflow Canvas */}
              <div className="relative min-h-[400px] bg-bg border border-border rounded-lg p-6">
                {workflowSteps.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-text-dim">
                    <p>Add steps to build your workflow</p>
                  </div>
                ) : (
                  <div className="relative">
                    {workflowSteps.map((step) => (
                      <div
                        key={step.id}
                        className="absolute bg-surface border border-border rounded-lg p-4 min-w-[200px]"
                        style={{
                          left: step.position.x,
                          top: step.position.y,
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {step.type === 'salesforce_upload' && <Building2 className="w-4 h-4 text-accent" />}
                            {step.type === 'linkedin_request' && <Users className="w-4 h-4 text-accent" />}
                            {step.type === 'send_email' && <Mail className="w-4 h-4 text-accent" />}
                            <span className="text-sm font-medium text-text">
                              {step.type === 'salesforce_upload' && 'Salesforce Upload'}
                              {step.type === 'linkedin_request' && 'LinkedIn Request'}
                              {step.type === 'send_email' && 'Send Email'}
                            </span>
                          </div>
                          <button
                            onClick={() => handleRemoveStep(step.id)}
                            className="p-1 hover:bg-surface-hover rounded transition-colors"
                          >
                            <X className="w-3 h-3 text-text-dim" />
                          </button>
                        </div>
                        
                        {step.type === 'send_email' && (
                          <select
                            value={step.campaign_id || ''}
                            onChange={(e) => {
                              const updated = workflowSteps.map(s =>
                                s.id === step.id
                                  ? { ...s, campaign_id: parseInt(e.target.value) }
                                  : s
                              );
                              setWorkflowSteps(updated);
                            }}
                            className="w-full mt-2 px-2 py-1 bg-bg border border-border rounded text-sm text-text"
                          >
                            <option value="">Select Campaign</option>
                            {campaigns.map((campaign: any) => (
                              <option key={campaign.id} value={campaign.id}>
                                {campaign.title}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                    
                    {/* Connection lines */}
                    {workflowSteps.length > 1 && (
                      <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
                        {workflowSteps.slice(0, -1).map((step, index) => {
                          const nextStep = workflowSteps[index + 1];
                          return (
                            <line
                              key={`line-${index}`}
                              x1={step.position.x + 200}
                              y1={step.position.y + 40}
                              x2={nextStep.position.x}
                              y2={nextStep.position.y + 40}
                              stroke="currentColor"
                              strokeWidth="2"
                              className="text-border"
                            />
                          );
                        })}
                      </svg>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setSelectedWorkflow(null);
                    setWorkflowName('');
                    setWorkflowDescription('');
                    setWorkflowSteps([]);
                  }}
                  className="px-4 py-2 border border-border rounded-lg text-sm text-text hover:bg-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveWorkflow}
                  disabled={!workflowName.trim() || createWorkflow.isPending || updateWorkflow.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  Save Workflow
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[400px] text-text-dim">
              <div className="text-center">
                <Workflow className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a workflow or create a new one to get started</p>
              </div>
            </div>
          )}
        </div>
      </div>
      ) : (
        <CampaignsManager campaigns={campaigns} queryClient={queryClient} />
      )}
      </div>
    </div>
  );
}

function CampaignsManager({ campaigns, queryClient }: { campaigns: any[]; queryClient: any }) {
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [campaignTitle, setCampaignTitle] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');

  const createCampaign = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/workflows/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setIsCreating(false);
      resetForm();
    },
  });

  const updateCampaign = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await fetch(`/api/workflows/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setSelectedCampaign(null);
      resetForm();
    },
  });

  const deleteCampaign = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/workflows/campaigns/${id}`, {
        method: 'DELETE',
      });
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      if (selectedCampaign === id) {
        setSelectedCampaign(null);
        resetForm();
      }
    },
  });

  const resetForm = () => {
    setCampaignTitle('');
    setCampaignDescription('');
    setSubjectTemplate('');
    setBodyTemplate('');
  };

  const handleLoadCampaign = (campaign: any) => {
    setSelectedCampaign(campaign.id);
    setCampaignTitle(campaign.title);
    setCampaignDescription(campaign.description || '');
    setSubjectTemplate(campaign.subject_template || '');
    setBodyTemplate(campaign.body_template || '');
  };

  const handleSave = () => {
    if (!campaignTitle.trim()) return;

    const data = {
      title: campaignTitle,
      description: campaignDescription,
      subject_template: subjectTemplate,
      body_template: bodyTemplate,
    };

    if (selectedCampaign) {
      updateCampaign.mutate({ id: selectedCampaign, data });
    } else {
      createCampaign.mutate(data);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Campaigns List */}
      <div className="col-span-1 bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-text">Campaigns</h2>
          <button
            onClick={() => {
              setIsCreating(true);
              setSelectedCampaign(null);
              resetForm();
            }}
            className="p-1.5 hover:bg-surface-hover rounded transition-colors"
          >
            <Plus className="w-4 h-4 text-text-dim" />
          </button>
        </div>
        <div className="space-y-2">
          {campaigns.map((campaign: any) => (
            <div
              key={campaign.id}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedCampaign === campaign.id
                  ? 'bg-accent/10 border-accent'
                  : 'bg-surface-hover border-border hover:border-accent/50'
              }`}
              onClick={() => handleLoadCampaign(campaign)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-medium text-text text-sm">{campaign.title}</h3>
                  {campaign.description && (
                    <p className="text-xs text-text-dim mt-1 line-clamp-1">{campaign.description}</p>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCampaign.mutate(campaign.id);
                  }}
                  className="p-1 hover:bg-surface rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-text-dim" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign Editor */}
      <div className="col-span-2 bg-surface border border-border rounded-xl p-6">
        {(isCreating || selectedCampaign) ? (
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Campaign Title (e.g., CEO Introduction Message)"
              value={campaignTitle}
              onChange={(e) => setCampaignTitle(e.target.value)}
              className="w-full px-4 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
            />
            <textarea
              placeholder="Description (optional)"
              value={campaignDescription}
              onChange={(e) => setCampaignDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent resize-none"
            />
            <div>
              <label className="block text-sm font-medium text-text mb-2">Subject Template</label>
              <input
                type="text"
                placeholder="Quick question for {company}"
                value={subjectTemplate}
                onChange={(e) => setSubjectTemplate(e.target.value)}
                className="w-full px-4 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
              />
              <p className="text-xs text-text-dim mt-1">Use {'{company}'}, {'{name}'}, {'{firstName}'}, {'{lastName}'} for dynamic values</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-2">Body Template</label>
              <textarea
                placeholder="Hi {firstName},&#10;&#10;I help companies like {company} {value_prop}.&#10;&#10;Would it make sense to have a brief call this week?&#10;&#10;Best,&#10;{sender_name}"
                value={bodyTemplate}
                onChange={(e) => setBodyTemplate(e.target.value)}
                rows={10}
                className="w-full px-4 py-2 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent resize-none font-mono text-sm"
              />
              <p className="text-xs text-text-dim mt-1">
                Available variables: {'{name}'}, {'{firstName}'}, {'{lastName}'}, {'{company}'}, {'{title}'}, {'{value_prop}'}, {'{sender_name}'}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setIsCreating(false);
                  setSelectedCampaign(null);
                  resetForm();
                }}
                className="px-4 py-2 border border-border rounded-lg text-sm text-text hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!campaignTitle.trim() || createCampaign.isPending || updateCampaign.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                Save Campaign
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[400px] text-text-dim">
            <div className="text-center">
              <FolderKanban className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Select a campaign or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
