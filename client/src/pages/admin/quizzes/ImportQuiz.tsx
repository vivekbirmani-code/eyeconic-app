import { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, UploadCloud, FileSpreadsheet, CheckCircle } from 'lucide-react';

export default function ImportQuiz() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState<{ count: number } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setSuccess(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setSuccess(null);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = (event.target?.result as string).split(',')[1];
        try {
          const res = await api.post('/question-bank/bulk-import-base64', {
            filename: file.name,
            data: base64Data
          });
          setSuccess({ count: res.data.count });
          setFile(null);
        } catch (err: any) {
          alert('Failed to import: ' + (err.response?.data?.message || err.message));
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (e) {
      alert('Failed to read file');
      setUploading(false);
    }
  };

  if (user?.role !== 'admin') return <div className="p-8">Access Denied</div>;

  return (
    <div className="flex-1 bg-gray-50 min-h-screen">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 md:px-8 py-6 shadow-sm sticky top-0 z-30">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/quizzes')} className="p-2 bg-white/20 rounded-xl hover:bg-white/30 text-white transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide">Import from Excel</h1>
            <p className="text-white/80 text-sm font-medium">Bulk upload questions to the Question Bank</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        <div className="bg-white rounded-2xl p-8 md:p-12 border border-gray-100 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.1)] text-center animate-fade-in-up">
          
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileSpreadsheet className="w-10 h-10 text-blue-600" />
          </div>
          
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">Upload Questions CSV/Excel</h2>
          
          <div className="text-sm font-medium text-gray-500 mb-8 max-w-md mx-auto leading-relaxed">
            Ensure your file follows the standard template format. Required columns: Subject, Topic, Question, Options 1-4, Correct Answer (0-3), Marks, Positive (+), Negative (-).
          </div>

          <label className="border-2 border-dashed border-gray-300 rounded-2xl p-8 block cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all mb-6">
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            <UploadCloud className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            {file ? (
              <span className="font-bold text-blue-600">{file.name}</span>
            ) : (
              <span className="font-bold text-gray-600">Click to select a file <span className="font-normal text-gray-400 block mt-1">or drag and drop here</span></span>
            )}
          </label>

          {success && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl mb-6 flex items-center gap-3 animate-fade-in">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              <p className="font-semibold text-sm">Successfully imported {success.count} questions into the bank!</p>
            </div>
          )}

          <button 
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full max-w-sm mx-auto flex items-center justify-center px-8 py-4 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Processing...' : 'Upload & Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
