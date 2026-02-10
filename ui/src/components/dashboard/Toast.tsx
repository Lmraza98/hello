import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

export type ToastMessage = {
  id: string;
  text: string;
  type?: 'success' | 'info';
};

type ToastProps = {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
};

export function ToastContainer({ messages, onDismiss }: ToastProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {messages.map((msg) => (
        <ToastItem key={msg.id} message={msg} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ message, onDismiss }: { message: ToastMessage; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(message.id), 300);
    }, 3000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      } ${
        message.type === 'success'
          ? 'bg-green-50 border-green-200 text-green-800'
          : 'bg-surface border-border text-text'
      }`}
    >
      <CheckCircle2 className="w-4 h-4 shrink-0" />
      <span className="flex-1">{message.text}</span>
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => onDismiss(message.id), 300);
        }}
        className="p-0.5 hover:bg-black/5 rounded"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
