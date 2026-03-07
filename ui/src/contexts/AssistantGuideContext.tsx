import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AssistantHighlightLayer } from '../components/assistant/AssistantHighlightLayer';

export interface AssistantGuideState {
  active: boolean;
  activeStep: string | null;
  highlightedElementId: string | null;
  scrollTargetId: string | null;
  interaction: 'highlight' | 'click';
  pointerMode: 'passthrough' | 'interactive';
  autoClick: boolean;
  sequence: number;
}

type AssistantUiFlowId = 'create_contact';

type AssistantUiFlowStep = {
  id: string;
  elementId: string;
  scrollTargetId: string;
  activeStep: string;
  interaction: 'highlight' | 'click';
  pointerMode: 'passthrough' | 'interactive';
  autoClick: boolean;
  completion: {
    type: 'user_click' | 'manual';
    targetId?: string;
  };
};

type AssistantUiFlowRuntime = {
  flowId: AssistantUiFlowId;
  stepIndex: number;
  status: 'active' | 'completed';
  sequence: number;
};

type AssistantGuideSessionState = {
  guideState: AssistantGuideState;
  flowState: AssistantUiFlowRuntime | null;
};

type HighlightOptions = {
  elementId: string;
  scrollTargetId?: string | null;
  activeStep?: string | null;
  interaction?: 'highlight' | 'click';
  pointerMode?: 'passthrough' | 'interactive';
  autoClick?: boolean;
};

interface AssistantGuideApi {
  guideState: AssistantGuideState;
  activeSessionId: string | null;
  setActiveSession: (sessionId: string) => void;
  highlight: (options: HighlightOptions) => void;
  clearHighlight: () => void;
  startFlow: (flowId: AssistantUiFlowId) => void;
}

const INITIAL_STATE: AssistantGuideState = {
  active: false,
  activeStep: null,
  highlightedElementId: null,
  scrollTargetId: null,
  interaction: 'highlight',
  pointerMode: 'interactive',
  autoClick: false,
  sequence: 0,
};

const INITIAL_SESSION_STATE: AssistantGuideSessionState = {
  guideState: INITIAL_STATE,
  flowState: null,
};

const FLOW_DEFINITIONS: Record<AssistantUiFlowId, AssistantUiFlowStep[]> = {
  create_contact: [
    {
      id: 'create_contact.open_button',
      elementId: 'new-contact-button',
      scrollTargetId: 'new-contact-button',
      activeStep: 'Click New Contact',
      interaction: 'click',
      pointerMode: 'passthrough',
      autoClick: false,
      completion: {
        type: 'user_click',
        targetId: 'new-contact-button',
      },
    },
    {
      id: 'create_contact.form_panel',
      elementId: 'contact-create-panel',
      scrollTargetId: 'contact-create-panel',
      activeStep: 'Use this form to add the new contact details',
      interaction: 'highlight',
      pointerMode: 'interactive',
      autoClick: false,
      completion: {
        type: 'manual',
      },
    },
  ],
};

function getFlowSteps(flowId: AssistantUiFlowId | null | undefined): AssistantUiFlowStep[] {
  if (!flowId) return [];
  return FLOW_DEFINITIONS[flowId] || [];
}

function getFlowGuideState(flowState: AssistantUiFlowRuntime | null): AssistantGuideState | null {
  if (!flowState || flowState.status !== 'active') return null;
  const step = getFlowSteps(flowState.flowId)[flowState.stepIndex];
  if (!step) return null;
  return {
    active: true,
    activeStep: step.activeStep,
    highlightedElementId: step.elementId,
    scrollTargetId: step.scrollTargetId,
    interaction: step.interaction,
    pointerMode: step.pointerMode,
    autoClick: step.autoClick,
    sequence: flowState.sequence,
  };
}

function resolveGuideState(sessionState: AssistantGuideSessionState | undefined): AssistantGuideState {
  const flowGuideState = getFlowGuideState(sessionState?.flowState || null);
  if (flowGuideState) return flowGuideState;
  return sessionState?.guideState || INITIAL_STATE;
}

const AssistantGuideContext = createContext<AssistantGuideApi | undefined>(undefined);

export function AssistantGuideProvider({ children }: { children: ReactNode }) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionGuideStates, setSessionGuideStates] = useState<Record<string, AssistantGuideSessionState>>({});

  const guideState = useMemo<AssistantGuideState>(() => {
    if (!activeSessionId) return INITIAL_STATE;
    return resolveGuideState(sessionGuideStates[activeSessionId]);
  }, [activeSessionId, sessionGuideStates]);

  const activeFlowState = useMemo<AssistantUiFlowRuntime | null>(() => {
    if (!activeSessionId) return null;
    return sessionGuideStates[activeSessionId]?.flowState || null;
  }, [activeSessionId, sessionGuideStates]);

  const setActiveSession = useCallback((sessionId: string) => {
    const normalized = String(sessionId || '').trim();
    setActiveSessionId(normalized || null);
  }, []);

  const highlight = useCallback((options: HighlightOptions) => {
    if (!activeSessionId) return;
    const elementId = String(options.elementId || '').trim();
    if (!elementId) {
      setSessionGuideStates((prev) => {
        if (!prev[activeSessionId]) return prev;
        return { ...prev, [activeSessionId]: INITIAL_SESSION_STATE };
      });
      return;
    }
    setSessionGuideStates((prev) => ({
      ...prev,
      [activeSessionId]: {
        guideState: {
          active: true,
          activeStep: options.activeStep?.trim() || null,
          highlightedElementId: elementId,
          scrollTargetId: options.scrollTargetId?.trim() || elementId,
          interaction: options.interaction || 'highlight',
          pointerMode: options.pointerMode || (options.interaction === 'click' ? 'passthrough' : 'interactive'),
          autoClick: options.autoClick === true,
          sequence: Date.now(),
        },
        flowState: null,
      },
    }));
  }, [activeSessionId]);

  const clearHighlight = useCallback(() => {
    if (!activeSessionId) return;
    setSessionGuideStates((prev) => {
      if (!prev[activeSessionId]) return prev;
      return { ...prev, [activeSessionId]: INITIAL_SESSION_STATE };
    });
  }, [activeSessionId]);

  const startFlow = useCallback((flowId: AssistantUiFlowId) => {
    if (!activeSessionId) return;
    if (!FLOW_DEFINITIONS[flowId]) return;
    setSessionGuideStates((prev) => ({
      ...prev,
      [activeSessionId]: {
        guideState: INITIAL_STATE,
        flowState: {
          flowId,
          stepIndex: 0,
          status: 'active',
          sequence: Date.now(),
        },
      },
    }));
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || !activeFlowState || activeFlowState.status !== 'active') return undefined;
    const steps = getFlowSteps(activeFlowState.flowId);
    const currentStep = steps[activeFlowState.stepIndex];
    if (!currentStep || currentStep.completion.type !== 'user_click' || !currentStep.completion.targetId) return undefined;
    const targetId = currentStep.completion.targetId;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const matched = target.closest<HTMLElement>(`[data-assistant-id="${targetId}"]`);
      if (!matched) return;
      setSessionGuideStates((prev) => {
        const currentSessionState = prev[activeSessionId];
        if (!currentSessionState?.flowState) return prev;
        const flowState = currentSessionState.flowState;
        if (
          flowState.status !== 'active' ||
          flowState.flowId !== activeFlowState.flowId ||
          flowState.stepIndex !== activeFlowState.stepIndex
        ) {
          return prev;
        }
        const nextIndex = flowState.stepIndex + 1;
        const hasNextStep = nextIndex < getFlowSteps(flowState.flowId).length;
        return {
          ...prev,
          [activeSessionId]: {
            guideState: currentSessionState.guideState,
            flowState: hasNextStep
              ? {
                  ...flowState,
                  stepIndex: nextIndex,
                  sequence: Date.now(),
                }
              : {
                  ...flowState,
                  status: 'completed',
                  sequence: Date.now(),
                },
          },
        };
      });
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [activeFlowState, activeSessionId]);

  const value = useMemo<AssistantGuideApi>(
    () => ({
      activeSessionId,
      guideState,
      setActiveSession,
      highlight,
      clearHighlight,
      startFlow,
    }),
    [activeSessionId, clearHighlight, guideState, highlight, setActiveSession, startFlow]
  );

  return (
    <AssistantGuideContext.Provider value={value}>
      {children}
      <AssistantHighlightLayer />
    </AssistantGuideContext.Provider>
  );
}

export function useAssistantGuide() {
  const value = useContext(AssistantGuideContext);
  if (!value) throw new Error('useAssistantGuide must be used inside AssistantGuideProvider');
  return value;
}
