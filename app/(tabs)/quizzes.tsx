import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TextInput,
  Modal,
  Alert,
  Platform,
  StatusBar
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, BookOpen, Clock } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';

interface Quiz {
  _id: string;
  title: string;
  subject: string;
  questions: any[];
  createdBy: string;
  createdAt: string;
}

export default function Quizzes() {
  const { user } = useAuth();
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newQuiz, setNewQuiz] = useState({
    title: '',
    subject: '',
    questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
  });

  useEffect(() => {
    fetchQuizzes();
  }, []);

  const fetchQuizzes = async () => {
    try {
      const response = await api.get('/quizzes');
      setQuizzes(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch quizzes');
    }
  };

  const createQuiz = async () => {
    if (!newQuiz.title || !newQuiz.subject) {
      Alert.alert('Error', 'Please fill in title and subject');
      return;
    }

    try {
      await api.post('/quizzes', newQuiz);
      setNewQuiz({
        title: '',
        subject: '',
        questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
      });
      setIsModalVisible(false);
      fetchQuizzes();
      Alert.alert('Success', 'Quiz created successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to create quiz');
    }
  };

  const openQuiz = (quizId: string) => {
    router.push(`/quiz/${quizId}`);
  };

  const renderQuiz = ({ item }: { item: Quiz }) => (
    <TouchableOpacity
      style={styles.quizCard}
      onPress={() => openQuiz(item._id)}
    >
      <BookOpen color="#2563EB" size={24} />
      <View style={styles.quizInfo}>
        <Text style={styles.quizTitle}>{item.title}</Text>
        <Text style={styles.quizSubject}>{item.subject}</Text>
        <View style={styles.quizMeta}>
          <Clock color="#6B7280" size={16} />
          <Text style={styles.quizDate}>
            {new Date(item.createdAt).toLocaleDateString()}
          </Text>
          <Text style={styles.questionCount}>
            {item.questions.length} questions
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const addQuestion = () => {
    setNewQuiz({
      ...newQuiz,
      questions: [
        ...newQuiz.questions,
        { question: '', options: ['', '', '', ''], correctAnswer: 0 },
      ],
    });
  };

  const updateQuestion = (index: number, field: string, value: any) => {
    const updatedQuestions = [...newQuiz.questions];
    if (field === 'options') {
      updatedQuestions[index].options = value;
    } else {
      updatedQuestions[index][field] = value;
    }
    setNewQuiz({ ...newQuiz, questions: updatedQuestions });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Quizzes</Text>
        {user?.role === 'admin' && (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setIsModalVisible(true)}
          >
            <Plus color="#FFFFFF" size={20} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={quizzes}
        renderItem={renderQuiz}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />

      {user?.role === 'admin' && (
        <Modal visible={isModalVisible} animationType="slide">
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Quiz</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalContent}>
              <TextInput
                style={styles.input}
                placeholder="Quiz Title"
                value={newQuiz.title}
                onChangeText={(text) => setNewQuiz({ ...newQuiz, title: text })}
              />
              <TextInput
                style={styles.input}
                placeholder="Subject"
                value={newQuiz.subject}
                onChangeText={(text) => setNewQuiz({ ...newQuiz, subject: text })}
              />

              <TouchableOpacity style={styles.addQuestionButton} onPress={addQuestion}>
                <Text style={styles.addQuestionText}>+ Add Question</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.createButton} onPress={createQuiz}>
                <Text style={styles.createButtonText}>Create Quiz</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
  },
  addButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 10,
  },
  list: {
    padding: 20,
    gap: 15,
  },
  quizCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 15,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  quizInfo: {
    marginLeft: 15,
    flex: 1,
  },
  quizTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  quizSubject: {
    fontSize: 14,
    color: '#2563EB',
    marginTop: 2,
    fontWeight: '500',
  },
  quizMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 10,
  },
  quizDate: {
    fontSize: 12,
    color: '#6B7280',
  },
  questionCount: {
    fontSize: 12,
    color: '#6B7280',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  cancelText: {
    color: '#EF4444',
    fontSize: 16,
  },
  modalContent: {
    flex: 1,
    padding: 20,
    gap: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#000000',
  },
  addQuestionButton: {
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  addQuestionText: {
    color: '#2563EB',
    fontSize: 16,
    fontWeight: '600',
  },
  createButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});