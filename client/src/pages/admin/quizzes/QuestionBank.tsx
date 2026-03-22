import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Upload, BookOpen, Search, Trash2, Edit, ChevronLeft, X, Image as ImageIcon
} from 'lucide-react';

interface Subject { _id: string; name: string; }
interface Question {
  _id: string; qid?: string; subject: { _id: string; name: string };
  topicName?: string; question: string; questionImage?: string;
  options: string[]; optionImages?: string[]; correctAnswer?: number;
  explanation?: string; explanationImage?: string;
  marks: number; positiveMarks?: number | string; negativeMarks?: number | string; tags?: string[];
}

export default function QuestionBank() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, bySubject: [] as any[] });

  // Filters
  const [selectedSubject, setSelectedSubject] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    subject: '', topicName: '', question: '', questionImage: '',
    options: ['', '', '', ''], optionImages: ['', '', '', ''],
    correctAnswer: 0, explanation: '', explanationImage: '', marks: 1, positiveMarks: 4, negativeMarks: -1
  });

  useEffect(() => {
    fetchSubjects();
    fetchStats();
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [selectedSubject, searchQuery]);

  const fetchSubjects = async () => {
    try {
      const res = await api.get('/subjects/list');
      setSubjects(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get('/question-bank/stats/summary');
      setStats({ total: res.data?.total || 0, bySubject: Array.isArray(res.data?.bySubject) ? res.data.bySubject : [] });
    } catch (e) { console.error(e); }
  };

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (selectedSubject) params.subject = selectedSubject;
      if (searchQuery) params.search = searchQuery;
      const res = await api.get('/question-bank', { params });
      setQuestions(res.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleImageUpload = async (file: File, type: 'question' | 'option' | 'explanation', optionIndex?: number) => {
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = res.data.url;
      if (type === 'question') setForm(prev => ({ ...prev, questionImage: url }));
      else if (type === 'explanation') setForm(prev => ({ ...prev, explanationImage: url }));
      else if (type === 'option' && optionIndex !== undefined) {
        const newImgs = [...form.optionImages];
        newImgs[optionIndex] = url;
        setForm(prev => ({ ...prev, optionImages: newImgs }));
      }
    } catch (e) { alert('Failed to upload image'); }
  };

  const handleSave = async () => {
    if (!form.subject || (!form.question.trim() && !form.questionImage)) return alert('Subject and Question are required.');
    
    setSaving(true);
    try {
      const payload = {
        ...form,
        positiveMarks: parseFloat(form.positiveMarks.toString() || '0'),
        negativeMarks: parseFloat(form.negativeMarks.toString() || '0'),
        marks: parseFloat(form.positiveMarks.toString() || '0')
      };

      if (editingId) {
        await api.put(`/question-bank/${editingId}`, payload);
        alert('Updated successfully');
      } else {
        await api.post('/question-bank', payload);
        alert('Created successfully');
      }

      setShowModal(false);
      fetchQuestions();
      fetchStats();
    } catch (e: any) { alert(e.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this question?')) return;
    try {
      await api.delete(`/question-bank/${id}`);
      fetchQuestions();
      fetchStats();
    } catch (e) { alert('Failed to delete question'); }
  };

  const openEdit = (q: Question) => {
    if (!q.subject?._id) return alert('Subject missing, please delete and recreate this question.');
    setEditingId(q._id);
    setForm({
      subject: q.subject._id, topicName: q.topicName || '',
      question: q.question, questionImage: q.questionImage || '',
      options: q.options.concat(['','','','']).slice(0, 4),
      optionImages: (q.optionImages || []).concat(['','','','']).slice(0, 4),
      correctAnswer: q.correctAnswer ?? 0, 
      explanation: q.explanation || '', 
      explanationImage: q.explanationImage || '',
      marks: q.marks, positiveMarks: Number(q.positiveMarks ?? q.marks), negativeMarks: Number(q.negativeMarks ?? 0)
    });
    setShowModal(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      subject: '', topicName: '', question: '', questionImage: '',
      options: ['', '', '', ''], optionImages: ['', '', '', ''],
      correctAnswer: 0, explanation: '', explanationImage: '', marks: 1, positiveMarks: 4, negativeMarks: -1
    });
    setShowModal(true);
  };

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = (event.target?.result as string).split(',')[1];
        try {
          const res = await api.post('/question-bank/bulk-import-base64', { filename: file.name, data: base64Data });
          alert(`Imported ${res.data.count} questions!`);
          fetchQuestions();
          fetchStats();
        } catch (err: any) { alert('Failed to import: ' + err.message); }
      };
      reader.readAsDataURL(file);
    } catch (e) { alert('Failed to read file'); }
    finally { 
      setUploading(false);
      e.target.value = ''; // Reset input
    }
  };

  if (user?.role !== 'admin') return <div className="p-8">Access Denied</div>;

  return (
    <div className="flex-1 bg-gray-50 min-h-screen">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-[#01b4ae] via-[#009d99] to-[#01b4ae] px-4 md:px-8 py-6 shadow-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/quizzes')} className="p-2 bg-white/20 rounded-xl hover:bg-white/30 text-white transition-colors">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-wide">Question Bank</h1>
              <p className="text-white/80 text-sm font-medium">{stats.total} questions available</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 bg-white/20 text-white px-4 py-2.5 rounded-xl cursor-pointer hover:bg-white/30 transition-colors font-bold text-sm">
              {uploading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Upload className="w-5 h-5" />}
              Import CSV
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBulkImport} />
            </label>
            <button onClick={resetForm} className="flex items-center gap-2 bg-white text-[#01b4ae] px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors font-bold text-sm shadow-sm">
              <Plus className="w-5 h-5" /> New Question
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-6">
        
        {/* Search & Subject Filters */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search questions..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#01b4ae] bg-white shadow-sm" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            <button onClick={() => setSelectedSubject('')} className={`px-5 py-2.5 rounded-xl border text-sm font-bold whitespace-nowrap transition-colors ${!selectedSubject ? 'bg-[#01b4ae] border-[#01b4ae] text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>All</button>
            {stats.bySubject.map((s: any) => (
              <button key={s._id} onClick={() => setSelectedSubject(s._id)} className={`px-5 py-2.5 rounded-xl border text-sm font-bold whitespace-nowrap transition-colors ${selectedSubject === s._id ? 'bg-[#01b4ae] border-[#01b4ae] text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {s.subject} ({s.count})
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="space-y-4">
          {loading ? (
             <div className="p-8 text-center text-gray-500 animate-pulse font-medium">Loading questions...</div>
          ) : questions.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium text-lg">No questions found</p>
            </div>
          ) : (
            questions.map((q, i) => (
              <div key={q._id} className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] hover:shadow-md transition-shadow group flex flex-col md:flex-row gap-4 animate-fade-in-up">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className="font-bold text-[#01b4ae] text-lg w-10">Q{i+1}</span>
                    <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-bold uppercase tracking-wider">{q.subject?.name}</span>
                    {q.topicName && <span className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-xs font-bold uppercase tracking-wider">{q.topicName}</span>}
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-xs font-bold uppercase tracking-wider">+{q.positiveMarks ?? q.marks} / {q.negativeMarks ?? 0}</span>
                  </div>
                  <p className="text-gray-800 text-[15px] font-medium leading-relaxed mb-3 line-clamp-2">{q.question}</p>
                  <div className="flex items-center gap-4 text-sm font-medium text-gray-500">
                     <span>{q.options.length} Options</span>
                     {q.questionImage && <span className="flex items-center gap-1 text-blue-600"><ImageIcon className="w-4 h-4"/> Has Image</span>}
                  </div>
                </div>
                
                <div className="flex md:flex-col items-center justify-end gap-2 shrink-0 md:border-l border-gray-100 md:pl-5 pt-3 md:pt-0 border-t md:border-t-0 w-full md:w-auto mt-4 md:mt-0">
                  <button onClick={() => openEdit(q)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors tooltip"><Edit className="w-5 h-5"/></button>
                  <button onClick={() => handleDelete(q._id)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-colors"><Trash2 className="w-5 h-5"/></button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Edit/Add Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl animate-fade-in-up">
            
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">
              <h2 className="text-xl font-bold text-gray-900">{editingId ? 'Edit Question' : 'Add Question'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Subject *</label>
                  <select value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none">
                    <option value="">Select subject</option>
                    {subjects.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Topic</label>
                  <input type="text" value={form.topicName} onChange={e => setForm({...form, topicName: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="e.g. Anatomy" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Question Text *</label>
                <textarea rows={3} value={form.question} onChange={e => setForm({...form, question: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="Enter the question..." />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Question Image (Optional)</label>
                <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'question')} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
                {form.questionImage && <div className="mt-3 relative inline-block"><img src={form.questionImage} alt="Question" className="h-32 rounded-lg border" /><button onClick={() => setForm({...form, questionImage: ''})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><X className="w-4 h-4"/></button></div>}
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-bold text-gray-700 mb-2">Options & Correct Answer *</label>
                {form.options.map((opt, i) => (
                  <div key={i} className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${form.correctAnswer === i ? 'border-[#01b4ae] bg-[#01b4ae]/5' : 'border-gray-100 bg-white'}`}>
                    <input type="radio" name="correctAnswer" checked={form.correctAnswer === i} onChange={() => setForm({...form, correctAnswer: i})} className="mt-3 w-5 h-5 text-[#01b4ae] focus:ring-[#01b4ae]" />
                    <div className="flex-1 space-y-3">
                      <input type="text" value={opt} onChange={e => { const newOpts = [...form.options]; newOpts[i] = e.target.value; setForm({...form, options: newOpts}) }} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#01b4ae] focus:outline-none text-[15px]" placeholder={`Option ${i+1}`} />
                      <div className="flex items-center gap-3">
                         <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'option', i)} className="block w-full max-w-[200px] text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer" />
                         {form.optionImages[i] && <div className="relative"><img src={form.optionImages[i]} className="h-12 rounded border" /><button onClick={() => { const newImgs = [...form.optionImages]; newImgs[i]=''; setForm({...form, optionImages: newImgs}); }} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"><X className="w-3 h-3"/></button></div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Positive Marks (+)</label>
                  <input type="number" value={form.positiveMarks} onChange={e => setForm({...form, positiveMarks: Number(e.target.value)})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Negative Marks (-)</label>
                  <input type="number" value={form.negativeMarks} onChange={e => setForm({...form, negativeMarks: Number(e.target.value)})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Explanation (Optional)</label>
                <textarea rows={2} value={form.explanation} onChange={e => setForm({...form, explanation: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none mb-3" placeholder="Provide an explanation for the correct answer..." />
                <div className="flex items-center gap-3">
                   <input type="file" id="explanationImage" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'explanation')} className="hidden" />
                   <label htmlFor="explanationImage" className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl cursor-pointer hover:bg-emerald-100 transition-colors font-bold text-xs border border-emerald-200">
                     <ImageIcon className="w-4 h-4" /> Add Image
                   </label>
                   {form.explanationImage && (
                     <div className="relative inline-block">
                       <img src={form.explanationImage} alt="Explanation" className="h-20 rounded-lg border shadow-sm" />
                       <button onClick={() => setForm({...form, explanationImage: ''})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors shadow-sm">
                         <X className="w-3 h-3"/>
                       </button>
                     </div>
                   )}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-2xl flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-7 py-2.5 rounded-xl font-bold bg-[#01b4ae] text-white hover:bg-[#009d99] shadow-lg shadow-[#01b4ae]/20 transition-all disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Question'}
              </button>
            </div>
            
          </div>
        </div>
      )}

    </div>
  );
}
