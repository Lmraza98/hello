export const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
export const TOOL_LANE_KEY = import.meta.env.VITE_CHAT_TOOL_LANE || 'chat-tools';
export const TOOL_LANE_SERIAL = (import.meta.env.VITE_CHAT_TOOL_LANE_SERIAL || 'true').toLowerCase() === 'true';
