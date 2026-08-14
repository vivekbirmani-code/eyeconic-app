const { buildMetadataSnapshot } = require('../../utils/questionSnapshot');

describe('buildMetadataSnapshot', () => {
  it('builds a snapshot from a fully populated question', () => {
    const question = {
      subject: { _id: 'subj1', name: 'Pathology' },
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'numerical',
      tags: ['high-yield'],
      difficulty: 'hard',
    };

    expect(buildMetadataSnapshot(question)).toEqual({
      subjectId: 'subj1',
      subjectName: 'Pathology',
      topicName: 'Genetics',
      subtopicName: 'Mendelian Inheritance',
      system: 'Genetic Disorders',
      questionType: 'numerical',
      tags: ['high-yield'],
      difficulty: 'hard',
    });
  });

  it('defaults questionType to mcq_single for legacy questions', () => {
    const snapshot = buildMetadataSnapshot({ subject: null, topicName: 'X' });
    expect(snapshot.questionType).toBe('mcq_single');
    expect(snapshot.tags).toEqual([]);
  });

  it('falls back gracefully when subject is an unpopulated ObjectId', () => {
    const snapshot = buildMetadataSnapshot({ subject: 'raw-id-string', questionType: 'mcq_single' });
    expect(snapshot.subjectId).toBe('raw-id-string');
    expect(snapshot.subjectName).toBeUndefined();
  });
});
