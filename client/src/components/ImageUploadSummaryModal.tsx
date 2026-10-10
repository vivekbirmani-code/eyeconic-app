import { useEffect } from 'react';
import { CheckCircle, AlertTriangle, Image as ImageIcon, X } from 'lucide-react';

/**
 * Shape of backend `imageSummary` (utils/importImageSummary.js) returned by
 * both Excel import endpoints. `type` maps to display labels; option images
 * arrive as `option1` … `option6` (one slot per O_IMAGE_n column).
 */
export interface ImageImportFailure {
  row: number;
  type: 'question' | 'solution' | `option${number}`;
  reason?: string;
}

export interface ImageImportSummary {
  total: number;
  uploaded: number;
  failed: number;
  /** Detected but not processed — the row was a duplicate, so the existing
   *  question (with its own stored images) was reused. Absent on older
   *  payloads; treated as 0. */
  skipped?: number;
  failures: ImageImportFailure[];
}

const typeLabel = (type: ImageImportFailure['type']): string => {
  if (type === 'question') return 'Question Image';
  if (type === 'solution') return 'Solution Image';
  return `Option Image ${type.replace(/^option/, '')}`;
};

interface ImageUploadSummaryModalProps {
  summary: ImageImportSummary | null;
  onClose: () => void;
}

/**
 * Post-import image report shown after an Excel import finishes: total
 * question/option/solution images in the file, how many ended up stored and
 * linked, and — for every failure — the sheet row, image type (option images
 * carry their option number), and why it failed. All-success and no-image
 * states render as clear status banners instead of a failure list.
 */
export default function ImageUploadSummaryModal({ summary, onClose }: ImageUploadSummaryModalProps) {
  useEffect(() => {
    if (!summary) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [summary, onClose]);

  if (!summary) return null;

  const skipped = Number(summary.skipped) || 0;
  const allUploaded = summary.failed === 0;
  const processed = summary.total - skipped;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
          <ImageIcon className="w-5 h-5 text-[#01b4ae]" />
          <h2 className="flex-1 text-base font-bold text-gray-900">Image Upload Summary</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {summary.total === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              No images were found in this file.
            </div>
          ) : (
            <>
              <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 ${allUploaded ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                {allUploaded
                  ? <CheckCircle className="w-[18px] h-[18px] text-emerald-600 flex-shrink-0" />
                  : <AlertTriangle className="w-[18px] h-[18px] text-amber-600 flex-shrink-0" />}
                <p className={`text-[13px] font-semibold leading-snug ${allUploaded ? 'text-emerald-700' : 'text-amber-800'}`}>
                  {allUploaded && skipped === 0
                    ? `All ${summary.total} image${summary.total === 1 ? '' : 's'} uploaded successfully.`
                    : allUploaded
                      ? `${summary.uploaded} image${summary.uploaded === 1 ? '' : 's'} uploaded · ${skipped} skipped — reused questions kept their existing images.`
                      : `${summary.failed} of ${processed} image${processed === 1 ? '' : 's'} could not be uploaded${skipped > 0 ? ` · ${skipped} skipped (reused)` : ''}.`}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 sm:flex">
                <div className="flex-1 rounded-xl bg-gray-50 px-3 py-2.5 text-center">
                  <p className="text-xl font-bold text-gray-900">{summary.total}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Total in Excel</p>
                </div>
                <div className="flex-1 rounded-xl bg-emerald-50 px-3 py-2.5 text-center">
                  <p className="text-xl font-bold text-emerald-700">{summary.uploaded}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Uploaded</p>
                </div>
                <div className="flex-1 rounded-xl bg-red-50 px-3 py-2.5 text-center">
                  <p className="text-xl font-bold text-red-600">{summary.failed}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Failed</p>
                </div>
                {skipped > 0 && (
                  <div className="flex-1 rounded-xl bg-gray-50 px-3 py-2.5 text-center">
                    <p className="text-xl font-bold text-gray-900">{skipped}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Skipped</p>
                  </div>
                )}
              </div>
            </>
          )}

          {summary.failures.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-bold text-gray-900 mb-2">Failed images</p>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {summary.failures.map((failure, i) => (
                  <div key={`${failure.row}-${failure.type}-${i}`} className="rounded-lg bg-red-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-red-700">Row {failure.row}</span>
                      <span className="bg-white rounded-md px-2 py-0.5 text-[11px] font-semibold text-red-700">{typeLabel(failure.type)}</span>
                    </div>
                    {failure.reason && <p className="text-[11px] text-red-600/90 mt-1 leading-snug">{failure.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-4">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-bold text-white bg-[#01b4ae] hover:bg-[#009d99] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
