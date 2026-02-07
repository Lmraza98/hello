import { useRef, useEffect } from 'react';

type TerminalLine = {
  time: string;
  text: string;
};

type TerminalOutputProps = {
  lines: TerminalLine[];
};

export function TerminalOutput({ lines }: TerminalOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="bg-gray-900 rounded-lg p-3 md:p-4 font-mono text-xs h-48 md:h-64 overflow-y-auto mt-2"
    >
      {lines.length === 0 ? (
        <p className="text-gray-500 text-xs">No output yet</p>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="py-0.5 leading-relaxed">
            <span className="text-gray-500 text-[10px] mr-2 tabular-nums">{new Date(line.time).toLocaleTimeString()}</span>
            <span
              className={
                line.text.includes('ERROR') || line.text.includes('error') || line.text.includes('failed')
                  ? 'text-red-400'
                  : line.text.includes('contacts') || line.text.includes('Success')
                  ? 'text-green-400'
                  : line.text.includes('Worker')
                  ? 'text-blue-400'
                  : line.text.includes('Authenticated')
                  ? 'text-emerald-400'
                  : 'text-gray-300'
              }
            >
              {line.text}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
