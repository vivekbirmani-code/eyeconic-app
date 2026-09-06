import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Upload, BookOpen, Search, Trash2, Edit, ChevronLeft, X, Image as ImageIcon
} from 'lucide-react';

const QUESTION_TYPES = [
  { value: 'mcq_single', label: 'MCQ — Single Correct' },
  { value: 'assertion_reason', label: 'Assertion / Reason' },
  { value: 'match_the_following', label: 'Match the Following' },
  { value: 'image_based', label: 'Image-Based' },
  { value: 'multiple_correct', label: 'Multiple Correct' },
  { value: 'numerical', label: 'Numerical' },
];

const DIFFICULTY_LEVELS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const DEFAULT_ASSERTION_REASON_OPTIONS = [
  'Both Assertion and Reason are true, and Reason is the correct explanation of Assertion',
  'Both Assertion and Reason are true, but Reason is NOT the correct explanation of Assertion',
  'Assertion is true, but Reason is false',
  'Assertion is false, but Reason is true',
];

interface Subject { _id: string; name: string; }
interface Question {
  _id: string; qid?: string; subject: { _id: string; name: string };
  topicName?: string; subtopicName?: string; system?: string;
  questionType?: string; difficulty?: string;
  question: string; questionImage?: string;
  options?: string[]; optionImages?: string[]; correctAnswer?: any;
  assertion?: string; reason?: string; columnA?: string[]; columnB?: string[];
  explanation?: string; explanationImage?: string;
  marks: number; positiveMarks?: number | string; negativeMarks?: number | string; tags?: string[];
}

const emptyForm = () => ({
  subject: '', topicName: '', subtopicName: '', system: '',
  questionType: 'mcq_single', difficulty: 'medium', tags: '',
  question: '', questionImage: '',
  options: ['', '', '', ''], optionImages: ['', '', '', ''],
  assertion: '', reason: '',
  columnA: ['', ''], columnB: ['', ''],
  correctAnswer: 0, correctAnswers: [] as number[], correctMapping: {} as Record<string, string>, correctNumerical: '',
  explanation: '', explanationImage: '', marks: 1, positiveMarks: 4, negativeMarks: -1
});

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
  const [typeFilter, setTypeFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    fetchSubjects();
    fetchStats();
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [selectedSubject, searchQuery, typeFilter, difficultyFilter]);

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
      if (typeFilter) params.questionType = typeFilter;
      if (difficultyFilter) params.difficulty = difficultyFilter;
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

  const onQuestionTypeChange = (questionType: string) => {
    setForm(prev => {
      const next = { ...prev, questionType };
      if (questionType === 'assertion_reason' && (!prev.options || prev.options.filter(o => o.trim()).length < 2)) {
        next.options = [...DEFAULT_ASSERTION_REASON_OPTIONS];
        next.optionImages = ['', '', '', ''];
      }
      return next;
    });
  };

  const validateForm = (): string | null => {
    if (!form.subject) return 'Subject is required.';
    if (!form.topicName.trim()) return 'Topic is required.';
    if (!form.subtopicName.trim()) return 'Subtopic is required.';
    if (!form.system.trim()) return 'System is required.';
    if (!form.questionType) return 'Question Type is required.';
    if (!form.difficulty) return 'Difficulty is required.';
    if (!form.question.trim() && !form.questionImage) return 'Question text or image is required.';

    switch (form.questionType) {
      case 'mcq_single':
      case 'image_based': {
        const filled = form.options.filter(o => o.trim());
        if (filled.length < 2) return 'At least 2 options are required.';
        if (form.questionType === 'image_based' && !form.questionImage) return 'Image-Based questions require a question image.';
        if (form.correctAnswer < 0 || form.correctAnswer >= form.options.length || !form.options[form.correctAnswer]?.trim()) {
          return 'Select a valid correct option.';
        }
        break;
      }
      case 'multiple_correct': {
        const filled = form.options.filter(o => o.trim());
        if (filled.length < 2) return 'At least 2 options are required.';
        if (!form.correctAnswers || form.correctAnswers.length === 0) return 'Select at least one correct option.';
        break;
      }
      case 'assertion_reason': {
        if (!form.assertion.trim()) return 'Assertion text is required.';
        if (!form.reason.trim()) return 'Reason text is required.';
        if (form.correctAnswer < 0 || form.correctAnswer >= form.options.length) return 'Select a valid correct option.';
        break;
      }
      case 'match_the_following': {
        const aFilled = form.columnA.filter(v => v.trim());
        const bFilled = form.columnB.filter(v => v.trim());
        if (aFilled.length < 2) return 'Column A needs at least 2 entries.';
        if (bFilled.length < 2) return 'Column B needs at least 2 entries.';
        const expectedKeys = form.columnA.map((_, i) => String(i));
        const mappedKeys = Object.keys(form.correctMapping);
        if (!expectedKeys.every(k => mappedKeys.includes(k))) return 'Every Column A entry must be mapped.';
        break;
      }
      case 'numerical': {
        if (form.correctNumerical.trim() === '' || Number.isNaN(Number(form.correctNumerical))) {
          return 'A valid numerical correct answer is required.';
        }
        break;
      }
      default:
        return 'Invalid question type.';
    }
    return null;
  };

  const buildPayload = () => {
    const base: any = {
      subject: form.subject,
      topicName: form.topicName.trim(),
      subtopicName: form.subtopicName.trim(),
      system: form.system.trim(),
      questionType: form.questionType,
      difficulty: form.difficulty,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      question: form.question.trim(),
      // '' (not undefined) when empty so an edit can actually CLEAR a
      // stored image — undefined would merge back to the old value on the
      // server and keep it.
      questionImage: form.questionImage || '',
      explanation: form.explanation,
      explanationImage: form.explanationImage || '',
      positiveMarks: parseFloat(form.positiveMarks.toString() || '0'),
      negativeMarks: parseFloat(form.negativeMarks.toString() || '0'),
      marks: parseFloat(form.positiveMarks.toString() || '0'),
    };

    switch (form.questionType) {
      case 'mcq_single':
      case 'image_based':
        base.options = form.options;
        base.optionImages = form.optionImages;
        base.correctAnswer = form.correctAnswer;
        break;
      case 'multiple_correct':
        base.options = form.options;
        base.optionImages = form.optionImages;
        base.correctAnswer = form.correctAnswers;
        break;
      case 'assertion_reason':
        base.assertion = form.assertion;
        base.reason = form.reason;
        base.options = form.options;
        base.correctAnswer = form.correctAnswer;
        break;
      case 'match_the_following':
        base.columnA = form.columnA;
        base.columnB = form.columnB;
        base.correctAnswer = form.correctMapping;
        break;
      case 'numerical':
        base.correctAnswer = Number(form.correctNumerical);
        break;
    }
    return base;
  };

  const handleSave = async () => {
    const error = validateForm();
    if (error) { setFormError(error); return; }
    setFormError(null);

    setSaving(true);
    try {
      const payload = buildPayload();

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
    } catch (e: any) {
      const errors = e.response?.data?.errors;
      setFormError(Array.isArray(errors) ? errors.join(' ') : (e.response?.data?.message || 'Failed to save'));
    }
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
    setFormError(null);

    const questionType = q.questionType || 'mcq_single';
    const next = emptyForm();
    next.subject = q.subject._id;
    next.topicName = q.topicName || '';
    next.subtopicName = q.subtopicName || '';
    next.system = q.system || '';
    next.questionType = questionType;
    next.difficulty = q.difficulty || 'medium';
    next.tags = (q.tags || []).join(', ');
    next.question = q.question;
    next.questionImage = q.questionImage || '';
    next.explanation = q.explanation || '';
    next.explanationImage = q.explanationImage || '';
    next.marks = q.marks;
    next.positiveMarks = Number(q.positiveMarks ?? q.marks);
    next.negativeMarks = Number(q.negativeMarks ?? 0);

    if (questionType === 'match_the_following') {
      next.columnA = (q.columnA || ['', '']).concat(['', '']).slice(0, Math.max(2, (q.columnA || []).length));
      next.columnB = (q.columnB || ['', '']).concat(['', '']).slice(0, Math.max(2, (q.columnB || []).length));
      next.correctMapping = (q.correctAnswer && typeof q.correctAnswer === 'object') ? q.correctAnswer : {};
    } else if (questionType === 'numerical') {
      next.correctNumerical = q.correctAnswer !== undefined && q.correctAnswer !== null ? String(q.correctAnswer) : '';
    } else if (questionType === 'multiple_correct') {
      next.options = (q.options || ['', '', '', '']).concat(['', '', '', '']).slice(0, Math.max(4, (q.options || []).length));
      next.optionImages = (q.optionImages || []).concat(['', '', '', '']).slice(0, next.options.length);
      next.correctAnswers = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
    } else if (questionType === 'assertion_reason') {
      next.assertion = q.assertion || '';
      next.reason = q.reason || '';
      next.options = (q.options && q.options.length >= 2) ? q.options : [...DEFAULT_ASSERTION_REASON_OPTIONS];
      next.correctAnswer = typeof q.correctAnswer === 'number' ? q.correctAnswer : 0;
    } else {
      next.options = (q.options || ['', '', '', '']).concat(['', '', '', '']).slice(0, Math.max(4, (q.options || []).length));
      next.optionImages = (q.optionImages || []).concat(['', '', '', '']).slice(0, next.options.length);
      next.correctAnswer = typeof q.correctAnswer === 'number' ? q.correctAnswer : 0;
    }

    setForm(next);
    setShowModal(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormError(null);
    setForm(emptyForm());
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
          const errCount = Array.isArray(res.data.errors) ? res.data.errors.length : 0;
          const warnCount = Array.isArray(res.data.warnings) ? res.data.warnings.length : 0;
          alert(
            `Imported ${res.data.count} questions!` +
            (errCount ? ` ${errCount} rows had errors — see console.` : '') +
            (warnCount ? ` ${warnCount} images kept their direct source URL — see console.` : '')
          );
          if (errCount) console.warn('Import errors:', res.data.errors);
          if (warnCount) console.warn('Import warnings:', res.data.warnings);
          fetchQuestions();
          fetchStats();
        } catch (err: any) {
          const errors = err.response?.data?.errors;
          alert('Failed to import: ' + (Array.isArray(errors) ? errors.slice(0, 5).join(' ') : err.message));
        }
      };
      reader.readAsDataURL(file);
    } catch (e) { alert('Failed to read file'); }
    finally {
      setUploading(false);
      e.target.value = ''; // Reset input
    }
  };

  const updateOption = (i: number, value: string) => {
    const newOpts = [...form.options];
    newOpts[i] = value;
    setForm({ ...form, options: newOpts });
  };

  const toggleMultiCorrect = (i: number) => {
    const set = new Set(form.correctAnswers);
    if (set.has(i)) set.delete(i); else set.add(i);
    setForm({ ...form, correctAnswers: [...set].sort() });
  };

  const updateColumn = (col: 'columnA' | 'columnB', i: number, value: string) => {
    const next = [...form[col]];
    next[i] = value;
    setForm({ ...form, [col]: next } as any);
  };

  const addColumnEntry = (col: 'columnA' | 'columnB') => {
    setForm({ ...form, [col]: [...form[col], ''] } as any);
  };

  const setMapping = (aIdx: number, bIdx: number) => {
    setForm({ ...form, correctMapping: { ...form.correctMapping, [String(aIdx)]: String(bIdx) } });
  };

  if (user?.role !== 'admin') return <div className="p-8">Access Denied</div>;

  const typeLabel = (t?: string) => QUESTION_TYPES.find(qt => qt.value === t)?.label || t || 'MCQ';

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
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-4 py-3 border border-gray-200 rounded-2xl bg-white shadow-sm text-sm font-medium">
            <option value="">All Types</option>
            {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={difficultyFilter} onChange={e => setDifficultyFilter(e.target.value)} className="px-4 py-3 border border-gray-200 rounded-2xl bg-white shadow-sm text-sm font-medium">
            <option value="">All Difficulties</option>
            {DIFFICULTY_LEVELS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
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
                    {q.subtopicName && <span className="px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg text-xs font-bold uppercase tracking-wider">{q.subtopicName}</span>}
                    {q.system && <span className="px-3 py-1 bg-purple-50 text-purple-700 border border-purple-100 rounded-lg text-xs font-bold uppercase tracking-wider">{q.system}</span>}
                    <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg text-xs font-bold uppercase tracking-wider">{typeLabel(q.questionType)}</span>
                    {q.difficulty && <span className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-100 rounded-lg text-xs font-bold uppercase tracking-wider">{q.difficulty}</span>}
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-xs font-bold uppercase tracking-wider">+{q.positiveMarks ?? q.marks} / {q.negativeMarks ?? 0}</span>
                  </div>
                  <p className="text-gray-800 text-[15px] font-medium leading-relaxed mb-3 line-clamp-2">{q.question}</p>
                  <div className="flex items-center gap-4 text-sm font-medium text-gray-500">
                     <span>{(q.options || []).length} Options</span>
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
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium">{formError}</div>
              )}

              {/* Classification */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Subject *</label>
                  <select value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none">
                    <option value="">Select subject</option>
                    {subjects.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Topic *</label>
                  <input type="text" value={form.topicName} onChange={e => setForm({...form, topicName: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="e.g. Anatomy" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Subtopic *</label>
                  <input type="text" value={form.subtopicName} onChange={e => setForm({...form, subtopicName: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="e.g. Upper Limb" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">System *</label>
                  <input type="text" value={form.system} onChange={e => setForm({...form, system: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="e.g. Musculoskeletal" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Question Type *</label>
                  <select value={form.questionType} onChange={e => onQuestionTypeChange(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none">
                    {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Difficulty *</label>
                  <select value={form.difficulty} onChange={e => setForm({...form, difficulty: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none">
                    {DIFFICULTY_LEVELS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Tags (optional, comma-separated)</label>
                  <input type="text" value={form.tags} onChange={e => setForm({...form, tags: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="e.g. high-yield, PYQ" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Question Text {form.questionType !== 'image_based' ? '*' : '(optional if image provided)'}</label>
                <textarea rows={3} value={form.question} onChange={e => setForm({...form, question: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="Enter the question..." />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Question Image {form.questionType === 'image_based' ? '*' : '(Optional)'}</label>
                <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'question')} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
                {form.questionImage && <div className="mt-3 relative inline-block"><img src={form.questionImage} alt="Question" className="h-32 rounded-lg border" /><button onClick={() => setForm({...form, questionImage: ''})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><X className="w-4 h-4"/></button></div>}
              </div>

              {/* Type-specific content */}
              {(form.questionType === 'mcq_single' || form.questionType === 'image_based') && (
                <div className="space-y-4">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Options & Correct Answer *</label>
                  {form.options.map((opt, i) => (
                    <div key={i} className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${form.correctAnswer === i ? 'border-[#01b4ae] bg-[#01b4ae]/5' : 'border-gray-100 bg-white'}`}>
                      <input type="radio" name="correctAnswer" checked={form.correctAnswer === i} onChange={() => setForm({...form, correctAnswer: i})} className="mt-3 w-5 h-5 text-[#01b4ae] focus:ring-[#01b4ae]" />
                      <div className="flex-1 space-y-3">
                        <input type="text" value={opt} onChange={e => updateOption(i, e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#01b4ae] focus:outline-none text-[15px]" placeholder={`Option ${i+1}`} />
                        <div className="flex items-center gap-3">
                           <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'option', i)} className="block w-full max-w-[200px] text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer" />
                           {form.optionImages[i] && <div className="relative"><img src={form.optionImages[i]} className="h-12 rounded border" /><button onClick={() => { const newImgs = [...form.optionImages]; newImgs[i]=''; setForm({...form, optionImages: newImgs}); }} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"><X className="w-3 h-3"/></button></div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {form.questionType === 'multiple_correct' && (
                <div className="space-y-4">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Options & Correct Answers (select all that apply) *</label>
                  {form.options.map((opt, i) => (
                    <div key={i} className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${form.correctAnswers.includes(i) ? 'border-[#01b4ae] bg-[#01b4ae]/5' : 'border-gray-100 bg-white'}`}>
                      <input type="checkbox" checked={form.correctAnswers.includes(i)} onChange={() => toggleMultiCorrect(i)} className="mt-3 w-5 h-5 text-[#01b4ae] focus:ring-[#01b4ae]" />
                      <input type="text" value={opt} onChange={e => updateOption(i, e.target.value)} className="flex-1 p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#01b4ae] focus:outline-none text-[15px]" placeholder={`Option ${i+1}`} />
                    </div>
                  ))}
                </div>
              )}

              {form.questionType === 'assertion_reason' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Assertion (A) *</label>
                    <textarea rows={2} value={form.assertion} onChange={e => setForm({...form, assertion: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Reason (R) *</label>
                    <textarea rows={2} value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Correct Relationship *</label>
                    {form.options.map((opt, i) => (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border-2 transition-colors ${form.correctAnswer === i ? 'border-[#01b4ae] bg-[#01b4ae]/5' : 'border-gray-100 bg-white'}`}>
                        <input type="radio" name="arCorrect" checked={form.correctAnswer === i} onChange={() => setForm({...form, correctAnswer: i})} className="mt-1 w-5 h-5 text-[#01b4ae]" />
                        <span className="text-sm">{opt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {form.questionType === 'match_the_following' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Column A *</label>
                    {form.columnA.map((v, i) => (
                      <input key={i} type="text" value={v} onChange={e => updateColumn('columnA', i, e.target.value)} className="w-full p-2.5 mb-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder={`${i + 1}. Item`} />
                    ))}
                    <button onClick={() => addColumnEntry('columnA')} className="text-xs font-bold text-[#01b4ae]">+ Add entry</button>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Column B *</label>
                    {form.columnB.map((v, i) => (
                      <input key={i} type="text" value={v} onChange={e => updateColumn('columnB', i, e.target.value)} className="w-full p-2.5 mb-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder={`${String.fromCharCode(65 + i)}. Item`} />
                    ))}
                    <button onClick={() => addColumnEntry('columnB')} className="text-xs font-bold text-[#01b4ae]">+ Add entry</button>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Mapping (Column A → Column B) *</label>
                    <div className="space-y-2">
                      {form.columnA.map((_, aIdx) => (
                        <div key={aIdx} className="flex items-center gap-3">
                          <span className="text-sm font-medium w-8">{aIdx + 1}.</span>
                          <select value={form.correctMapping[String(aIdx)] || ''} onChange={e => setMapping(aIdx, Number(e.target.value))} className="p-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <option value="">Select match</option>
                            {form.columnB.map((_, bIdx) => (
                              <option key={bIdx} value={bIdx}>{String.fromCharCode(65 + bIdx)}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {form.questionType === 'numerical' && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Correct Numerical Answer *</label>
                  <input type="number" step="any" value={form.correctNumerical} onChange={e => setForm({...form, correctNumerical: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" placeholder="Enter exact numeric answer" />
                </div>
              )}

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
