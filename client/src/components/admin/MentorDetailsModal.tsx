import { X, Loader2 } from 'lucide-react';

interface MentorDetails {
  mentor: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
  };
  students: Array<{
    student: {
      _id: string;
      name: string;
      email: string;
      phone?: string;
    };
    subjects: Array<{
      _id: string;
      name: string;
      year: string;
    }>;
    assignments: any[];
    stats: {
      total: number;
      pending: number;
      completed: number;
      verified: number;
      redo: number;
    };
  }>;
}

interface MentorDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mentorData: MentorDetails | null;
  isLoading: boolean;
}

export default function MentorDetailsModal({ isOpen, onClose, mentorData, isLoading }: MentorDetailsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-fade-in-up">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900">
            {mentorData?.mentor?.name || 'Mentor Details'}
          </h2>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 space-y-4">
              <Loader2 className="w-8 h-8 text-[#01b4ae] animate-spin" />
              <p className="text-gray-500 font-medium">Loading details...</p>
            </div>
          ) : !mentorData?.students?.length ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No students assigned to this mentor yet.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {mentorData.students.map((studentData) => (
                <div key={studentData.student._id} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                  {/* Student Info */}
                  <div className="mb-4">
                    <h3 className="text-lg font-bold text-gray-900">{studentData.student.name}</h3>
                    <p className="text-sm text-gray-500">{studentData.student.email}</p>
                  </div>

                  {/* Subjects */}
                  <div className="mb-5">
                    <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Subjects</p>
                    <div className="flex flex-wrap gap-2">
                      {studentData.subjects.map(subject => (
                        <span key={subject._id} className="px-3 py-1 bg-[#01b4ae]/10 text-[#01b4ae] rounded-lg text-xs font-semibold border border-[#01b4ae]/20">
                          {subject.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Mini Stats Grid */}
                  <div className="grid grid-cols-3 gap-4 py-4 border-t border-b border-gray-100 mb-5">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-gray-900">{studentData.stats.total}</p>
                      <p className="text-xs font-medium text-gray-500 uppercase">Total</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-500">{studentData.stats.pending}</p>
                      <p className="text-xs font-medium text-gray-500 uppercase">Pending</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-emerald-500">{studentData.stats.verified}</p>
                      <p className="text-xs font-medium text-gray-500 uppercase">Done</p>
                    </div>
                  </div>

                  {/* Assignments */}
                  {studentData.assignments.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-gray-900 mb-3">Recent Assignments</p>
                      <div className="space-y-3">
                        {studentData.assignments.slice(0, 5).map((assignment: any) => {
                          let statusColor = "bg-gray-100 text-gray-600";
                          if (assignment.status === 'verified') statusColor = "bg-emerald-100 text-emerald-700 border border-emerald-200";
                          else if (assignment.status === 'completed') statusColor = "bg-blue-100 text-blue-700 border border-blue-200";
                          else if (assignment.status === 'redo') statusColor = "bg-amber-100 text-amber-800 border border-amber-200";

                          return (
                            <div key={assignment._id} className="p-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-white transition-colors">
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="font-semibold text-gray-900 pr-4">{assignment.title}</h4>
                                <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider shrink-0 ${statusColor}`}>
                                  {assignment.status}
                                </span>
                              </div>
                              <div className="flex justify-between items-end">
                                <p className="text-xs text-gray-500 font-medium">{assignment.subject?.name || 'N/A'} • {assignment.taskType}</p>
                                <p className="text-xs text-gray-400">Due: {new Date(assignment.scheduledDate).toLocaleDateString()}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
