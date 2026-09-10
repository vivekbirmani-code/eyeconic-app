import { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, UploadCloud, FileSpreadsheet, CheckCircle, Info } from 'lucide-react';

export default function ImportQuiz() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState<{ count: number } | null>(null);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);

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
      {/* Header */}
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

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10 space-y-6">

        {/* ── Upload Card ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-8 md:p-12 border border-gray-100 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.1)] text-center animate-fade-in-up">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileSpreadsheet className="w-10 h-10 text-blue-600" />
          </div>

          <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">Upload Questions — Excel</h2>
          <p className="text-sm text-gray-500 mb-8 max-w-md mx-auto leading-relaxed">
            Upload an <strong>.xlsx</strong> or <strong>.xls</strong> file. Every row is one question.
            Expand the <em>Upload Guidelines</em> below for column names, accepted values, and type-specific fields.
          </p>

          <label className="border-2 border-dashed border-gray-300 rounded-2xl p-8 block cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all mb-6">
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
            <UploadCloud className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            {file ? (
              <span className="font-bold text-blue-600">{file.name}</span>
            ) : (
              <span className="font-bold text-gray-600">
                Click to select a file
                <span className="font-normal text-gray-400 block mt-1">or drag and drop here — .xlsx or .xls only</span>
              </span>
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
            {uploading ? 'Processing…' : 'Upload & Import'}
          </button>
        </div>

        {/* ── Upload Guidelines ──────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.1)] overflow-hidden">
          <button
            onClick={() => setGuidelinesOpen((o) => !o)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors text-left"
          >
            <span className="flex items-center gap-2 font-semibold text-gray-800">
              <Info className="w-5 h-5 text-blue-500" />
              Upload Guidelines
            </span>
            <span className="text-gray-400 text-sm select-none">{guidelinesOpen ? '▲ collapse' : '▼ expand'}</span>
          </button>

          {guidelinesOpen && (
            <div className="px-6 pb-8 pt-2 space-y-8 text-sm text-gray-700 border-t border-gray-100">

              {/* Intro */}
              <p className="text-gray-500 leading-relaxed">
                Every row is one question. Column headers are <strong>case-insensitive</strong> and ignore spaces/punctuation —{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">Q_IMAGE</code>,{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">Q IMAGE</code>, and{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">QIMAGE</code> are all equivalent.
                Place questions on a sheet named <strong>Question Bank</strong>{' '}
                (or <code className="bg-gray-100 px-1 rounded text-xs">Questions</code> /{' '}
                <code className="bg-gray-100 px-1 rounded text-xs">Sheet1</code>) with headers in row 1.
              </p>

              {/* Required Columns */}
              <section>
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-1">
                  Required Columns
                  <span className="text-xs font-normal text-red-500 ml-1">(must be present in every row)</span>
                </h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-36">Column</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Description</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-44">Example value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {([
                        ['SUBJECT',       'Subject name — must match an existing Subject in the system',                        'Pathology'],
                        ['TOPIC',         'Topic name',                                                                        'Genetics'],
                        ['SUBTOPIC',      'Subtopic name',                                                                     'Mendelian Inheritance'],
                        ['SYSTEM',        'Organ-system name',                                                                 'Genetic Disorders'],
                        ['QUESTION_TYPE', 'Question type — see the Question Types table below',                                'mcq_single'],
                        ['DIFFICULTY',    'easy, medium, or hard  (case-insensitive; moderate → medium)',                      'medium'],
                        ['QUESTION',      'Question stem text',                                                                'What is the powerhouse of the cell?'],
                        ['CORRECT',       'Correct answer — format depends on question type (see Type-Specific section below)', 'B  or  2  or  1-C,2-A'],
                      ] as [string, string, string][]).map(([col, desc, ex]) => (
                        <tr key={col} className="even:bg-gray-50/40">
                          <td className="px-4 py-2 font-mono font-semibold text-blue-700">{col}</td>
                          <td className="px-4 py-2 text-gray-600">{desc}</td>
                          <td className="px-4 py-2 text-gray-500 italic">{ex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Optional Columns */}
              <section>
                <h3 className="font-bold text-gray-900 mb-3">Optional Columns</h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-48">Column(s)</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Description</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-36">If left blank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {([
                        ['TAG / TAGS',             'Comma-separated tags attached to the question',                                                                                                              'No tags added'],
                        ['Q_IMAGE',                'Question image URL (https:// direct link; Google Drive share-links auto-converted). Required for image_based type.',                                         'No image'],
                        ['SOLUTION / EXPLANATION', 'Explanation / solution text shown after answering',                                                                                                         'No explanation'],
                        ['SOLUTION_IMAGE / EX_IMAGE', 'Image shown alongside the explanation (same URL rules as Q_IMAGE)',                                                                                      'No image'],
                        ['OPTION1 – OPTION6',      'Answer options (2–6). Required for mcq_single, multiple_correct, image_based. Optional for assertion_reason. Not used for numerical.',                      'No option'],
                        ['O_IMAGE_1 – O_IMAGE_6',  'Optional image per answer option',                                                                                                                         'No option image'],
                        ['QID',                    'External or legacy question ID — used for deduplication on re-import',                                                                                      'Auto-assigned'],
                        ['MARROW_CODE',            'Source code (e.g. from Marrow)',                                                                                                                            'Omitted'],
                      ] as [string, string, string][]).map(([col, desc, blank]) => (
                        <tr key={col} className="even:bg-gray-50/40">
                          <td className="px-4 py-2 font-mono font-semibold text-indigo-700 whitespace-nowrap">{col}</td>
                          <td className="px-4 py-2 text-gray-600">{desc}</td>
                          <td className="px-4 py-2 text-gray-400 italic">{blank}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Question Types */}
              <section>
                <h3 className="font-bold text-gray-900 mb-1">Question Types</h3>
                <p className="text-xs text-gray-500 mb-3">Enter either the canonical ID or any accepted alias — all are case-insensitive.</p>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-40">Canonical ID</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">All accepted values for QUESTION_TYPE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {([
                        ['mcq_single',          'mcq_single · mcq · MCQ Single Correct · Single Correct · mcq-single correct · mcq-single_correct · MCQ-Single Correct · MCQ — Single Correct'],
                        ['assertion_reason',    'assertion_reason · assertion reason · Assertion / Reason · assertion-reason · Assertion & Reason · Assertions/Reason · Assertion and Reasoning'],
                        ['match_the_following', 'match_the_following · Match the Following · Matching'],
                        ['image_based',         'image_based · Image Based · Image-Based'],
                        ['multiple_correct',    'multiple_correct · Multiple Correct · Multi Correct · multi_correct'],
                        ['numerical',           'numerical · Numeric'],
                      ] as [string, string][]).map(([id, aliases]) => (
                        <tr key={id} className="even:bg-gray-50/40">
                          <td className="px-4 py-2 font-mono font-bold text-blue-700 whitespace-nowrap">{id}</td>
                          <td className="px-4 py-2 text-gray-600">{aliases}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Type-Specific Columns */}
              <section>
                <h3 className="font-bold text-gray-900 mb-3">Type-Specific Column Requirements</h3>
                <div className="space-y-3 text-xs">

                  <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                    <div className="font-mono font-bold text-blue-700 mb-2">mcq_single / image_based</div>
                    <div className="space-y-1">
                      <div className="flex gap-3"><code className="font-semibold text-blue-800 w-36 flex-shrink-0">OPTION1–OPTION6</code><span className="text-gray-600">At least 2 options required</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-blue-800 w-36 flex-shrink-0">CORRECT</code><span className="text-gray-600">Option number (1–6), letter (A–F), or exact option text</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-blue-800 w-36 flex-shrink-0">Q_IMAGE</code><span className="text-gray-600">Required for <em>image_based</em>; optional for <em>mcq_single</em></span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                    <div className="font-mono font-bold text-violet-700 mb-2">multiple_correct</div>
                    <div className="space-y-1">
                      <div className="flex gap-3"><code className="font-semibold text-violet-800 w-36 flex-shrink-0">OPTION1–OPTION6</code><span className="text-gray-600">At least 2 options required</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-violet-800 w-36 flex-shrink-0">CORRECT</code><span className="text-gray-600">Comma- or semicolon-separated — e.g. <em>A,C</em> or <em>1,3</em></span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                    <div className="font-mono font-bold text-amber-700 mb-2">assertion_reason</div>
                    <div className="space-y-1">
                      <div className="flex gap-3"><code className="font-semibold text-amber-800 w-36 flex-shrink-0">ASSERTION</code><span className="text-gray-600">Assertion (A) statement text — required</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-amber-800 w-36 flex-shrink-0">REASON</code><span className="text-gray-600">Reason (R) statement text — required</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-amber-800 w-36 flex-shrink-0">OPTION1–OPTION4</code><span className="text-gray-600">Optional — omit to use the four standard NEET relationship statements automatically</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-amber-800 w-36 flex-shrink-0">CORRECT</code><span className="text-gray-600">1-based index or letter — e.g. <em>A</em> or <em>1</em></span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                    <div className="font-mono font-bold text-emerald-700 mb-2">match_the_following</div>
                    <div className="space-y-1">
                      <div className="flex gap-3"><code className="font-semibold text-emerald-800 w-36 flex-shrink-0">COLUMN_A</code><span className="text-gray-600">Semicolon- or newline-separated list (≥ 2 items)</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-emerald-800 w-36 flex-shrink-0">COLUMN_B</code><span className="text-gray-600">Semicolon- or newline-separated list (≥ 2 items)</span></div>
                      <div className="flex gap-3"><code className="font-semibold text-emerald-800 w-36 flex-shrink-0">CORRECT</code><span className="text-gray-600">Mapping — e.g. <em>1-C,2-A,3-D,4-B</em> or <em>1:3,2:1,3:4,4:2</em></span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4">
                    <div className="font-mono font-bold text-rose-700 mb-2">numerical</div>
                    <div className="space-y-1">
                      <div className="flex gap-3"><code className="font-semibold text-rose-800 w-36 flex-shrink-0">CORRECT</code><span className="text-gray-600">Exact numeric answer — e.g. <em>12.5</em> (no tolerance applied)</span></div>
                    </div>
                  </div>

                </div>
              </section>

              {/* Notes */}
              <section>
                <h3 className="font-bold text-gray-900 mb-2">Notes</h3>
                <ul className="list-disc list-inside space-y-1 text-xs text-gray-500">
                  <li>Rows with errors are skipped with a row-numbered message (e.g. <em>Row 14: Difficulty is required.</em>). Valid rows in the same file still import.</li>
                  <li>Image URLs must be direct <code className="bg-gray-100 px-1 rounded">https://</code> links. Google Drive share-links are converted automatically. Placeholder hosts (example.com) are rejected.</li>
                  <li><code className="bg-gray-100 px-1 rounded">TAG</code> / <code className="bg-gray-100 px-1 rounded">TAGS</code> is never inferred from Topic/Subtopic — leave blank if not applicable.</li>
                  <li>Per-row <code className="bg-gray-100 px-1 rounded">MARKS</code> is ignored — scoring is configured at the quiz level.</li>
                  <li>Re-importing the same question (matched by content) updates the existing entry rather than creating a duplicate.</li>
                </ul>
              </section>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
