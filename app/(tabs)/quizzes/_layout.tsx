import { Stack } from 'expo-router';

export default function QuizzesLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="quiz-hub" />
            <Stack.Screen name="my-performance" />
            <Stack.Screen name="question-bank" />
            <Stack.Screen name="create-quiz" />
            <Stack.Screen name="edit-quiz" />
            <Stack.Screen name="import-quiz" />
            <Stack.Screen name="past-tests" />
            <Stack.Screen name="retest-requests" />
            <Stack.Screen name="student-analytics" />
            <Stack.Screen name="[id]" />
        </Stack>
    );
}
