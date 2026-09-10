# Excel Format Reference

This is the single format used both by the standalone **Question Bank bulk import**
(`POST /api/question-bank/bulk-import` / `bulk-import-base64`) and by **Import Quiz
from Excel** (`POST /api/quizzes/import-excel`). Column headers are case-insensitive
and ignore spaces/punctuation (e.g. `Q_IMAGE`, `Q IMAGE`, and `QImage` are all the
same column).

Every question row must specify all seven canonical classification parameters
(Subject, Topic, Subtopic, System, Question Type, Difficulty are **required**; Tag is
optional), plus the columns required by that row's Question Type.

## Required metadata columns (every row)

| Column Header | Description | Example |
| :--- | :--- | :--- |
| **SUBJECT** | (Required) Subject name — must match an existing Subject | Pathology |
| **TOPIC** | (Required) Topic name | Genetics |
| **SUBTOPIC** | (Required) Subtopic name | Mendelian Inheritance |
| **SYSTEM** | (Required) System/organ-system name | Genetic Disorders |
| **QUESTION_TYPE** | (Required) One of the six canonical types (id or label, see below) | MCQ — Single Correct |
| **DIFFICULTY** | (Required) `easy`, `medium`, or `hard` (case-insensitive; `moderate` maps to `medium`) | medium |
| **TAG** or **TAGS** | (Optional) Comma-separated tags | important, 2024 |
| **QUESTION** | (Required) Question text | What is the powerhouse of the cell? |
| **Q_IMAGE** | (Optional, required for Image-Based) Image URL (Direct or Google Drive share link) | https://... |
| **SOLUTION** / **EXPLANATION** | (Optional) Explanation text | Because mitochondria... |
| **SOLUTION_IMAGE** / **EX_IMAGE** | (Optional) Image for Explanation | https://... |
| **QID** | (Optional) External/legacy question ID | Q-1029 |
| **MARROW_CODE** | (Optional) Source code, e.g. from Marrow | MAR-102 |

## Question Type values

`QUESTION_TYPE` accepts either the canonical id or its human-readable label (case-insensitive, spaces/punctuation ignored):

| Canonical id | Accepted labels |
| :--- | :--- |
| `mcq_single` | MCQ — Single Correct, MCQ, MCQ Single, Single Correct, mcq-single correct, mcq-single_correct, MCQ-Single Correct |
| `assertion_reason` | Assertion / Reason, Assertion Reason, Assertion & Reason, Assertions/Reason, Assertion and Reasoning |
| `match_the_following` | Match the Following, Matching |
| `image_based` | Image-Based, Image Based |
| `multiple_correct` | Multiple Correct, Multi Correct |
| `numerical` | Numerical, Numeric |

## Type-specific columns

### `mcq_single` and `image_based`

| Column Header | Description |
| :--- | :--- |
| **OPTION1**–**OPTION6** | 2–6 options (at least 2 required) |
| **O_IMAGE_1**–**O_IMAGE_6** | Optional image per option |
| **CORRECT** | Correct option: 1-based number, letter (A–F), or exact option text |

`image_based` additionally **requires** `Q_IMAGE`.

### `multiple_correct`

| Column Header | Description |
| :--- | :--- |
| **OPTION1**–**OPTION6** | 2–6 options |
| **CORRECT** | Comma/semicolon-separated list of correct options, e.g. `1,3` or `A,C` |

### `assertion_reason`

| Column Header | Description |
| :--- | :--- |
| **ASSERTION** | Assertion (A) statement text |
| **REASON** | Reason (R) statement text |
| **OPTION1**–**OPTION4** | Optional — if omitted, the four standard NEET relationship statements are used automatically |
| **CORRECT** | 1-based index (or letter) into the four relationship options |

### `match_the_following`

| Column Header | Description |
| :--- | :--- |
| **COLUMN_A** | Newline- or `;`-separated list of Column A items (≥2) |
| **COLUMN_B** | Newline- or `;`-separated list of Column B items (≥2) |
| **CORRECT** | Mapping, e.g. `1-C,2-A,3-D,4-B` or `1:3,2:1,3:4,4:2` (Column A index → Column B index/letter) |

### `numerical`

| Column Header | Description |
| :--- | :--- |
| **CORRECT** | Exact numeric answer, e.g. `12.5`. No tolerance is applied. |

## Notes

- Invalid or incomplete rows are rejected with a **row-numbered** error message (e.g. `Row 14: Difficulty is required.`) and are not imported; valid rows in the same file still import.
- Download a canonical template from `GET /api/question-bank/import-template` (admin auth required). Example rows use human-readable `QUESTION_TYPE` labels; the Format Guide sheet documents canonical ids.
- Type-specific values must be placed in their named columns (`ASSERTION`, `REASON`, `COLUMN_A`, `COLUMN_B`, `CORRECT`). Older hand-edited templates that shifted these values into adjacent columns (e.g. assertion text in `O_IMAGE_6`) are auto-recovered when the pattern is unambiguous.
- `TAG`/`TAGS` is never inferred from Topic/Subtopic/System — leave it blank if not applicable.
- Per-question `MARKS` from Excel is not used; scoring (positive/negative marks) is configured at the quiz level when the question is added to a test.
- Legacy Question Bank documents created before these columns existed remain in the database and are treated as `mcq_single` / `difficulty: medium` at read/grade time — they are **not** modified. To fully reset the bank, use `backend/clear_quiz_data.js` **manually**; it is never invoked automatically.
