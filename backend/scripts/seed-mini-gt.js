/**
 * Local-dev seed for the Mini GT feature (run once, manually; never used in
 * production or tests):
 *
 *  1. ensures the three Mini GT subjects exist (Psychiatry, Dermatology,
 *     Orthopaedics — created uppercase to match the seeded bank);
 *  2. tops up each subject's single-best-answer pool with curated clinical
 *     MCQs (topic + 1–3 concept tags) when the bank is thin — idempotent via
 *     stable `qid`s;
 *  3. generates one Mini GT via the same createMiniGtQuiz the admin API
 *     uses.
 *
 * Usage: node scripts/seed-mini-gt.js [--no-generate]
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('dotenv').config();

const mongoose = require('mongoose');
const Subject = require('../models/Subject');
const QuestionBank = require('../models/QuestionBank');
const User = require('../models/User');
const { getMongoUri } = require('../utils/mongoUri');
const miniGt = require('../utils/miniGt');

// Enough tagged single-best-answer questions per subject that generation
// always has headroom (10 needed + slack for other quizzes' usage).
const TARGET_POOL_PER_SUBJECT = 15;

function q(subjectKey, n, topic, tags, question, options, correctAnswer, explanation, subtopic = 'Core', system = null) {
  return {
    qid: `MINICCT-${subjectKey}-${String(n).padStart(2, '0')}`,
    topicName: topic,
    subtopicName: subtopic,
    system: system || `${topic.split(' ')[0]} System`,
    questionType: 'mcq_single',
    difficulty: 'medium',
    tags,
    question,
    options,
    correctAnswer,
    explanation,
    isActive: true,
  };
}

// Curated NEET-PG-style content. Every question carries a topic and 1–3
// concept tags — the structure the Topic & Tag-wise Analysis consumes.
const CURATED = {
  Psychiatry: [
    q('PSY', 1, 'Schizophrenia & Related Disorders', ['Antipsychotics', 'Emergency Psychiatry'],
      'A 24-year-old on haloperidol for acute psychosis develops painful forced deviation of the neck and tongue protrusion 2 days after dose escalation. The MOST appropriate immediate treatment is:',
      ['Oral risperidone', 'Intramuscular benztropine', 'Intravenous lorazepam alone', 'Stop all antipsychotics permanently'], 1,
      'Acute dystonia (an acute extrapyramidal side effect) responds rapidly to anticholinergics such as benztropine or diphenhydramine.'),
    q('PSY', 2, 'Depressive Disorders', ['Diagnosis & Classification'],
      'According to DSM-5, a major depressive episode requires depressive symptoms present for at LEAST:',
      ['1 week', '2 weeks', '1 month', '3 months'], 1,
      'Five or more symptoms including depressed mood or anhedonia, present nearly every day for at least 2 weeks, are required.'),
    q('PSY', 3, 'Bipolar & Related Disorders', ['Mood Stabilizers', 'Psychopharmacology'],
      'The FIRST clinical manifestation of rising serum lithium levels into the toxic range is usually:',
      ['Polyuria', 'Coarse tremor with gastrointestinal symptoms', 'Hypothyroidism', 'Nephrogenic diabetes insipidus'], 1,
      'Fine tremor and GI upset occur at therapeutic levels; a COARSENING tremor with worsening GI symptoms is the earliest warning of toxicity.'),
    q('PSY', 4, 'Delirium & Major Neurocognitive Disorders', ['Cognitive Disorders'],
      'A 78-year-old postoperative patient is inattentive, disoriented and fluctuates between drowsiness and agitation over hours. The MOST likely diagnosis is:',
      ['Alzheimer disease', 'Vascular dementia', 'Delirium', 'Major depressive disorder'], 2,
      'Fluctuating consciousness and inattention of acute onset define delirium; dementia has an insidious, progressive course.'),
    q('PSY', 5, 'Obsessive-Compulsive & Related Disorders', ['Anxiety Spectrum', 'Psychotherapy'],
      'First-line treatment for a patient with moderate-to-severe obsessive-compulsive disorder is:',
      ['Antipsychotic monotherapy', 'SSRI plus exposure and response prevention therapy', 'Long-term benzodiazepines', 'Psychodynamic psychotherapy alone'], 1,
      'SSRIs at higher doses plus exposure and response prevention (a CBT technique) is the established first-line combination.'),
    q('PSY', 6, 'Anxiety Disorders', ['Panic Disorder', 'Diagnosis & Classification'],
      'A 22-year-old has recurrent episodes of intense fear with palpitations, sweating and choking that peak within about 10 minutes, followed by persistent worry about future attacks. The MOST likely diagnosis is:',
      ['Generalized anxiety disorder', 'Panic disorder', 'Social anxiety disorder', 'Agoraphobia'], 1,
      'Spontaneous, short-lived panic attacks with anticipatory anxiety characterize panic disorder.'),
    q('PSY', 7, 'Substance-Related & Addictive Disorders', ['Addiction Medicine', 'Emergency Psychiatry'],
      'A heavy drinker hospitalized for surgery develops tremors, sweating and hypertension 12 hours after his last drink. The treatment of choice is:',
      ['Haloperidol', 'A benzodiazepine such as chlordiazepoxide', 'Naltrexone', 'Disulfiram'], 1,
      'Alcohol withdrawal (starting 6–24 hours after the last drink) is treated with tapering benzodiazepines.'),
    q('PSY', 8, 'Personality Disorders', ['Cluster B Disorders', 'Psychotherapy'],
      'A 21-year-old has chronic unstable relationships, impulsivity, identity disturbance and recurrent self-harm. The psychotherapy with the BEST evidence for this condition is:',
      ['Dialectical behavior therapy', 'Flooding', 'Systematic desensitization', 'Supportive therapy alone'], 0,
      'These features suggest borderline personality disorder, for which dialectical behavior therapy is the best-studied treatment.'),
    q('PSY', 9, 'Somatic Therapies', ['ECT', 'Treatment-Resistant Depression'],
      'Electroconvulsive therapy is the treatment of CHOICE in which of the following situations?',
      ['Mild panic disorder', 'Depressive episode with psychotic features and refusal to eat', 'Simple phobia', 'Adjustment disorder'], 1,
      'ECT is preferred for life-threatening depression with psychosis, catatonia or refusal to eat, and in treatment-resistant cases.'),
    q('PSY', 10, 'Neurodevelopmental Disorders', ['Intellectual Disability', 'Diagnosis & Classification'],
      'Intellectual disability (intellectual developmental disorder) is defined by significantly impaired intellectual functioning (IQ approximately 70 or below) TOGETHER with:',
      ['Onset after 18 years of age', 'Deficits in adaptive functioning beginning in the developmental period', 'A structurally abnormal brain on MRI', 'Presence of seizures'], 1,
      'Both intellectual deficit AND impaired adaptive functioning, with onset in the developmental period, are required.'),
  ],
  Dermatology: [
    q('DERM', 1, 'Psoriasis', ['Papulosquamous Disorders', 'Signs in Dermatology'],
      'A 30-year-old has well-demarcated scaly plaques over the extensor surfaces of elbows and knees; scraping the scale produces pinpoint bleeding. This sign is called:',
      ['Nikolsky sign', 'Auspitz sign', 'Wickham striae', 'Darier sign'], 1,
      'Auspitz sign — pinpoint bleeding on scale removal — is characteristic of psoriasis; Nikolsky is positive in pemphigus vulgaris.'),
    q('DERM', 2, 'Lichen Planus', ['Papulosquamous Disorders', 'Oral Lesions'],
      'The classic oral finding in lichen planus is:',
      ['White lace-like reticular striae on the buccal mucosa', 'Cobblestone mucosal plaques', 'Clustered vesicles on an erythematous base', 'Smooth red atrophic patches'], 0,
      'Wickham striae — fine white lacy lines — classically involve the buccal mucosa and accompany the purple polygonal pruritic papules.', 'Clinical Signs', 'Skin & Mucosa'),
    q('DERM', 3, 'Vesiculobullous Disorders', ['Autoimmune Bullous Disease', 'Oral Lesions'],
      'A 40-year-old has flaccid blisters and erosions that start in the oral mucosa; gentle lateral pressure on normal skin shears the epidermis. Biopsy shows suprabasal acantholysis. The diagnosis is:',
      ['Bullous pemphigoid', 'Pemphigus vulgaris', 'Dermatitis herpetiformis', 'Epidermolysis bullosa simplex'], 1,
      'Pemphigus vulgaris: mucosal involvement first, Nikolsky positive, suprabasal split with acantholysis, IgG against desmoglein 3.'),
    q('DERM', 4, 'Vesiculobullous Disorders', ['Autoimmune Bullous Disease'],
      'In contrast, a 75-year-old has tense bullae on flexural skin with no mucosal involvement and a NEGATIVE Nikolsky sign. The blister in this disease is:',
      ['Subcorneal', 'Suprabasal', 'Subepidermal', 'Intrafollicular'], 2,
      'Bullous pemphigoid produces tense subepidermal blisters (IgG against BP180/BP230 hemidesmosomal antigens) in the elderly.'),
    q('DERM', 5, 'Acne & Rosacea', ['Retinoids', 'Adverse Effects'],
      'Before starting oral isotretinoin for severe nodulocystic acne in a woman of childbearing age, the MOST important baseline requirement is:',
      ['Liver biopsy', 'Pregnancy testing and reliable contraception', 'Chest X-ray', 'Serum creatinine'], 1,
      'Isotretinoin is highly teratogenic — two forms of contraception plus serial pregnancy tests are mandatory.'),
    q('DERM', 6, 'Pigmentary Disorders', ['Melasma', 'Hyperpigmentation'],
      'A 28-year-old woman in the third trimester develops symmetric brown macules over the cheeks, forehead and chin that worsen with sun exposure. The MOST likely diagnosis is:',
      ['Vitiligo', 'Melasma', 'Post-inflammatory hypopigmentation', 'Piebaldism'], 1,
      'Melasma (chloasma) — acquired symmetric facial hypermelanosis related to pregnancy, OCPs and UV exposure.'),
    q('DERM', 7, 'Infestations & Bites', ['Scabies', 'Parasitic Infections'],
      'A family has intense nocturnal pruritus with burrows in the web spaces of the fingers and wrists. First-line treatment is:',
      ['Oral prednisolone', 'Topical permethrin 5% cream applied to the whole body', 'Oral acyclovir', 'Topical clotrimazole'], 1,
      'Permethrin 5% is first-line for scabies; all household contacts should be treated simultaneously and clothing/bedding decontaminated.'),
    q('DERM', 8, 'Pigmentary Disorders', ['Vitiligo', 'Hypopigmentation'],
      'Which feature best differentiates vitiligo from other causes of white patches such as post-inflammatory hypopigmentation or leprosy patches (non-lesional skin)?',
      ['Complete depigmentation (milky white) macules', 'Scaly surface', 'Anesthesia of the patch', 'Raised borders'], 0,
      'Vitiligo is depigmented — total loss of melanin (milky white) — unlike hypopigmented lesions, which retain some pigment.'),
    q('DERM', 9, 'Cutaneous Adverse Drug Reactions', ['Emergency Dermatology', 'Drug Reactions'],
      'A patient on anticonvulsants develops rapidly spreading targetoid lesions with painful erosions of the lips, oral mucosa and conjunctivae plus skin detachment of >30% body surface area. The diagnosis is:',
      ['Stevens-Johnson syndrome/toxic epidermal necrolysis overlap', 'Erythema multiforme minor', 'Erythema nodosum', 'Fixed drug eruption'], 0,
      'Mucosal involvement plus extensive epidermal detachment defines SJS/TEN; sulfonamides, anticonvulsants, NSAIDs and allopurinol are classic triggers.'),
    q('DERM', 10, 'Skin Tumors', ['Skin Malignancies', 'Facial Lesions'],
      'An elderly farmer has a slow-growing pearly nodule with rolled edges, telangiectasia and central ulceration on the nose. The MOST likely diagnosis is:',
      ['Squamous cell carcinoma', 'Basal cell carcinoma', 'Malignant melanoma', 'Keratoacanthoma'], 1,
      'Basal cell carcinoma — pearly telangiectatic nodule with central ulceration ("rodent ulcer") on sun-exposed face; metastasizes extremely rarely.'),
  ],
  Orthopaedics: [
    q('ORTHO', 1, 'Fractures of the Distal Radius & Wrist', ['Wrist Injuries', 'FOOSH Injuries'],
      'A 60-year-old woman falls on an outstretched hand and develops a "dinner-fork" deformity of the wrist with dorsal displacement of the distal fragment. This is a:',
      ['Smith fracture', 'Colles fracture', 'Barton fracture', 'Galeazzi injury'], 1,
      'Colles fracture: transverse extra-articular distal radius fracture with dorsal and radial displacement after a fall on an outstretched hand.'),
    q('ORTHO', 2, 'Fractures of the Distal Radius & Wrist', ['Wrist Injuries', 'FOOSH Injuries'],
      'The same mechanism produces a distal radius fracture with VOLAR (anterior) displacement — the "garden spade" deformity. This is a:',
      ['Colles fracture', 'Smith fracture', 'Monteggia injury', 'Nightstick fracture'], 1,
      'Smith (reverse Colles) fracture: volar displacement of the distal fragment.'),
    q('ORTHO', 3, 'Injuries of the Elbow, Forearm & Hand', ['Forearm Fractures', 'Dislocations'],
      'A fracture of the proximal ulna shaft accompanied by dislocation of the radial head describes a:',
      ['Galeazzi injury', 'Monteggia injury', 'Essex-Lopresti injury', 'Bennett fracture'], 1,
      'Monteggia lesion = ulnar shaft fracture + anterior dislocation of the radial head; Galeazzi is its mirror image (radius + DRUJ).'),
    q('ORTHO', 4, 'Injuries of the Elbow, Forearm & Hand', ['Forearm Fractures', 'Dislocations'],
      'A fracture of the radial shaft at the junction of its middle and distal thirds with disruption of the distal radioulnar joint is a:',
      ['Monteggia injury', 'Galeazzi injury', 'Colles fracture', 'Hume injury'], 1,
      'Galeazzi fracture-dislocation: radial shaft fracture with distal radioulnar joint disruption; often needs ORIF.'),
    q('ORTHO', 5, 'Dislocations of the Hip', ['Hip Injuries', 'Nerve Injuries'],
      'After a dashboard injury, a patient\'s hip lies flexed, adducted and internally rotated with the leg appearing shortened. The nerve MOST commonly injured with this injury is the:',
      ['Femoral nerve', 'Sciatic nerve', 'Obturator nerve', 'Lateral femoral cutaneous nerve'], 1,
      'Posterior hip dislocation (classic dashboard injury) risks the sciatic nerve; the limb is flexed, adducted and internally rotated.'),
    q('ORTHO', 6, 'Fractures of the Femur', ['Hip Fractures', 'Avascular Necrosis'],
      'The MOST feared complication of an intracapsular (displaced femoral neck) fracture in a young adult is:',
      ['Avascular necrosis of the femoral head', 'Heterotopic ossification', 'Myositis ossificans', 'Chondrocalcinosis'], 0,
      'The retinacular blood supply is disrupted, making avascular necrosis and nonunion the classic complications of displaced femoral neck fractures.'),
    q('ORTHO', 7, 'Complications of Fractures', ['Emergency Orthopaedics', 'Compartment Syndrome'],
      'In a patient with a crushed leg, the EARLIEST reliable clinical sign of acute compartment syndrome is:',
      ['Absent distal pulses', 'Pain out of proportion worsened by passive stretch of the compartment muscles', 'Palpably tense woolly sensation', 'Paralysis'], 1,
      'Pain on passive stretch is the earliest and most sensitive sign; pulselessness is a LATE finding (pressures below systolic only at the end stage).'),
    q('ORTHO', 8, 'Complications of Fractures', ['Fat Embolism', 'Emergency Orthopaedics'],
      'Two days after femoral shaft fracture fixation, a patient develops hypoxia, confusion and petechiae over the chest, axillae and conjunctivae. The MOST likely diagnosis is:',
      ['Pulmonary embolism from DVT', 'Fat embolism syndrome', 'Tension pneumothorax', 'Pneumonia'], 1,
      'The classic triad of fat embolism syndrome (24–72 h after long-bone fracture): respiratory distress, neurological changes and petechial rash.'),
    q('ORTHO', 9, 'Injuries of the Knee', ['Ligament Injuries', 'Knee Examination'],
      'The MOST sensitive clinical test for acute anterior cruciate ligament rupture is:',
      ['McMurray test', 'Lachman test', 'Posterior drawer test', 'Valgus stress test at 30 degrees'], 1,
      'Lachman (anterior translation at 20–30° flexion) is the most sensitive; the anterior drawer is less sensitive and pivot shift needs an awake cooperative patient.'),
    q('ORTHO', 10, 'Peripheral Nerve Injuries of the Limbs', ['Nerve Injuries', 'Hand Deformities'],
      'A patient cannot adduct the fingers, has wasting of the first dorsal interosseous and positive Froment sign after a laceration at the wrist. The injured nerve is the:',
      ['Median nerve', 'Ulnar nerve', 'Radial nerve', 'Musculocutaneous nerve'], 1,
      'Ulnar nerve injury at the wrist spares the forearm muscles but loses interossei (finger adduction/abduction) and medial lumbricals — claw hand.'),
  ],
};

(async () => {
  await mongoose.connect(getMongoUri());

  // 1 ── ensure subjects (uppercase names match the existing seeded bank)
  const subjectByName = new Map();
  for (const canonical of miniGt.MINI_GT_SUBJECT_NAMES) {
    let subject = await Subject.findOne({
      name: new RegExp(`^${canonical}$`, 'i'),
    });
    if (!subject) {
      subject = await Subject.create({
        name: canonical.toUpperCase(),
        year: 'Final Year',
        displayOrder: 50,
      });
      console.log(`Created subject ${subject.name}`);
    }
    subjectByName.set(canonical, subject);
  }

  // 2 ── top up thin per-subject pools with the curated questions
  for (const [canonical, questions] of Object.entries(CURATED)) {
    const subject = subjectByName.get(canonical);
    const existing = await QuestionBank.countDocuments({
      subject: subject._id,
      isActive: true,
      questionType: { $in: miniGt.MINI_GT_QUESTION_TYPES },
    });
    let inserted = 0;
    if (existing < TARGET_POOL_PER_SUBJECT) {
      for (const { qid, ...rest } of questions) {
        // Idempotent: stable qid marks already-seeded questions.
        const dup = await QuestionBank.exists({ qid });
        if (dup) continue;
        await QuestionBank.create({ ...rest, qid, subject: subject._id });
        inserted += 1;
      }
    }
    console.log(`${canonical}: pool ${existing} → ${existing + inserted} curated questions (inserted ${inserted})`);
  }

  // 3 ── generate one Mini GT through the same code path as the admin API
  if (!process.argv.includes('--no-generate')) {
    let admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      admin = await User.create({
        name: 'Mini GT Seed Admin',
        email: 'dev-mini-cct-admin@example.com',
        password: 'MiniCctSeed!2026',
        role: 'admin',
      });
      console.log('Created seed admin dev-mini-cct-admin@example.com (password MiniCctSeed!2026)');
    }

    const result = await miniGt.createMiniGtQuiz({ adminId: admin._id });
    if (result.error) {
      console.error('Generation failed:', result.error.message);
      process.exitCode = 1;
    } else {
      console.log(`Created "${result.quiz.title}" (${result.questionCount} questions):`, result.perSubject);
    }
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
