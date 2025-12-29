import { Upload, Pencil } from 'lucide-react';

export default function AutoFillToggle({ mode, onChange }) {
  return (
    <div className="flex gap-3 w-full md:w-auto">
      {/* Manual Entry Button */}
      <button
        type="button"
        onClick={() => onChange('manual')}
        className={`flex-1 md:flex-none px-6 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${
          mode === 'manual' 
            ? 'bg-blue-600 text-white shadow-md' 
            : 'bg-white border border-slate-300 text-slate-700 hover:border-blue-400'
        }`}
        aria-pressed={mode === 'manual'}
      >
        <Pencil className="w-5 h-5" />
        <span>Manual Entry</span>
      </button>

      {/* Upload Documents Button */}
      <button
        type="button"
        onClick={() => onChange('auto')}
        className={`flex-1 md:flex-none px-6 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${
          mode === 'auto' 
            ? 'bg-blue-600 text-white shadow-md' 
            : 'bg-white border border-slate-300 text-slate-700 hover:border-blue-400'
        }`}
        aria-pressed={mode === 'auto'}
      >
        <Upload className="w-5 h-5" />
        <span>Upload Documents</span>
      </button>
    </div>
  );
}
