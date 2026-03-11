'use client';

import { useEffect, useState } from 'react';
import { useAssistantGuide } from '../../contexts/AssistantGuideContext';

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type Bounds = Rect & {
  right: number;
  bottom: number;
};

function escapeAssistantId(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function getElementRect(element: HTMLElement): Bounds {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function isOffscreen(rect: Bounds): boolean {
  const margin = 32;
  return (
    rect.bottom < margin ||
    rect.top > window.innerHeight - margin ||
    rect.right < margin ||
    rect.left > window.innerWidth - margin
  );
}

function getFocusedAssistantTargetId(): string | null {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  const panelId = activeElement.closest<HTMLElement>('[data-assistant-panel-id]')?.dataset.assistantPanelId?.trim();
  if (panelId) return panelId;
  const target = activeElement.closest<HTMLElement>('[data-assistant-id]');
  return target?.dataset.assistantId?.trim() || null;
}

function getVisibleAssistantPanelId(excludeId?: string | null): string | null {
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-assistant-panel-id]'));
  for (const panel of panels) {
    const panelId = panel.dataset.assistantPanelId?.trim();
    if (!panelId || panelId === excludeId) continue;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) continue;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) continue;
    return panelId;
  }
  return null;
}

export function AssistantHighlightLayer() {
  const {
    guideState: { active, activeStep, highlightedElementId, scrollTargetId, interaction, autoClick, sequence },
    highlight,
  } = useAssistantGuide();
  const [highlightReady, setHighlightReady] = useState(false);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [targetVisible, setTargetVisible] = useState(false);
  const [showClickPulse, setShowClickPulse] = useState(false);
  const [dockRect, setDockRect] = useState<Bounds | null>(null);

  useEffect(() => {
    if (!active) {
      setHighlightReady(false);
      return;
    }
    if (highlightReady) return;
    setHighlightReady(false);
    const timeoutId = window.setTimeout(() => {
      setHighlightReady(true);
    }, 980);
    return () => window.clearTimeout(timeoutId);
  }, [active, highlightReady]);

  useEffect(() => {
    if (!active || !highlightReady || !highlightedElementId) {
      setTargetRect(null);
      setTargetVisible(false);
      setDockRect(null);
      return;
    }

    let frameId = 0;
    let hasScrolled = false;
    const selector = `[data-assistant-id="${escapeAssistantId(highlightedElementId)}"]`;

    const update = () => {
      const target = document.querySelector<HTMLElement>(selector);
      const dock = document.querySelector<HTMLElement>('[data-assistant-chat-dock="true"]');
      if (!target) {
        setTargetVisible(false);
        setTargetRect(null);
        setDockRect(dock ? getElementRect(dock) : null);
        frameId = window.requestAnimationFrame(update);
        return;
      }

      const nextRect = getElementRect(target);
      setDockRect(dock ? getElementRect(dock) : null);
      if (!hasScrolled && scrollTargetId && scrollTargetId === highlightedElementId && isOffscreen(nextRect)) {
        hasScrolled = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }

      setTargetVisible(true);
      setTargetRect(nextRect);
      frameId = window.requestAnimationFrame(update);
    };

    frameId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameId);
  }, [active, highlightReady, highlightedElementId, scrollTargetId]);

  useEffect(() => {
    if (!active || !highlightReady || !highlightedElementId || interaction !== 'click') return;
    const selector = `[data-assistant-id="${escapeAssistantId(highlightedElementId)}"]`;
    let cancelled = false;
    let handoffIntervalId = 0;
    let handoffTimeoutId = 0;
    let loopIntervalId = 0;
    let loopStartTimeoutId = 0;
    let pulseTimeoutId = 0;
    let pulseResetId = 0;
    const clearLoopTimers = () => {
      window.clearInterval(loopIntervalId);
      window.clearTimeout(loopStartTimeoutId);
      window.clearTimeout(pulseTimeoutId);
      window.clearTimeout(pulseResetId);
    };
    const runLoop = () => {
      const cycle = () => {
        if (cancelled) return;
        pulseTimeoutId = window.setTimeout(() => {
          if (cancelled) return;
          setShowClickPulse(true);
          pulseResetId = window.setTimeout(() => setShowClickPulse(false), 1350);
          if (autoClick) {
            const liveTarget = document.querySelector<HTMLElement>(selector);
            liveTarget?.click();
          }
        }, 760);
      };
      loopStartTimeoutId = window.setTimeout(cycle, 620);
      if (!autoClick) {
        loopIntervalId = window.setInterval(cycle, 2400);
      }
    };
    const armHandoff = () => {
      handoffIntervalId = window.setInterval(() => {
        if (cancelled) return;
        const nextTargetId =
          getFocusedAssistantTargetId() ||
          getVisibleAssistantPanelId(highlightedElementId);
        if (!nextTargetId || nextTargetId === highlightedElementId) return;
        cancelled = true;
        window.clearInterval(handoffIntervalId);
        window.clearTimeout(handoffTimeoutId);
        setShowClickPulse(false);
        highlight({
          elementId: nextTargetId,
          scrollTargetId: nextTargetId,
          activeStep: activeStep || undefined,
          interaction: 'highlight',
          pointerMode: 'interactive',
          autoClick: false,
        });
      }, 120);
      if (autoClick) {
        handoffTimeoutId = window.setTimeout(() => {
          window.clearInterval(handoffIntervalId);
        }, 3200);
      }
    };
    armHandoff();
    runLoop();
    return () => {
      cancelled = true;
      clearLoopTimers();
      window.clearTimeout(handoffTimeoutId);
      window.clearInterval(handoffIntervalId);
      setShowClickPulse(false);
    };
  }, [active, activeStep, autoClick, highlight, highlightReady, highlightedElementId, interaction, sequence]);

  if (!active || !highlightReady || !targetVisible || !targetRect) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
      {dockRect ? (
        <>
          <div className="absolute left-0 right-0 top-0 bg-black/25" style={{ height: Math.max(0, dockRect.top) }} />
          <div className="absolute bottom-0 left-0 bg-black/25" style={{ top: dockRect.top, width: Math.max(0, dockRect.left), height: dockRect.height }} />
          <div className="absolute bottom-0 right-0 bg-black/25" style={{ top: dockRect.top, width: Math.max(0, window.innerWidth - dockRect.right), height: dockRect.height }} />
          <div className="absolute bottom-0 left-0 right-0 bg-black/25" style={{ height: Math.max(0, window.innerHeight - dockRect.bottom) }} />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/25" />
      )}
      <div
        className="absolute rounded-[10px] border border-[#7C8CFF] bg-transparent shadow-[0_0_0_3px_#7C8CFF,0_0_20px_rgba(124,140,255,0.6)] transition-all duration-200"
        style={{
          top: Math.max(0, targetRect.top - 6),
          left: Math.max(0, targetRect.left - 6),
          width: targetRect.width + 12,
          height: targetRect.height + 12,
        }}
      />
      {interaction === 'click' ? (
        <>
          <div
            className={`absolute rounded-[14px] border-2 border-[#7C8CFF]/80 ${showClickPulse ? 'opacity-0 transition-all duration-[1350ms]' : 'opacity-100 transition-all duration-300'}`}
            style={{
              top: Math.max(0, targetRect.top - 10),
              left: Math.max(0, targetRect.left - 10),
              width: targetRect.width + 20,
              height: targetRect.height + 20,
              transform: showClickPulse ? 'scale(1.12)' : 'scale(1)',
            }}
          />
          <div
            className={`absolute rounded-[18px] border border-[#AAB4FF]/75 ${showClickPulse ? 'opacity-0 transition-all duration-[1500ms]' : 'opacity-100 transition-all duration-300'}`}
            style={{
              top: Math.max(0, targetRect.top - 16),
              left: Math.max(0, targetRect.left - 16),
              width: targetRect.width + 32,
              height: targetRect.height + 32,
              transform: showClickPulse ? 'scale(1.18)' : 'scale(1)',
            }}
          />
          <div
            className="absolute rounded-[10px] bg-[#7C8CFF]/10"
            style={{
              top: Math.max(0, targetRect.top - 2),
              left: Math.max(0, targetRect.left - 2),
              width: targetRect.width + 4,
              height: targetRect.height + 4,
              boxShadow: showClickPulse
                ? '0 0 0 6px rgba(124,140,255,0.16), 0 0 32px rgba(124,140,255,0.45)'
                : '0 0 0 0 rgba(124,140,255,0.0), 0 0 18px rgba(124,140,255,0.22)',
              transition: 'box-shadow 900ms ease, opacity 300ms ease',
            }}
          />
        </>
      ) : null}
    </div>
  );
}
