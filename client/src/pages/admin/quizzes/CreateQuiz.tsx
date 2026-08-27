import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  ChevronRight, ChevronLeft, Check, Clock, BookOpen, Users, 
  Search, X
} from 'lucide-react';

interface Subject { _id: string; name: string; }
interface Student { _id: string; name: string; email: string; subjects?: Subject[]; }
interface Question {
  _id: string; qid?: string; question: string; 
  subject: { _id: string; name: string };
  topicName?: string; tags?: string[];
}
type TestType = 'daily' | 'weekly' | 'grand';

export default function CreateQuiz() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const cloneId = searchParams.get('cloneId');
  const editId = searchParams.get('editId');

  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);

  // Step 1: Type & Subjects
  const [testType, setTestType] = useState<TestType>('daily');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);

  // Step 2: Settings
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('30');
  const [availableQuestionsCount, setAvailableQuestionsCount] = useState(0);
  const [shareSolution, setShareSolution] = useState(true);
  const [instructions, setInstructions] = useState('Read each question carefully before answering.\nYou cannot go back to previous questions once answered.\nDo not switch tabs during the test.\nSubmit before the timer expires.');
  
  // Dates
  const [scheduledDate, setScheduledDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  // Step 3: Questions
  const [availableQuestionsList, setAvailableQuestionsList] = useState<Question[]>([]);
  const [filteredQuestions, setFilteredQuestions] = useState<Question[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [questionSearch, setQuestionSearch] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [tagFilter] = useState('');

  // Step 4: Students
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');

  // Debounced student search for flicker-free filtering
  const [debouncedStudentSearch, setDebouncedStudentSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedStudentSearch(studentSearch), 250);
    return () => clearTimeout(timer);
  }, [studentSearch]);

  // Indeterminate checkbox ref
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSubjects();
    fetchStudents();
    if (cloneId) loadQuiz(cloneId, true);
    else if (editId) loadQuiz(editId, false);
  }, [cloneId, editId]);

  useEffect(() => {
    if (selectedSubjects.length > 0) {
      fetchQuestionCount();
      generateTitle();
    }
  }, [selectedSubjects, testType]);

  useEffect(() => {
    if (step === 3 && selectedSubjects.length > 0 && availableQuestionsList.length === 0) {
      fetchQuestions();
    }
  }, [step, selectedSubjects]);

  useEffect(() => {
    let filtered = availableQuestionsList;
    if (questionSearch) {
      const q = questionSearch.toLowerCase();
      filtered = filtered.filter(x => 
        x.question.toLowerCase().includes(q) || x.qid?.toLowerCase().includes(q) || x.topicName?.toLowerCase().includes(q)
      );
    }
    if (topicFilter) filtered = filtered.filter(x => x.topicName?.toLowerCase().includes(topicFilter.toLowerCase()));
    if (tagFilter) filtered = filtered.filter(x => x.tags?.some(t => t.toLowerCase().includes(tagFilter.toLowerCase())));
    setFilteredQuestions(filtered);
  }, [questionSearch, topicFilter, tagFilter, availableQuestionsList]);

  useEffect(() => {
    let filtered = studentsList;
    if (debouncedStudentSearch) {
      const q = debouncedStudentSearch.toLowerCase();
      filtered = filtered.filter(s => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
    }
    setFilteredStudents(filtered);
  }, [debouncedStudentSearch, studentsList]);

  // Selection stats for filtered students
  const selectedFilteredCount = useMemo(
    () => filteredStudents.filter(s => selectedStudents.includes(s._id)).length,
    [filteredStudents, selectedStudents]
  );
  const allFilteredSelected = filteredStudents.length > 0 && selectedFilteredCount === filteredStudents.length;
  const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;

  // Sync indeterminate state on the Select All checkbox
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected]);

  // Scoped Select All: only toggles filtered items, preserves hidden selections
  const handleSelectAllFiltered = useCallback(() => {
    const filteredIds = new Set(filteredStudents.map(s => s._id));
    if (filteredIds.size === 0) return;
    if (allFilteredSelected) {
      setSelectedStudents(prev => prev.filter(id => !filteredIds.has(id)));
    } else {
      setSelectedStudents(prev => Array.from(new Set([...prev, ...Array.from(filteredIds)])));
    }
  }, [filteredStudents, allFilteredSelected]);

  // Toggle individual student (scoped, preserves other selections)
  const toggleStudent = useCallback((studentId: string) => {
    setSelectedStudents(prev =>
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  }, []);

  const loadQuiz = async (id: string, isClone: boolean) => {
    try {
      const res = await api.get(`/quizzes/${id}`);
      const quiz = res.data;
      setTitle(isClone ? `Copy of ${quiz.title}` : quiz.title);
      setTestType(quiz.testType);
      setDuration(quiz.duration.toString());
      if (quiz.instructions) setInstructions(quiz.instructions.join('\n'));
      if (quiz.shareSolution !== undefined) setShareSolution(quiz.shareSolution);
      if (quiz.scheduledDate) setScheduledDate(new Date(quiz.scheduledDate).toISOString().slice(0, 16));
      if (quiz.expiryDate) setExpiryDate(new Date(quiz.expiryDate).toISOString().slice(0, 16));
      if (quiz.subject) setSelectedSubjects([quiz.subject._id]);
      if (quiz.questions) setSelectedQuestions(quiz.questions.map((q: any) => q._id || q));
      if (!isClone && quiz.assignedStudents) setSelectedStudents(quiz.assignedStudents.map((s: any) => s._id || s));
    } catch (e) { console.error(e); }
  };

  const fetchSubjects = async () => {
    try {
      const res = await api.get('/subjects/list');
      setSubjects(Array.isArray(res.data) ? res.data : []);
    } catch {}
  };

  const fetchStudents = async () => {
    try {
      const res = await api.get('/users?role=student');
      setStudentsList(Array.isArray(res.data) ? res.data : []);
      setFilteredStudents(Array.isArray(res.data) ? res.data : []);
    } catch {}
  };

  const fetchQuestionCount = async () => {
    try {
      const res = await api.get('/question-bank/stats/summary');
      let total = 0;
      selectedSubjects.forEach(subId => {
        const stat = res.data?.bySubject?.find((s: any) => s._id === subId);
        total += stat?.count || 0;
      });
      setAvailableQuestionsCount(total);
    } catch {}
  };

  const fetchQuestions = async () => {
    try {
      const params = new URLSearchParams();
      selectedSubjects.forEach(id => params.append('subjects', id));
      const res = await api.get(`/question-bank/by-subjects?${params}`);
      setAvailableQuestionsList(Array.isArray(res.data) ? res.data : []);
    } catch {}
  };

  const generateTitle = () => {
    const selectedNames = selectedSubjects.map(id => subjects.find(s => s._id === id)?.name).filter(Boolean).join(', ');
    const typeLabel = testType.charAt(0).toUpperCase() + testType.slice(1);
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setTitle(`${selectedNames} ${typeLabel} Test - ${date}`);
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const payload = {
        title: title.trim(),
        subjects: selectedSubjects,
        subject: selectedSubjects[0], // compat
        testType,
        numberOfQuestions: selectedQuestions.length,
        questions: selectedQuestions,
        selectedQuestionIds: selectedQuestions,
        duration: parseInt(duration),
        instructions: instructions.split('\n').filter(i => i.trim()),
        assignedStudents: selectedStudents,
        shareSolution,
        scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : null,
        expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null
      };

      if (editId) {
        await api.put(`/quizzes/${editId}`, payload);
        alert('Test updated successfully!');
      } else {
        await api.post('/quizzes/create-from-bank', payload);
        alert(`Test ${cloneId ? 'cloned' : 'created'} successfully!`);
      }
      navigate('/quizzes');
    } catch (e: any) { alert(e.response?.data?.message || 'Failed to create test'); }
    finally { setCreating(false); }
  };

  if (user?.role !== 'admin') return <div className="p-8">Access Denied</div>;

  return (
    <div className="flex-1 bg-gray-50 min-h-screen pb-20">
      
      {/* Header */}
      <div className="bg-white px-8 py-5 border-b border-gray-200 sticky top-0 z-30 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{editId ? 'Edit Test' : cloneId ? 'Clone Test' : 'Create Test'}</h1>
          <p className="text-sm text-gray-500">Step {step} of 4</p>
        </div>
        <button onClick={() => navigate('/quizzes')} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
          <X className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Progress */}
      <div className="max-w-4xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between mb-8 mt-4 relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-gray-200 -z-10 rounded-full">
            <div className="h-full bg-[#01b4ae] rounded-full transition-all duration-300" style={{ width: `${((step - 1) / 3) * 100}%` }} />
          </div>
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors border-2 ${step >= s ? 'bg-[#01b4ae] border-[#01b4ae] text-white' : 'bg-white border-gray-300 text-gray-400'}`}>
              {s < step ? <Check className="w-5 h-5" /> : s}
            </div>
          ))}
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 min-h-[500px]">
          
          {/* STEP 1 */}
          {step === 1 && (
            <div className="space-y-6 animate-fade-in">
              <h2 className="text-xl font-bold text-gray-900">1. Select Test Type & Subjects</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(['daily', 'weekly', 'grand'] as TestType[]).map(type => (
                  <div 
                    key={type} 
                    onClick={() => setTestType(type)}
                    className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${testType === type ? 'border-[#01b4ae] bg-[#01b4ae]/5' : 'border-gray-200 hover:border-[#01b4ae]/50'}`}
                  >
                   <div className="flex items-center gap-3 mb-2">
                     <div className={`p-2 rounded-lg ${testType === type ? 'bg-[#01b4ae] text-white' : 'bg-gray-100 text-gray-500'}`}>
                       {type === 'daily' && <Clock className="w-5 h-5" />}
                       {type === 'weekly' && <BookOpen className="w-5 h-5" />}
                       {type === 'grand' && <Users className="w-5 h-5" />}
                     </div>
                     <span className={`font-bold capitalize ${testType === type ? 'text-[#01b4ae]' : 'text-gray-700'}`}>{type} Test</span>
                   </div>
                   <p className="text-sm text-gray-500">
                     {type === 'daily' ? '10-20 questions • 15-30m' : type === 'weekly' ? '30-50 questions • 45-60m' : '100+ questions • 2-3h'}
                   </p>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Subject(s)</label>
                <div className="space-y-2 max-h-60 overflow-y-auto p-4 border rounded-xl bg-gray-50">
                  {subjects.map(sub => (
                    <label key={sub._id} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={selectedSubjects.includes(sub._id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedSubjects([...selectedSubjects, sub._id]);
                          else setSelectedSubjects(selectedSubjects.filter(id => id !== sub._id));
                        }}
                        className="w-5 h-5 text-[#01b4ae] rounded focus:ring-[#01b4ae]"
                      />
                      <span className="font-medium text-gray-800">{sub.name}</span>
                    </label>
                  ))}
                </div>
                {selectedSubjects.length > 0 && <p className="text-sm text-[#01b4ae] mt-2 font-medium">📚 {availableQuestionsCount} questions available from selected subjects</p>}
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="space-y-6 animate-fade-in">
              <h2 className="text-xl font-bold text-gray-900">2. Test Settings</h2>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Test Title</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Duration (minutes)</label>
                <input type="number" value={duration} onChange={e => setDuration(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Instructions</label>
                <textarea rows={4} value={instructions} onChange={e => setInstructions(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
              </div>

              <div className="flex items-center justify-between p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                <div>
                  <h4 className="font-bold text-blue-900">Share Solutions</h4>
                  <p className="text-sm text-blue-700">Allow students to see correct answers after submission.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={shareSolution} onChange={e => setShareSolution(e.target.checked)} />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#01b4ae]"></div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Start Date & Time (Optional)</label>
                  <input type="datetime-local" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">End Date & Time (Optional)</label>
                  <input type="datetime-local" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#01b4ae] focus:outline-none" />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div className="space-y-6 animate-fade-in flex flex-col h-full">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">3. Select Questions</h2>
                <div className="text-sm">
                  <span className="font-bold text-[#01b4ae]">{selectedQuestions.length}</span> selected
                  <button 
                    onClick={() => setSelectedQuestions(selectedQuestions.length === filteredQuestions.length ? [] : filteredQuestions.map(q => q._id))} 
                    className="ml-4 font-semibold text-blue-600 hover:underline"
                  >
                    {selectedQuestions.length === filteredQuestions.length ? 'Deselect All' : 'Select All Filtered'}
                  </button>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input type="text" placeholder="Search questions..." value={questionSearch} onChange={e => setQuestionSearch(e.target.value)} className="w-full pl-10 p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-[#01b4ae]" />
                </div>
                <input type="text" placeholder="Topic filter..." value={topicFilter} onChange={e => setTopicFilter(e.target.value)} className="flex-1 p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-[#01b4ae]" />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 border border-gray-100 p-2 rounded-xl max-h-[400px]">
                {filteredQuestions.map(q => (
                  <div key={q._id} onClick={() => {
                    if (selectedQuestions.includes(q._id)) setSelectedQuestions(selectedQuestions.filter(id => id !== q._id));
                    else setSelectedQuestions([...selectedQuestions, q._id]);
                  }} className={`p-4 rounded-xl border cursor-pointer hover:border-[#01b4ae] flex gap-4 ${selectedQuestions.includes(q._id) ? 'bg-[#01b4ae]/5 border-[#01b4ae]' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={selectedQuestions.includes(q._id)} readOnly className="mt-1 w-5 h-5 text-[#01b4ae] rounded" />
                    <div>
                      <p className="text-gray-900 font-medium line-clamp-2">{q.question}</p>
                      <div className="flex text-xs text-gray-500 mt-2 gap-3">
                        <span className="bg-gray-100 px-2 py-1 rounded">{q.subject?.name}</span>
                        {q.topicName && <span className="bg-gray-100 px-2 py-1 rounded">{q.topicName}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div className="space-y-6 animate-fade-in flex flex-col h-full">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">4. Assign Students</h2>
                <div className="text-sm text-gray-500">
                  <span className="font-bold text-[#01b4ae]">{selectedFilteredCount}</span> of {filteredStudents.length} visible ({selectedStudents.length} total)
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input type="text" placeholder="Search students..." value={studentSearch} onChange={e => setStudentSearch(e.target.value)} className="w-full pl-10 pr-10 p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-[#01b4ae]" />
                {studentSearch && (
                  <button onClick={() => setStudentSearch('')} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Select All with indeterminate checkbox */}
              <label className="flex items-center gap-3 cursor-pointer select-none px-1">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={handleSelectAllFiltered}
                  disabled={filteredStudents.length === 0}
                  className="w-5 h-5 text-[#01b4ae] rounded accent-[#01b4ae]"
                />
                <span className={`font-semibold ${filteredStudents.length === 0 ? 'text-gray-400' : 'text-gray-700'}`}>
                  {allFilteredSelected ? 'Deselect All' : 'Select All'}{debouncedStudentSearch ? ' (Filtered)' : ''}
                </span>
              </label>

              <div className="flex-1 overflow-y-auto space-y-2 border border-gray-100 p-2 rounded-xl max-h-[400px]">
                {filteredStudents.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">{studentSearch ? 'No matching students' : 'No students available'}</p>
                ) : (
                  filteredStudents.map(s => (
                    <div key={s._id} onClick={() => toggleStudent(s._id)} className={`p-4 rounded-xl border cursor-pointer hover:border-[#01b4ae] flex gap-4 items-center ${selectedStudents.includes(s._id) ? 'bg-[#01b4ae]/5 border-[#01b4ae]' : 'bg-white border-gray-200'}`}>
                      <input type="checkbox" checked={selectedStudents.includes(s._id)} readOnly className="w-5 h-5 text-[#01b4ae] rounded" />
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center font-bold text-blue-700">
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-gray-900 font-bold">{s.name}</p>
                        <p className="text-gray-500 text-sm">{s.email}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

        {/* Action Buttons */}
        <div className="flex justify-between mt-8">
          <button 
            onClick={() => setStep(step - 1)} 
            disabled={step === 1}
            className={`flex items-center px-6 py-3 rounded-xl font-bold transition-all ${step === 1 ? 'opacity-0' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            <ChevronLeft className="w-5 h-5 mr-2" /> Back
          </button>
          
          {step < 4 ? (
            <button 
              onClick={() => {
                if (step === 1 && selectedSubjects.length === 0) return alert('Select at least one subject');
                if (step === 2 && !title.trim()) return alert('Enter test title');
                if (step === 3 && selectedQuestions.length === 0) return alert('Select at least one question');
                setStep(step + 1);
              }}
              className="flex items-center px-6 py-3 rounded-xl font-bold bg-[#01b4ae] text-white hover:bg-[#009d99] shadow-lg shadow-[#01b4ae]/30 transition-all"
            >
              Next <ChevronRight className="w-5 h-5 ml-2" />
            </button>
          ) : (
            <button 
              onClick={handleCreate}
              disabled={creating}
              className={`flex items-center px-8 py-3 rounded-xl font-bold shadow-lg transition-all ${creating ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/30'}`}
            >
              <Check className="w-5 h-5 mr-2" /> {creating ? 'Saving...' : editId ? 'Update Test' : 'Create Test'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
