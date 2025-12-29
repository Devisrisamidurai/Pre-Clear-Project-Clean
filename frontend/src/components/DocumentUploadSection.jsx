import { useState, useRef } from 'react';
import { Upload, FileText, Image, File as FileIcon, Sparkles, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { useShipmentExtraction } from '../hooks/useShipmentExtraction';

export default function DocumentUploadSection({ onExtracted }) {
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);
  const { loading, error, data, extract } = useShipmentExtraction();

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) {
      setFiles(prev => [...prev, ...picked]);
    }
  };

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const onDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length) setFiles(prev => [...prev, ...dropped]);
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  const onExtract = async () => {
    if (!files.length) return;
    console.log('[DocumentUploadSection] Starting extraction with files:', files.map(f => f.name));
    const result = await extract(files);
    console.log('[DocumentUploadSection] Extraction result:', result);
    if (result && onExtracted) {
      onExtracted(result);
    }
  };

  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Upload className="w-5 h-5 text-slate-700" />
        <h2 className="text-slate-900">Upload Documents</h2>
      </div>

      <div
        className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt"
          multiple
          onChange={onPickFiles}
          className="hidden"
        />
        <div className="flex items-center justify-center gap-3 text-slate-600">
          <Upload className="w-6 h-6" />
          <span>Select or drop PDF, JPG, PNG, TXT</span>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-slate-700 font-medium">Selected Files</p>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 overflow-hidden">
            {files.map((f, idx) => (
              <li key={idx} className="flex items-center justify-between p-3 bg-slate-50">
                <div className="flex items-center gap-3 text-slate-700">
                  {f.type.includes('pdf') ? (
                    <FileText className="w-4 h-4" />
                  ) : f.type.includes('image') ? (
                    <Image className="w-4 h-4" />
                  ) : (
                    <FileIcon className="w-4 h-4" />
                  )}
                  <span className="text-sm truncate max-w-[240px]" title={f.name}>{f.name}</span>
                </div>
                <button
                  type="button"
                  className="text-slate-500 hover:text-red-600 text-sm"
                  onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {data && !error && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Extraction successful! Fields have been auto-filled.</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-slate-600 text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          AI will extract key fields and auto-fill the form
        </p>
        <button
          type="button"
          onClick={onExtract}
          disabled={!files.length || loading}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            files.length && !loading 
              ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer' 
              : 'bg-slate-300 text-slate-500 cursor-not-allowed'
          }`}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Extracting…' : 'Extract & Auto Fill'}
        </button>
      </div>
    </div>
  );
}
