import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal, AlertCircle, CheckCircle, Info } from 'lucide-react';

interface ConsolePanelProps {
  logs: LogEntry[];
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-slate-950 border-t border-slate-800 font-mono text-sm">
      <div className="flex items-center px-4 py-2 bg-slate-900 border-b border-slate-800">
        <Terminal size={16} className="text-slate-400 mr-2" />
        <span className="text-slate-400 font-semibold">System Output</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {logs.length === 0 && (
          <div className="text-slate-600 italic">Ready to process...</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2 animate-fadeIn">
            <span className="text-slate-600 text-xs mt-0.5 whitespace-nowrap">
              [{log.timestamp.toLocaleTimeString()}]
            </span>
            {log.level === 'info' && <Info size={14} className="mt-0.5 text-blue-400 shrink-0" />}
            {log.level === 'success' && <CheckCircle size={14} className="mt-0.5 text-green-400 shrink-0" />}
            {log.level === 'warn' && <AlertCircle size={14} className="mt-0.5 text-yellow-400 shrink-0" />}
            {log.level === 'error' && <AlertCircle size={14} className="mt-0.5 text-red-500 shrink-0" />}
            <span className={`break-all ${
              log.level === 'error' ? 'text-red-400' : 
              log.level === 'success' ? 'text-green-400' : 
              log.level === 'warn' ? 'text-yellow-300' : 'text-slate-300'
            }`}>
              {log.message}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};