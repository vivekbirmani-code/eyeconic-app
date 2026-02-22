import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { 
  Search, ChevronRight, ChevronLeft
} from 'lucide-react';

interface TestItem { _id: string; title: string; testType: string; assignedCount: number; attemptCount: number; }
interface Student { _id: string; name: string; email: string; }

export default function Analytics() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'tests' | 'students'>('tests');
  
  // Data
  const [tests, setTests] = useState<TestItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // detail views
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [testData, setTestData] = useState<any>(null);

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentData, setStudentData] = useState<any>(null);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [testsRes, studentsRes] = await Promise.all([
        api.get('/quizzes/analytics/list'),
        api.get('/users?role=student')
      ]);
      setTests(Array.isArray(testsRes.data) ? testsRes.data : []);
      setStudents(Array.isArray(studentsRes.data) ? studentsRes.data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchTestAnalytics = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/quizzes/analytics/${id}`);
      setTestData(res.data);
      setSelectedTest(id);
    } catch (e) { alert('Failed to fetch test analytics'); }
    finally { setLoading(false); }
  };

  const fetchStudentAnalytics = async (student: Student) => {
    setLoading(true);
    try {
      const res = await api.get(`/student-analytics/summary/${student._id}`);
      setStudentData(res.data);
      setSelectedStudent(student);
    } catch (e) { alert('Failed to fetch student analytics'); }
    finally { setLoading(false); }
  };

  const filteredTests = tests.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredStudents = students.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.email.toLowerCase().includes(searchQuery.toLowerCase()));

  if (user?.role !== 'admin') return <div className="p-8">Access Denied</div>;

  return (
    <div className="flex-1 bg-gray-50 min-h-screen">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-4 md:px-8 py-6 shadow-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={() => {
            if (selectedTest) setSelectedTest(null);
            else if (selectedStudent) setSelectedStudent(null);
            else navigate('/quizzes');
          }} className="p-2 bg-white/20 rounded-xl hover:bg-white/30 text-white transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide">
              {selectedTest ? 'Test Analytics' : selectedStudent ? `${selectedStudent.name}'s Analytics` : 'Student Analytics'}
            </h1>
            <p className="text-white/80 text-sm font-medium">Track performance and insights</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        
        {/* Main View (No selection) */}
        {!selectedTest && !selectedStudent && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex bg-gray-200 p-1 rounded-xl">
                <button onClick={() => setActiveTab('tests')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-colors ${activeTab === 'tests' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>By Test</button>
                <button onClick={() => setActiveTab('students')} className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-colors ${activeTab === 'students' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>By Student</button>
              </div>
              <div className="relative w-full md:w-auto">
                <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input type="text" placeholder={`Search ${activeTab}...`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full md:w-80 pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-purple-500" />
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500 animate-pulse font-medium">Loading data...</div>
            ) : activeTab === 'tests' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTests.map(t => (
                  <div key={t._id} onClick={() => fetchTestAnalytics(t._id)} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] hover:shadow-md cursor-pointer transition-all hover:border-purple-300 group flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-gray-900 group-hover:text-purple-600 transition-colors">{t.title}</h3>
                      <p className="text-sm font-medium text-gray-500 capitalize">{t.testType} Test</p>
                      <div className="flex gap-4 mt-3">
                        <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-md">{t.assignedCount} Assigned</span>
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">{t.attemptCount} Attempts</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {filteredStudents.map(s => (
                  <div key={s._id} onClick={() => fetchStudentAnalytics(s)} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] hover:shadow-md cursor-pointer transition-all hover:border-purple-300 group flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-purple-50 flex items-center justify-center font-bold text-purple-600 text-lg">{s.name.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 truncate group-hover:text-purple-600 transition-colors">{s.name}</h3>
                      <p className="text-sm text-gray-500 truncate">{s.email}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Selected Test Detail */}
        {selectedTest && testData && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"><p className="text-sm text-gray-500 font-bold uppercase mb-1">Avg Score</p><p className="text-2xl font-bold text-purple-600">{testData.averageScore?.toFixed(1) || 0}%</p></div>
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"><p className="text-sm text-gray-500 font-bold uppercase mb-1">Attempts</p><p className="text-2xl font-bold text-gray-800">{testData.totalAttempts || 0}</p></div>
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"><p className="text-sm text-gray-500 font-bold uppercase mb-1">Avg Correct</p><p className="text-2xl font-bold text-emerald-500">{testData.avgCorrect?.toFixed(1) || 0}</p></div>
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"><p className="text-sm text-gray-500 font-bold uppercase mb-1">Avg Time</p><p className="text-2xl font-bold text-blue-500">{Math.floor((testData.avgTime || 0) / 60)}m</p></div>
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 overflow-hidden">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Student Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                      <th className="p-3 font-bold rounded-tl-lg">Student</th>
                      <th className="p-3 font-bold">Score</th>
                      <th className="p-3 font-bold">C / W / S</th>
                      <th className="p-3 font-bold">Time</th>
                      <th className="p-3 font-bold rounded-tr-lg">Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(testData.studentPerformance || []).map((sp: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="p-3 font-bold text-gray-800">{sp.studentName}</td>
                        <td className="p-3 font-bold text-purple-600">{sp.percentage?.toFixed(1)}%</td>
                        <td className="p-3 text-sm text-gray-600">{sp.correct} <span className="text-gray-300">/</span> {sp.wrong} <span className="text-gray-300">/</span> {sp.skipped}</td>
                        <td className="p-3 text-sm text-gray-600">{Math.floor(sp.timeTaken / 60)}m {sp.timeTaken % 60}s</td>
                        <td className="p-3">
                          {sp.tabSwitchCount > 0 ? <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold border border-amber-200">{sp.tabSwitchCount} tab switches</span> : <span className="text-xs text-gray-400">None</span>}
                        </td>
                      </tr>
                    ))}
                    {testData.studentPerformance?.length === 0 && (
                      <tr><td colSpan={5} className="p-6 text-center text-gray-500">No student has attempted this test yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Selected Student Detail */}
        {selectedStudent && studentData && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"><p className="text-sm text-gray-500 font-bold uppercase mb-1">Total Tests</p><p className="text-2xl font-bold text-indigo-600">{studentData.summary.totalTests}</p></div>
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"><p className="text-sm text-gray-500 font-bold uppercase mb-1">Avg Score</p><p className="text-2xl font-bold text-gray-800">{studentData.summary.avgPercentage.toFixed(1)}%</p></div>
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"><p className="text-sm text-gray-500 font-bold uppercase mb-1">Marks</p><p className="text-2xl font-bold text-emerald-500">{studentData.summary.obtainedMarks} / {studentData.summary.totalMarks}</p></div>
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 overflow-hidden">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Attempt History</h3>
              <div className="space-y-3">
                {(studentData.attempts || []).map((att: any, i: number) => (
                  <div key={i} className="p-4 border border-gray-100 rounded-xl hover:border-indigo-300 transition-colors flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50 hover:bg-white">
                    <div>
                      <h4 className="font-bold text-gray-800 text-[15px]">{att.quiz?.title || att.title}</h4>
                      <p className="text-sm text-gray-500 mt-1 capitalize">{att.testType} Test • Completed on {new Date(att.endTime).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="text-center bg-white px-4 py-1.5 rounded-lg border border-gray-100"><span className="block text-xs text-gray-500 font-bold uppercase">Score</span><span className="font-bold text-indigo-600">{att.percentage.toFixed(1)}%</span></div>
                      <div className="text-center bg-white px-4 py-1.5 rounded-lg border border-gray-100"><span className="block text-xs text-gray-500 font-bold uppercase">Marks</span><span className="font-bold text-gray-700">{att.marksObtained}/{att.totalMarks}</span></div>
                    </div>
                  </div>
                ))}
                {studentData.attempts?.length === 0 && (
                  <div className="p-6 text-center text-gray-500">Student has not taken any tests yet.</div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
